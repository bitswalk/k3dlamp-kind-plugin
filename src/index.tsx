import { Icon } from '@iconify/react';
import {
  registerAddClusterProvider,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import KindPage, { KIND_ICON } from './KindPage';

const ROUTE = '/kind';

// Headlamp's provider card passes only the icon's size.
function KindIcon({ width = 48, height = 48 }: React.SVGAttributes<SVGElement>) {
  return <Icon icon={KIND_ICON} width={width} height={height} aria-hidden />;
}

registerSidebarEntry({
  parent: null,
  name: 'kind',
  label: 'kind',
  url: ROUTE,
  useClusterURL: false,
  icon: KIND_ICON,
  sidebar: 'HOME',
});

registerRoute({
  path: ROUTE,
  sidebar: { item: 'kind', sidebar: 'HOME' },
  name: 'kind',
  component: () => <KindPage />,
  exact: true,
  useClusterURL: false,
  noAuthRequired: true,
});

registerAddClusterProvider({
  title: 'kind',
  icon: KindIcon,
  description:
    'Create a Kubernetes cluster in Docker with the kind installed on this machine. Needs a ' +
    'Headlamp desktop build whose app-build-manifest.json grants this plugin its kind commands, ' +
    'such as k3dlamp.',
  url: ROUTE,
});
