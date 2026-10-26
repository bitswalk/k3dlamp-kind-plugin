/**
 * The plugin's whole contract with the laptop: three kind invocations.
 *
 * Headlamp runs them only in a desktop build whose app-build-manifest.json grants
 * each one to this plugin in `runCommands`; stock Headlamp releases grant none.
 * No other module may call `pluginRunCommand`, and nothing here builds argv from
 * free-form input: create sends its config on standard input, and delete appends
 * exactly one validated name.
 */
// Headlamp v0.46.0's PluginRunCommand, with the `input` option k3dlamp 0.4.0 adds.
// @kinvolk/headlamp-plugin 0.14.0 neither exports it nor types runCommand for tools
// other than minikube, az and scriptjs.
type PluginRunCommand = (
  tool: string,
  args: string[],
  options: { input?: string }
) => {
  stdout: { on: (event: 'data', listener: (chunk: string) => void) => void };
  stderr: { on: (event: 'data', listener: (chunk: string) => void) => void };
  on: (event: 'exit', listener: (code: number | null) => void) => void;
};

// Injected by Headlamp only when the product manifest grants this plugin kind.
// It is a free identifier, so it must be probed with `typeof` before use.
declare const pluginRunCommand: PluginRunCommand;

export const KIND = 'kind';
export const LIST_ARGS = ['get', 'clusters'];
// kind reads the config from standard input when the path is "-", and waits up
// to five minutes for the control plane to be ready.
export const CREATE_ARGS = ['create', 'cluster', '--config', '-', '--wait', '5m'];
export const DELETE_PREFIX = ['delete', 'cluster', '--name'];

/** The invocations a build must grant, as an operator would type them. */
export const REQUIRED_COMMANDS = [
  [KIND, ...LIST_ARGS].join(' '),
  [KIND, ...CREATE_ARGS].join(' '),
  [KIND, ...DELETE_PREFIX, '<name>'].join(' '),
];

/** Where the README explains the grants, for builds that lack them. */
export const GRANTS_URL = 'https://github.com/bitswalk/k3dlamp-kind-plugin#requirements';

/** The most standard input k3dlamp passes to a command, in UTF-16 code units. */
export const MAX_CONFIG_LENGTH = 1024 * 1024;

/** What Add cluster names its first cluster: one node for everything. */
export const DEFAULT_CLUSTER_NAME = 'local-aio';

// Exit codes Headlamp's main process reports when no kind process ran.
const SPAWN_FAILED = -1;
const NOT_AUTHORIZED = -2;
const CONSENT_DENIED = -3;

// kind prefixes kubeconfig contexts with "kind-".
const CONTEXT_PREFIX = 'kind-';

// What kind accepts as a cluster name, ^[a-z0-9.-]+$, but never a flag.
const CLUSTER_NAME = /^[a-z0-9][a-z0-9.-]*$/;

// Colour codes, in case a kind release colours its output.
// eslint-disable-next-line no-control-regex
const ANSI_COLOUR = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_COLOUR, '');
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface KindCluster {
  name: string;
}

export type KindStatus =
  | { state: 'ready'; clusters: KindCluster[] }
  // This build's manifest doesn't grant the plugin its kind commands.
  | { state: 'ungranted' }
  | { state: 'unavailable'; reason: string };

/** Whether this build granted the plugin any of its kind commands. */
export function commandsGranted(): boolean {
  return typeof pluginRunCommand === 'function';
}

function run(
  args: string[],
  onOutput?: (chunk: string) => void,
  input?: string
): Promise<RunResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    const proc = pluginRunCommand(KIND, args, input === undefined ? {} : { input });
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      onOutput?.(chunk);
    });
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      onOutput?.(chunk);
    });
    proc.on('exit', code =>
      resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) })
    );
  });
}

/** Turns a failed invocation into a sentence an operator can act on. */
export function describeFailure({ code, stderr }: RunResult): string {
  switch (code) {
    case SPAWN_FAILED:
      // The app refused the request before starting kind. The only request it
      // refuses this way is one with standard input, from a build older than
      // k3dlamp 0.4.0.
      if (stderr.trim() === '') {
        return "This app can't pass a config to kind. Update k3dlamp to 0.4.0 or later.";
      }
      return /ENOENT/.test(stderr)
        ? 'kind is not installed, or not on the PATH this app was started with.'
        : `kind could not be started: ${stderr.trim()}`;
    case NOT_AUTHORIZED:
      return `This build's app-build-manifest.json does not grant the plugin this kind command. See ${GRANTS_URL}`;
    case CONSENT_DENIED:
      return 'The kind command was denied in the consent prompt, and the app keeps that choice.';
    default:
      return kindError(stderr) || `kind exited with code ${code}.`;
  }
}

/**
 * kind logs its progress to stderr as well as its error, which comes last and
 * starts with "ERROR:". Keep that and anything after it; the output panel shows
 * the rest. Output without an ERROR line is kept whole.
 */
function kindError(stderr: string): string {
  const lines = stderr.trim().split('\n');
  const first = lines.findIndex(line => line.startsWith('ERROR:'));
  return (first === -1 ? lines : lines.slice(first)).join('\n').trim();
}

/** `kind get clusters` prints one name per line, and nothing on stdout without clusters. */
export function parseClusterList(stdout: string): KindCluster[] {
  const names = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  const invalid = names.find(name => !CLUSTER_NAME.test(name));
  if (invalid !== undefined) {
    throw new Error(`not a kind cluster name: ${invalid}`);
  }
  return names.map(name => ({ name }));
}

/**
 * Checks that kind can be run and lists its clusters. The list doubles as the
 * installation check, so the plugin needs no `kind version` grant.
 */
export async function probe(): Promise<KindStatus> {
  if (!commandsGranted()) {
    return { state: 'ungranted' };
  }
  const result = await run(LIST_ARGS);
  if (result.code === NOT_AUTHORIZED) {
    return { state: 'ungranted' };
  }
  if (result.code !== 0) {
    return { state: 'unavailable', reason: describeFailure(result) };
  }
  try {
    return { state: 'ready', clusters: parseClusterList(result.stdout) };
  } catch (err) {
    return { state: 'unavailable', reason: `Unexpected kind output: ${(err as Error).message}` };
  }
}

/** A kind.x-k8s.io/v1alpha4 config for one node that runs everything. */
export function defaultConfig(name: string): string {
  return `# One node runs the control plane and your workloads.
# Reference: https://kind.sigs.k8s.io/docs/user/configuration/
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${name} # Headlamp shows it as ${contextName(name)}
nodes:
  - role: control-plane
`;
}

/** The default cluster name, or the first local-aio-<n> that no cluster has yet. */
export function nextClusterName(taken: string[]): string {
  const names = new Set(taken);
  let name = DEFAULT_CLUSTER_NAME;
  for (let n = 2; names.has(name); n++) {
    name = `${DEFAULT_CLUSTER_NAME}-${n}`;
  }
  return name;
}

export function validateConfig(config: string): string | null {
  if (config.trim() === '') {
    return 'The config is empty.';
  }
  if (config.length > MAX_CONFIG_LENGTH) {
    return 'The config is larger than 1 MiB.';
  }
  return null;
}

/** Creates a cluster from a kind config, which kind reads on standard input. */
export function createCluster(
  config: string,
  onOutput: (chunk: string) => void
): Promise<RunResult> {
  const invalid = validateConfig(config);
  if (invalid) {
    throw new Error(invalid);
  }
  return run(CREATE_ARGS, onOutput, config);
}

export function deleteCluster(name: string, onOutput: (chunk: string) => void): Promise<RunResult> {
  if (!CLUSTER_NAME.test(name)) {
    throw new Error(`Not a kind cluster name: ${name}`);
  }
  return run([...DELETE_PREFIX, name], onOutput);
}

/** The kubeconfig context, and so the Headlamp cluster, kind creates for a cluster. */
export function contextName(clusterName: string): string {
  return CONTEXT_PREFIX + clusterName;
}

/** The kind cluster behind a Headlamp cluster, if its context follows kind's naming. */
export function clusterNameFromContext(context: string): string | null {
  if (!context.startsWith(CONTEXT_PREFIX)) {
    return null;
  }
  const name = context.slice(CONTEXT_PREFIX.length);
  return CLUSTER_NAME.test(name) ? name : null;
}
