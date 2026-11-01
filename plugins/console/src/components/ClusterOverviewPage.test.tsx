import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { appRank, bytes, type ClusterOverview, ClusterOverviewPage } from './ClusterOverviewPage';

const overview: ClusterOverview = {
  generatedAt: '2026-11-01T08:00:00.000Z',
  nodes: [
    { name: 'n1', ip: '10.0.0.1', roles: ['master'], ready: true, schedulable: true, pods: 30, cpu: { allocatable: 10, requested: 5, used: 0.2 }, memory: { allocatable: 20 * 2 ** 30, requested: 10 * 2 ** 30 } },
    { name: 'n2', roles: [], ready: false, schedulable: false, pods: 0, cpu: { allocatable: 10, requested: 0 }, memory: { allocatable: 2 ** 30, requested: 0 } },
  ],
  apps: [
    { name: 'iam-oneke', sync: 'Synced', health: 'Healthy', autosync: true },
    { name: 'bpm-oneke', sync: 'OutOfSync', health: 'Degraded', autosync: false },
  ],
  storage: [{ namespace: 'a', volumes: 2, requestedBytes: 15 * 2 ** 30, usedBytes: 2 ** 30, classes: { longhorn: 2 } }],
};

const render = (answer: { status: number; body: object }) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program', zone: 'nato', program: 'sirtap' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: async () => new Response(JSON.stringify(answer.body), { status: answer.status }) }],
      ]}
    >
      <ClusterOverviewPage />
    </TestApiProvider>,
  );

describe('ClusterOverviewPage', () => {
  it('shows nodes, applications and storage of the cluster', async () => {
    await render({ status: 200, body: overview });
    expect(await screen.findByText('Cluster nato-sirtap')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Not ready')).toBeInTheDocument();
    expect(screen.getByText('Cordoned')).toBeInTheDocument();
    expect(screen.getByText('1 not healthy · 1 out of sync')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    // problems first
    const names = screen.getAllByText(/-oneke$/).map(e => e.textContent);
    expect(names).toEqual(['bpm-oneke', 'iam-oneke']);
  });

  it('says why when the backend cannot read Prometheus', async () => {
    await render({ status: 503, body: { error: 'No Prometheus configured (costs.prometheusUrl).' } });
    expect(await screen.findByText(/overview of the cluster could not be read/)).toBeInTheDocument();
  });

  it('formats sizes and ranks problems first', () => {
    expect(bytes(15 * 2 ** 30)).toBe('15.0 GiB');
    expect(bytes(512)).toBe('512 B');
    expect(appRank({ name: 'x', sync: 'Synced', health: 'Degraded', autosync: false })).toBe(0);
    expect(appRank({ name: 'x', sync: 'OutOfSync', health: 'Healthy', autosync: false })).toBe(1);
  });
});
