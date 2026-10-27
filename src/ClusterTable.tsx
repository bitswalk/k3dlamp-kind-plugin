import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { LightTooltip, Link, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { contextName, KindCluster } from './kind';

type HeadlampCluster = NonNullable<ReturnType<typeof K8s.useClustersConf>>[string];
type VersionError = ReturnType<typeof K8s.useClustersVersion>[1][string];

interface Row {
  /** kind's name for the cluster. */
  name: string;
  /** The kubeconfig context kind writes for it, and so its name in Headlamp. */
  context: string;
  /** Headlamp's cluster, when the kubeconfig has the context. */
  cluster?: HeadlampCluster;
}

// The status kinds Headlamp's home page shows, with its icons.
const STATUS = {
  active: { icon: 'mdi:cloud-check-variant', colorKey: 'success', coloredText: true },
  error: { icon: 'mdi:cloud-off', colorKey: 'error', coloredText: true },
  unknown: { icon: 'mdi:cloud-question', colorKey: 'unknown', coloredText: false },
} as const;

// The most warnings the home page counts before it shows "50+".
const MAX_WARNINGS = 50;

// Headlamp's Table renders a cell again only when the cell's value changes, so
// a cell that depends on anything else reads it here or from Headlamp's store.
const RowActions = React.createContext<{ busy: boolean; onDelete: (name: string) => void }>({
  busy: true,
  onDelete: () => {},
});

/** A kind cluster's Headlamp cluster, linked once the kubeconfig has its context. */
export function ClusterLink({ name }: { name: string }) {
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

/** What the Status column says about a cluster, in the home page's words. */
function statusText(row: Row, error: VersionError | undefined): string {
  if (!row.cluster) {
    return 'Not in kubeconfig';
  }
  if (error === undefined) {
    return 'Connecting…';
  }
  if (error === null) {
    return 'Active';
  }
  if (error.status === 401) {
    return 'Authentication required';
  }
  if (error.status === 403) {
    return 'Insufficient permissions';
  }
  return 'Unavailable';
}

/** Where Headlamp picked the cluster up from, as the home page's Origin column says. */
function origin(cluster?: HeadlampCluster): string {
  switch (cluster?.meta_data?.source) {
    case undefined:
      return '';
    case 'kubeconfig': {
      const path = cluster.meta_data?.origin?.kubeconfig;
      return path ? `Kubeconfig: ${path}` : 'Kubeconfig';
    }
    case 'dynamic_cluster':
      return 'Plugin';
    case 'incluster':
      return 'In-cluster';
    default:
      return 'Unknown';
  }
}

function ClusterStatus({ row, error }: { row: Row; error: VersionError | undefined }) {
  const theme = useTheme();
  const text = statusText(row, error);

  if (row.cluster && error === undefined) {
    return (
      <Box display="flex" alignItems="center" width="fit-content">
        <CircularProgress size={14} />
        <Typography variant="body2" sx={{ ml: 1, color: theme.palette.text.secondary }}>
          {text}
        </Typography>
      </Box>
    );
  }

  const variant = !row.cluster ? STATUS.unknown : error === null ? STATUS.active : STATUS.error;
  const color = theme.palette.home.status[variant.colorKey];
  const content = (
    <Box display="flex" alignItems="center" width="fit-content">
      <Icon icon={variant.icon} width={16} color={color} />
      <Typography variant="body2" sx={{ ml: 1, color: variant.coloredText ? color : undefined }}>
        {text}
      </Typography>
    </Box>
  );

  if (row.cluster) {
    return content;
  }
  return (
    <LightTooltip
      title={`kind has this cluster, but your kubeconfig has no ${row.context} context. Run: kind export kubeconfig --name ${row.name}`}
    >
      {content}
    </LightTooltip>
  );
}

/** The home page's Actions menu, with kind's delete in place of Headlamp's. */
function ClusterMenu({ row }: { row: Row }) {
  const history = useHistory();
  const { busy, onDelete } = React.useContext(RowActions);
  const inKubeconfig = Boolean(K8s.useClustersConf()?.[row.context]);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const menuId = `kind-cluster-menu-${row.name}`;

  function go(routeName: string) {
    setAnchor(null);
    history.push(Router.createRouteURL(routeName, { cluster: row.context }));
  }

  return (
    <>
      <Tooltip title="Actions">
        <IconButton
          size="small"
          onClick={event => setAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-label="Actions"
        >
          <Icon icon="mdi:more-vert" />
        </IconButton>
      </Tooltip>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem disabled={!inKubeconfig} onClick={() => go('cluster')}>
          <ListItemText>View</ListItemText>
        </MenuItem>
        <MenuItem disabled={!inKubeconfig} onClick={() => go('settingsCluster')}>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => {
            setAnchor(null);
            onDelete(row.name);
          }}
        >
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

/**
 * kind's clusters, laid out like the clusters table on Headlamp's home page.
 *
 * Its warnings query keeps the clusters it started with, so give it a key that
 * changes with the clusters, and it remounts when one is added or deleted.
 */
export default function ClusterTable({
  clusters,
  busy,
  onDelete,
}: {
  clusters: KindCluster[];
  busy: boolean;
  onDelete: (name: string) => void;
}) {
  const history = useHistory();
  const known = K8s.useClustersConf() ?? {};
  const rows: Row[] = clusters.map(({ name }) => {
    const context = contextName(name);
    return { name, context, cluster: known[context] };
  });
  const inKubeconfig = rows.flatMap(row => (row.cluster ? [row.cluster] : []));
  const [versions, errors] = K8s.useClustersVersion(inKubeconfig);
  const warnings = K8s.event.useEventWarningList(inKubeconfig.map(cluster => cluster.name));

  function warningCount(row: Row): string {
    if (!row.cluster) {
      return '';
    }
    const result = warnings[row.context];
    if (!result || result.error) {
      return '⋯';
    }
    const count = result.warnings.length;
    return count >= MAX_WARNINGS ? `${MAX_WARNINGS}+` : String(count);
  }

  return (
    <RowActions.Provider value={{ busy, onDelete }}>
      <Table<Row>
        columns={[
          {
            id: 'name',
            header: 'Name',
            accessorKey: 'context',
            gridTemplate: 2,
            Cell: ({ row: { original } }) => <ClusterLink name={original.name} />,
          },
          {
            id: 'origin',
            header: 'Origin',
            accessorFn: row => origin(row.cluster),
            Cell: ({ row: { original } }) => (
              <Typography variant="body2">{origin(original.cluster)}</Typography>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            accessorFn: row => statusText(row, errors[row.context]),
            Cell: ({ row: { original } }) => (
              <ClusterStatus row={original} error={errors[original.context]} />
            ),
          },
          {
            id: 'warnings',
            header: 'Warnings',
            accessorFn: warningCount,
          },
          {
            id: 'version',
            header: 'Kubernetes Version',
            accessorFn: row => (row.cluster ? versions[row.context]?.gitVersion || '⋯' : ''),
          },
          {
            id: 'actions',
            header: 'Actions',
            gridTemplate: 'min-content',
            muiTableBodyCellProps: { align: 'right' },
            Cell: ({ row: { original } }) => <ClusterMenu row={original} />,
            enableSorting: false,
            enableColumnFilter: false,
          },
        ]}
        data={rows}
        getRowId={row => row.name}
        initialState={{ sorting: [{ id: 'name', desc: false }] }}
        // As on the home page: open the clusters that answer, together.
        enableRowSelection={row => errors[row.original.context] === null}
        muiToolbarAlertBannerProps={{
          sx: theme => ({ background: theme.palette.background.muted }),
        }}
        renderToolbarAlertBannerContent={({ table }) => (
          <Button
            variant="contained"
            sx={{ ml: 1 }}
            onClick={() => {
              const selected = table.getSelectedRowModel().rows.map(it => it.original.context);
              history.push(Router.createRouteURL('cluster', { cluster: selected.join('+') }));
            }}
          >
            View Clusters
          </Button>
        )}
      />
    </RowActions.Provider>
  );
}
