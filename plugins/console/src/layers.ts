import type { ConsoleClassicPage } from './pages';

/**
 * The three layers of the console, as three administrators see the platform: the IaaS of the zone (OpenNebula), a
 * Kubernetes cluster, and the portal of the services of that cluster. The menu shows one layer at a time; the scope
 * trail of the top bar (Zone › Cluster › Portal) moves between them.
 */
export type Layer = 'infra' | 'cluster' | 'portal';

const CLUSTER_PATHS = ['/console/cluster', '/console/network', '/console/applications', '/console/storage', '/console/namespaces'];

export function layerOf(path: string, pages: ConsoleClassicPage[] = []): Layer {
  const p = path.replace(/\/+$/, '') || '/console';
  const under = (base: string) => p === base || p.startsWith(`${base}/`);
  if (under('/console/infrastructure') || under('/console/clusters')) return 'infra';
  if (CLUSTER_PATHS.some(under)) return 'cluster';
  if (pages.some(pg => pg.layer === 'cluster' && under(`/console/${pg.id}`))) return 'cluster';
  return 'portal';
}

export const LAYER_LOOK: Record<Layer, { bg: string; fg: string; name: string }> = {
  infra: { bg: '#E6F4F1', fg: '#0F5E52', name: 'Infrastructure' },
  cluster: { bg: '#E0ECF7', fg: '#003D68', name: 'Kubernetes' },
  portal: { bg: '#FFF0DD', fg: '#8A4300', name: 'Portal' },
};

/** Where each layer starts. */
export const LAYER_HOME: Record<Layer, string> = { infra: '/console/infrastructure', cluster: '/console/cluster', portal: '/console' };
