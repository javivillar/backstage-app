import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { pullKind } from '../zone';
import { ClusterScalePage } from './ClusterScalePage';
import { catalogLanes, MarketplacePage, PlatformPage } from './InfraPages';

const standard = {
  name: 'standard', default: true, description: 'HA control plane', counts: { vnf: 1, master: 2, worker: 2, storage: 1 }, memoryMb: 57344,
  roles: { vnf: { vcpu: 2, memory_mb: 2048 }, master: { vcpu: 4, memory_mb: 4096 }, worker: { vcpu: 10, memory_mb: 20480 }, storage: { vcpu: 4, memory_mb: 6144 } },
  k8sCis: true, k8sPsa: 'audit', cni: 'calico', longhorn: true,
};
const minimal = { ...standard, name: 'minimal', default: false, description: 'One master', counts: { vnf: 1, master: 1, worker: 0, storage: 1 }, memoryMb: 20480 };
const zone = {
  generated: '2026-11-01T10:00:00Z', warnings: [], drift: [],
  host: { name: 'refresquito', cpus: 16, memoryGiB: 62.5, availableGiB: 10, interfaces: [] },
  catalog: [
    { name: 'occar', label: 'OCCAR', status: 'reserved', enabled: false, maxProgramN: 99, programs: [] },
    { name: 'nato', label: 'NATO', status: 'complete', enabled: true, maxProgramN: 99, programs: [{ name: 'sirtap', n: 1, declared: true, ok: true, cluster: 'nato-sirtap-oneke' }, { name: 'a400m', n: 2, declared: true, ok: true }] },
  ],
  zones: [{ name: 'nato', status: 'complete', programs: [
    { name: 'sirtap', id: 'nato-sirtap', status: '', ok: true, cluster: { name: 'nato-sirtap-oneke', state: 'RUNNING', roles: { master: 2, worker: 2, storage: 1 } }, networks: [], securityGroups: [], vms: [] },
    { name: 'a400m', id: 'nato-a400m', status: '', ok: true, networks: [], securityGroups: [], vms: [] },
  ] }],
  kubernetes: { profiles: [standard, minimal], defaultProfile: 'standard' },
  capacity: { freeMemoryMb: 30720, reservedMemoryMb: 8192 },
  reconcile: { finished: '2026-11-01T10:05:00Z', error: null, segregation: null, clusters: [{ file: 'nato-sirtap.json', zone: 'nato', program: 'sirtap', action: 'ok', state: 'ok', detail: 'cluster as asked' }] },
};
const infra = { allowed: true, repo: 'javivillar/opennebula', clusters: [], pulls: [{ number: 5, title: 'console: new segregation occar/x', url: 'https://github.com/x/pull/5', branch: 'console/seg-occar-x-1', created: '2026-11-01T09:00:00Z' }] };
const posts: Array<{ url: string; body: unknown }> = [];
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    posts.push({ url: u, body: JSON.parse(String(init.body)) });
    return new Response(u.endsWith('/scale') ? '{"ok":true}' : '{"ok":true,"pull":{"number":9,"url":"https://github.com/x/pull/9"}}');
  }
  if (u.endsWith('/infra')) return new Response(JSON.stringify(infra));
  if (u.endsWith('/zone')) return new Response(JSON.stringify(zone));
  return new Response('{}', { status: 404 });
};
const wrap = (children: ReactNode) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program', zone: 'nato', program: 'sirtap' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: fetchFake }],
      ]}
    >
      {children}
    </TestApiProvider>,
  );

describe('Infrastructure layer', () => {
  it('draws the catalog: enabled zones first, reserved ones empty', () => {
    const lanes = catalogLanes(zone.catalog);
    expect(lanes.map(l => l.label)).toEqual(['NATO', 'OCCAR']);
    expect(lanes[0].nodes.map(n => n.title)).toEqual(['nato/sirtap', 'nato/a400m']);
    expect(lanes[1].nodes[0]).toMatchObject({ title: 'Reserved', dashed: true });
    expect(pullKind({ number: 1, title: '', url: '', created: '', branch: 'console/cluster-nato-a-1' })).toBe('New cluster');
  });

  it('asks a new segregation through a pull request', async () => {
    await wrap(<PlatformPage />);
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
    expect(await screen.findByText('#5')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Programme/), { target: { value: 'eurofighter' } });
    expect(screen.getByText('nato/eurofighter · n=3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/segregations'))?.body).toEqual({ zone: 'nato', program: 'eurofighter' }));
    expect(await screen.findByText(/Pull request #9 opened for nato\/eurofighter/)).toBeInTheDocument();
  });

  it('offers the profiles that fit and creates a cluster in a programme without one', async () => {
    await wrap(<MarketplacePage />);
    expect(await screen.findByText('OneKE · standard')).toBeInTheDocument();
    expect(screen.getByText('Does not fit now')).toBeInTheDocument(); // 56 GB > 30 GB free
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0]); // minimal
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/clusters'))?.body).toEqual({ zone: 'nato', program: 'a400m', profile: 'minimal' }));
  });

  it('scales this cluster directly, after confirming', async () => {
    await wrap(<ClusterScalePage />);
    const workers = await screen.findByLabelText(/Workers/);
    fireEvent.change(workers, { target: { value: '3' } });
    expect(screen.getByText(/New nodes need 20 GB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scale' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Scale nato-sirtap-oneke to 3 workers and 1 storage nodes?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/clusters/scale'))?.body).toEqual({ zone: 'nato', program: 'sirtap', workers: 3, storage: 1 }));
    expect(await screen.findByText(/Committed: 3 workers/)).toBeInTheDocument();
  });
});
