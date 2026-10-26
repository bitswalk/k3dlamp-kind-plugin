import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clusterNameFromContext,
  contextName,
  CREATE_ARGS,
  createCluster,
  DEFAULT_CLUSTER_NAME,
  defaultConfig,
  DELETE_PREFIX,
  deleteCluster,
  describeFailure,
  GRANTS_URL,
  KIND,
  LIST_ARGS,
  MAX_CONFIG_LENGTH,
  nextClusterName,
  probe,
  REQUIRED_COMMANDS,
  stripAnsi,
  validateConfig,
} from './kind';

type Listener = (value: any) => void;

/** Stands in for Headlamp's injected pluginRunCommand and records each call. */
function fakeRunCommand(code: number | null, stdout = '', stderr = '') {
  const calls: Array<{ tool: string; args: string[]; options: object }> = [];
  const fn = vi.fn((tool: string, args: string[], options: object) => {
    calls.push({ tool, args, options });
    const out: Listener[] = [];
    const err: Listener[] = [];
    const exit: Listener[] = [];
    setTimeout(() => {
      if (stdout) out.forEach(l => l(stdout));
      if (stderr) err.forEach(l => l(stderr));
      exit.forEach(l => l(code));
    });
    return {
      stdout: { on: (_: string, l: Listener) => out.push(l) },
      stderr: { on: (_: string, l: Listener) => err.push(l) },
      on: (_: string, l: Listener) => exit.push(l),
    };
  });
  (globalThis as any).pluginRunCommand = fn;
  return calls;
}

afterEach(() => {
  delete (globalThis as any).pluginRunCommand;
});

describe('probe', () => {
  it('reports a build that injects no command capability as ungranted', async () => {
    expect(await probe()).toEqual({ state: 'ungranted' });
  });

  it('reports a build that refuses the list grant as ungranted', async () => {
    fakeRunCommand(-2);
    expect(await probe()).toEqual({ state: 'ungranted' });
  });

  it('lists clusters with the exact granted argv', async () => {
    const calls = fakeRunCommand(0, 'local-aio\nseed.lab\n');
    const status = await probe();
    expect(calls).toEqual([{ tool: KIND, args: LIST_ARGS, options: {} }]);
    expect(status).toEqual({
      state: 'ready',
      clusters: [{ name: 'local-aio' }, { name: 'seed.lab' }],
    });
  });

  it('reads no clusters from the message kind logs on stderr', async () => {
    fakeRunCommand(0, '', 'No kind clusters found.\n');
    expect(await probe()).toEqual({ state: 'ready', clusters: [] });
  });

  it.each([
    [
      -1,
      'spawn kind ENOENT',
      /^kind is not installed, or not on the PATH this app was started with\.$/,
    ],
    [-1, 'spawn kind EACCES', /could not be started: spawn kind EACCES/],
    [-3, '', /denied in the consent prompt, and the app keeps that choice\.$/],
    [
      1,
      'ERROR: failed to list clusters: command "docker ps" failed\n',
      /command "docker ps" failed$/,
    ],
  ])('explains exit code %i', async (code, stderr, reason) => {
    fakeRunCommand(code, '', stderr);
    const status = await probe();
    expect(status.state).toBe('unavailable');
    expect(status.state === 'unavailable' && status.reason).toMatch(reason);
  });

  it('rejects output that is not cluster names', async () => {
    fakeRunCommand(0, '--all\n');
    expect(await probe()).toEqual({
      state: 'unavailable',
      reason: expect.stringMatching(/Unexpected kind output/),
    });
  });
});

describe('describeFailure', () => {
  it('points a refused grant at the README', () => {
    expect(describeFailure({ code: -2, stdout: '', stderr: '' })).toBe(
      `This build's app-build-manifest.json does not grant the plugin this kind command. See ${GRANTS_URL}`
    );
  });

  it('asks for a newer k3dlamp when the app refuses standard input', () => {
    expect(describeFailure({ code: -1, stdout: '', stderr: '' })).toBe(
      "This app can't pass a config to kind. Update k3dlamp to 0.4.0 or later."
    );
  });

  it("keeps kind's error and what follows it, not the progress before it", () => {
    const stderr = [
      'Creating cluster "local-aio" ...',
      ' ✓ Ensuring node image (kindest/node:v1.34.0) 🖼',
      ' • Ready after 18s 💚',
      'ERROR: failed to create cluster: failed to lock config file: open /home/me/.kube/config.lock: file exists',
      'Command Output: details',
      '',
    ].join('\n');
    expect(describeFailure({ code: 1, stdout: '', stderr })).toBe(
      'ERROR: failed to create cluster: failed to lock config file: open /home/me/.kube/config.lock: file exists\nCommand Output: details'
    );
  });

  it('keeps output without an ERROR line whole', () => {
    expect(describeFailure({ code: 1, stdout: '', stderr: ' something broke \n' })).toBe(
      'something broke'
    );
    expect(describeFailure({ code: 2, stdout: '', stderr: '' })).toBe('kind exited with code 2.');
  });
});

describe('createCluster', () => {
  it('sends the config on standard input to the exact granted argv and streams output', async () => {
    const calls = fakeRunCommand(0, '', 'Creating cluster "seed" ...\n');
    const chunks: string[] = [];
    const config = defaultConfig('seed');
    const result = await createCluster(config, c => chunks.push(c));
    expect(calls).toEqual([{ tool: KIND, args: CREATE_ARGS, options: { input: config } }]);
    expect(result.code).toBe(0);
    expect(chunks).toEqual(['Creating cluster "seed" ...\n']);
  });

  it.each([
    ['an empty config', ''],
    ['a blank config', ' \n '],
    ['a config over 1 MiB', 'x'.repeat(MAX_CONFIG_LENGTH + 1)],
  ])('refuses %s', (_name, config) => {
    const calls = fakeRunCommand(0);
    expect(validateConfig(config)).not.toBeNull();
    expect(() => createCluster(config, () => {})).toThrow();
    expect(calls).toEqual([]);
  });
});

describe('the default cluster', () => {
  it('is one control-plane node', () => {
    const config = defaultConfig('local-aio');
    expect(config).toMatch(/^kind: Cluster$/m);
    expect(config).toMatch(/^apiVersion: kind\.x-k8s\.io\/v1alpha4$/m);
    expect(config).toMatch(/^name: local-aio /m);
    expect(config).toMatch(/^nodes:\n {2}- role: control-plane\n$/m);
  });

  it.each([
    [[], DEFAULT_CLUSTER_NAME],
    [['kind'], 'local-aio'],
    [['local-aio'], 'local-aio-2'],
    [['local-aio', 'local-aio-2', 'local-aio-4'], 'local-aio-3'],
  ])('with clusters %j is named %s', (taken, name) => {
    expect(nextClusterName(taken)).toBe(name);
  });
});

describe('deleteCluster', () => {
  it('appends only the cluster name to the granted prefix', async () => {
    const calls = fakeRunCommand(0);
    await deleteCluster('seed', () => {});
    expect(calls).toEqual([{ tool: KIND, args: [...DELETE_PREFIX, 'seed'], options: {} }]);
  });

  it.each(['--all', '-a', 'Seed', 'seed one', '.seed', ''])('refuses %j', name => {
    const calls = fakeRunCommand(0);
    expect(() => deleteCluster(name, () => {})).toThrow();
    expect(calls).toEqual([]);
  });
});

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi('\x1b[32m✓\x1b[0m Ensuring node image')).toBe('✓ Ensuring node image');
  });
});

describe('context names', () => {
  it('round-trips kind names', () => {
    expect(contextName('seed')).toBe('kind-seed');
    expect(clusterNameFromContext('kind-seed')).toBe('seed');
    expect(clusterNameFromContext('k3d-seed')).toBeNull();
    expect(clusterNameFromContext('kind---all')).toBeNull();
  });
});

describe('command-grants.json', () => {
  // Products copy these grants into their manifest's runCommands, so they must
  // describe exactly the argv this module sends.
  const grants = JSON.parse(readFileSync(resolve(__dirname, '../command-grants.json'), 'utf8'));

  it('matches the commands the page lists for builds without them', () => {
    expect(REQUIRED_COMMANDS).toEqual([
      'kind get clusters',
      'kind create cluster --config - --wait 5m',
      'kind delete cluster --name <name>',
    ]);
  });

  it('lists exactly list, create and delete', () => {
    expect(grants).toEqual([
      { tool: KIND, args: LIST_ARGS },
      { tool: KIND, args: CREATE_ARGS },
      { tool: KIND, args: DELETE_PREFIX, allowTrailingArgs: true },
    ]);
  });
});
