import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef, EntityProvider } from '@backstage/plugin-catalog-react';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ClusterOverview } from '../overview';
import { ApplicationsPage } from './ApplicationsPage';
import { EntityLiveContent, type NamespaceLive } from './EntityLive';
import type { NamespaceWorkloads } from '../namespace';
import { NamespacePage } from './NamespacePage';
import { Route, Routes } from 'react-router-dom';
import { StoragePage } from './StoragePage';

const overview: ClusterOverview = {
  generatedAt: '2026-11-01T08:00:00.000Z',
  nodes: [],
  apps: [
    { name: 'iam-oneke', namespace: 'iam', sync: 'Synced', health: 'Healthy', autosync: true },
    { name: 'datahub-oneke', namespace: 'dh', sync: 'OutOfSync', health: 'Degraded', autosync: false },
  ],
  storage: [],
  volumes: [
    { namespace: 'dh', pvc: 'es-data', requestedBytes: 10 * 2 ** 30, capacityBytes: 10 * 2 ** 30, usedBytes: 9.2 * 2 ** 30, storageClass: 'longhorn' },
    { namespace: 'iam', pvc: 'pg', requestedBytes: 2 ** 30, storageClass: 'longhorn-retain' },
  ],
};
const live: NamespaceLive = {
  generatedAt: '2026-11-01T08:00:00.000Z',
  namespace: 'shop',
  pods: [
    { name: 'shop-api-1', ready: false, phase: 'Running', restarts24h: 3, lastTermination: 'OOMKilled', memory: 500e6, memoryLimit: 512e6 },
    { name: 'shop-db-0', ready: true, phase: 'Running', restarts24h: 0, cpu: 0.01 },
  ],
  jobs: [{ name: 'shop-provisioner-2', ownerKind: 'Job', phase: 'Failed', ready: false, restarts24h: 0 }],
};

const workloads: NamespaceWorkloads = {
  generatedAt: '2026-11-01T08:00:00.000Z',
  namespace: 'shop',
  warnings: [],
  workloads: [{ kind: 'StatefulSet', name: 'shop-db', desired: 1, ready: 0, rollingOut: false, images: ['harbor.x/common/postgres:18'] }],
  events: [{ reason: 'BackOff', object: 'Pod shop-api-1', message: 'Back-off restarting failed container', count: 4, last: '2026-11-01T07:59:00.000Z' }],
};
const network = { generatedAt: '', warnings: [], hosts: [{ host: 'shop.x', namespace: 'shop', ingress: 'shop', tls: true, tlsSource: 'cluster' }], segments: [], namespaces: [{ name: 'shop', segment: 'business-support', system: false, hosts: ['shop.x'], isolation: 'open', egressRestricted: false, policies: [] }] };
const answer = (url: string) => {
  if (url.endsWith('/live')) return live;
  if (url.endsWith('/workloads')) return workloads;
  if (url.endsWith('/network')) return network;
  return overview;
};

const wrap = (children: ReactNode, route = '/') =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: async (url: RequestInfo | URL) => new Response(JSON.stringify(answer(String(url))), { status: 200 }) }],
        [catalogApiRef, { getEntities: async () => ({ items: [{ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'iam-oneke' } }] }) }],
      ]}
    >
      {children}
    </TestApiProvider>,
    { routeEntries: [route] },
  );

describe('operate pages', () => {
  it('lists the applications with problems first and links the ones in the catalog', async () => {
    await wrap(<ApplicationsPage />);
    expect(await screen.findByText('Applications of nato-sirtap')).toBeInTheDocument();
    expect(screen.getByText('Only with problems (1)')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'iam-oneke' })).toHaveAttribute('href', '/console/entity/default/component/iam-oneke');
  });

  it('shows the mounted volumes, the fullest first', async () => {
    await wrap(<StoragePage />);
    expect(await screen.findByText('es-data')).toBeInTheDocument();
    expect(screen.getByText(/92% ·/)).toBeInTheDocument();
    expect(screen.queryByText('pg')).not.toBeInTheDocument();
  });

  it('shows the pods of the namespace of an entity', async () => {
    await wrap(
      <EntityProvider entity={{ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'shop', annotations: { 'refresquito.io/namespace': 'shop' } } }}>
        <EntityLiveContent />
      </EntityProvider>,
    );
    expect(await screen.findByText('Pods of shop')).toBeInTheDocument();
    expect(screen.getByText('last end: OOMKilled')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('shows the workloads, warnings and job runs of the namespace', async () => {
    await wrap(
      <EntityProvider entity={{ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'shop', annotations: { 'refresquito.io/namespace': 'shop' } } }}>
        <EntityLiveContent />
      </EntityProvider>,
    );
    expect(await screen.findByText('shop-db')).toBeInTheDocument();
    expect(screen.getByText('0 / 1')).toBeInTheDocument();
    expect(screen.getByText('BackOff')).toBeInTheDocument();
    expect(screen.getByText('shop-provisioner-2')).toBeInTheDocument();
    expect(screen.getByText('Job runs failed')).toBeInTheDocument();
  });

  it('opens a namespace page with its segment, isolation and hosts', async () => {
    await wrap(
      <Routes>
        <Route path="/console/namespaces/:ns" element={<NamespacePage />} />
      </Routes>,
      '/console/namespaces/shop',
    );
    expect(await screen.findByRole('heading', { name: 'shop' })).toBeInTheDocument();
    expect(await screen.findByText('segment business-support')).toBeInTheDocument();
    expect(screen.getByText('Open to the cluster')).toBeInTheDocument();
    expect(await screen.findByText('TLS · cluster certificate')).toBeInTheDocument();
  });
});
