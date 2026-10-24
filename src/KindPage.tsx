import { Icon } from '@iconify/react';
import { Activity, ConfigStore, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  Loader,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link as ExternalLink,
  Typography,
} from '@mui/material';
import React from 'react';
import { Prompt } from 'react-router-dom';
import {
  contextName,
  createCluster,
  defaultConfig,
  deleteCluster,
  describeFailure,
  GRANTS_URL,
  KindCluster,
  KindStatus,
  nextClusterName,
  probe,
  REQUIRED_COMMANDS,
  stripAnsi,
} from './kind';
import ManifestEditor from './ManifestEditor';

export const PACKAGE_NAME = '@bitswalk/headlamp-kind';

/** kind has no icon of its own in Headlamp's icon set: a container ship, for Docker. */
export const KIND_ICON = 'mdi:ferry';

// The custom cluster editor's last draft, kept until a create from it succeeds.
const settings = new ConfigStore<{ draft?: string }>(PACKAGE_NAME);

const EDITOR_ACTIVITY = 'kind-custom-cluster';

// Keep the output panel bounded while kind streams progress.
const MAX_OUTPUT_CHARS = 64 * 1024;

type Outcome =
  | { severity: 'success'; text: string; cluster?: string }
  | { severity: 'error'; text: string; fromEditor: boolean };

function ClusterLink({ name }: { name: string }) {
  const known = K8s.useClustersConf() ?? {};
  const context = contextName(name);
  if (!known[context]) {
    return <span title="Not in your kubeconfig">{context}</span>;
  }
  return (
    <Link routeName="cluster" params={{ cluster: context }}>
      {context}
    </Link>
  );
}

/** Explains, in a build that lacks them, the grants this plugin needs. */
function GrantsRequired() {
  return (
    <Alert severity="warning">
      <AlertTitle>This build doesn't let the plugin run kind</AlertTitle>
      Headlamp runs a plugin's local commands only when the desktop build's app-build-manifest.json
      grants them. This plugin needs a build that grants it these three commands, which stock
      Headlamp releases don't:
      <Box component="ul" sx={{ my: 1 }}>
        {REQUIRED_COMMANDS.map(command => (
          <li key={command}>
            <code>{command}</code>
          </li>
        ))}
      </Box>
      k3dlamp is a Headlamp build that grants them.{' '}
      <ExternalLink href={GRANTS_URL} target="_blank" rel="noreferrer">
        How to grant them in your own build
      </ExternalLink>
    </Alert>
  );
}

/** kind's empty cluster list, laid out like Headlamp's home page without clusters. */
function NoClusters({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="400px"
      textAlign="center"
    >
      <Icon icon={KIND_ICON} style={{ fontSize: 64, color: '#ccc', marginBottom: 16 }} />
      <Typography variant="h6" gutterBottom>
        No kind clusters
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Add a single-node cluster to get started, or write your own config with Custom cluster.
      </Typography>
      <Button
        variant="contained"
        startIcon={<Icon icon="mdi:plus" />}
        onClick={onAdd}
        disabled={disabled}
      >
        Add cluster
      </Button>
    </Box>
  );
}

export default function KindPage() {
  const [status, setStatus] = React.useState<KindStatus | null>(null);
  const [running, setRunning] = React.useState<string | null>(null);
  const [output, setOutput] = React.useState('');
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [toDelete, setToDelete] = React.useState<string | null>(null);

  const clusters = status?.state === 'ready' ? status.clusters : [];
  const ready = status?.state === 'ready';
  const busy = running !== null;

  const refresh = React.useCallback(async () => {
    setStatus(null);
    const next = await probe();
    setStatus(next);
    return next;
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // The editor lives in an activity outside this page: close it with the page,
  // so its Create never starts kind with nothing showing the progress.
  React.useEffect(() => () => Activity.close(EDITOR_ACTIVITY), []);

  function appendOutput(chunk: string) {
    // Strip the joined text, so a colour code split across chunks is still removed.
    setOutput(previous => stripAnsi(previous + chunk).slice(-MAX_OUTPUT_CHARS));
  }

  async function create(config: string, fromEditor: boolean) {
    const before = new Set(clusters.map(c => c.name));
    setRunning('Creating cluster');
    setOutput('');
    setOutcome(null);
    try {
      const result = await createCluster(config, appendOutput);
      const after = await refresh();
      if (result.code !== 0) {
        setOutcome({ severity: 'error', text: describeFailure(result), fromEditor });
        return;
      }
      if (fromEditor) {
        settings.update({ draft: undefined });
      }
      const created =
        after.state === 'ready' ? after.clusters.find(c => !before.has(c.name)) : undefined;
      setOutcome({
        severity: 'success',
        text: created ? `Cluster ${created.name} is ready.` : 'kind reported success.',
        cluster: created?.name,
      });
    } catch (err) {
      setOutcome({ severity: 'error', text: (err as Error).message, fromEditor });
    } finally {
      setRunning(null);
    }
  }

  // The activity keeps the callbacks it launched with, so route them through a
  // ref to reach this render's state.
  const createFromEditor = React.useRef(create);
  createFromEditor.current = create;

  function openEditor() {
    const template = defaultConfig(nextClusterName(clusters.map(c => c.name)));
    const close = () => Activity.close(EDITOR_ACTIVITY);
    Activity.launch({
      id: EDITOR_ACTIVITY,
      title: 'Create a kind cluster',
      location: 'full',
      icon: <Icon icon={KIND_ICON} />,
      content: (
        <ManifestEditor
          initial={settings.get()?.draft ?? template}
          template={template}
          onChange={draft => settings.update({ draft })}
          onCreate={config => {
            close();
            createFromEditor.current(config, true);
          }}
          onClose={close}
        />
      ),
    });
  }

  async function handleDelete(name: string) {
    setToDelete(null);
    setRunning(`Deleting cluster ${name}`);
    setOutput('');
    setOutcome(null);
    try {
      const result = await deleteCluster(name, appendOutput);
      await refresh();
      setOutcome(
        result.code === 0
          ? { severity: 'success', text: `Cluster ${name} was deleted.` }
          : { severity: 'error', text: describeFailure(result), fromEditor: false }
      );
    } catch (err) {
      setOutcome({ severity: 'error', text: (err as Error).message, fromEditor: false });
    } finally {
      setRunning(null);
    }
  }

  const addCluster = () => create(defaultConfig(nextClusterName(clusters.map(c => c.name))), false);

  const actions = ready
    ? [
        ...(clusters.length > 0
          ? [
              <Button
                key="add"
                variant="contained"
                startIcon={<Icon icon="mdi:plus" />}
                onClick={addCluster}
                disabled={busy}
              >
                Add cluster
              </Button>,
            ]
          : []),
        <Button
          key="custom"
          variant="contained"
          color="secondary"
          startIcon={<Icon icon="mdi:file-document-edit-outline" />}
          onClick={openEditor}
          disabled={busy}
          sx={{ ml: 1 }}
        >
          Custom cluster
        </Button>,
      ]
    : [];

  return (
    <>
      <Prompt when={busy} message="kind is still running. Leave this page anyway?" />

      <SectionBox title="kind" headerProps={{ headerStyle: 'main', actions }}>
        {status === null && <Loader title="Checking kind" />}
        {status?.state === 'ungranted' && <GrantsRequired />}
        {status?.state === 'unavailable' && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={refresh} disabled={busy}>
                Retry
              </Button>
            }
          >
            {status.reason}
          </Alert>
        )}
        {ready && clusters.length === 0 && <NoClusters onAdd={addCluster} disabled={busy} />}
        {ready && clusters.length > 0 && (
          <SimpleTable
            columns={[
              { label: 'Cluster', getter: (c: KindCluster) => <ClusterLink name={c.name} /> },
              {
                label: '',
                getter: (c: KindCluster) => (
                  <Button
                    color="error"
                    size="small"
                    disabled={busy}
                    onClick={() => setToDelete(c.name)}
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
            data={clusters}
          />
        )}

        {running && (
          <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mt: 2 }}>
            {running}…
          </Alert>
        )}
        {outcome && (
          <Alert
            severity={outcome.severity}
            sx={{ mt: 2 }}
            action={
              outcome.severity === 'error' &&
              outcome.fromEditor && (
                <Button color="inherit" size="small" onClick={openEditor} disabled={busy}>
                  Edit config
                </Button>
              )
            }
          >
            {outcome.text}
            {outcome.severity === 'success' && outcome.cluster && (
              <>
                {' '}
                Open <ClusterLink name={outcome.cluster} />.
              </>
            )}
          </Alert>
        )}
        {output && (
          <Box
            component="pre"
            sx={{
              mt: 2,
              p: 1,
              maxHeight: 320,
              overflow: 'auto',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              bgcolor: 'action.hover',
            }}
          >
            {output}
          </Box>
        )}
      </SectionBox>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete cluster {toDelete}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            kind removes the cluster's node containers and kubeconfig context. This cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          <Button color="error" onClick={() => toDelete && handleDelete(toDelete)}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
