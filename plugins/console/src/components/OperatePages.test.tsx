import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef, EntityProvider } from '@backstage/plugin-catalog-react';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ClusterOverview } from '../overview';
import { ApplicationsPage } from './ApplicationsPage';
import { EntityLiveContent, type NamespaceLive } from './EntityLive';
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
};

const wrap = (children: ReactNode) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('/live') ? live : overview), { status: 200 }) }],
        [catalogApiRef, { getEntities: async () => ({ items: [{ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'iam-oneke' } }] }) }],
      ]}
    >
      {children}
    </TestApiProvider>,
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
});
