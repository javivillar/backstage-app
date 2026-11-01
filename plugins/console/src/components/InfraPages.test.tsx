import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { lifecycle, pullKind } from '../zone';
import { groupFailures } from './CisClusterPage';
import { ProgrammePage, VmDetailPage } from './InfraDetail';
import { Route, Routes } from 'react-router-dom';
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
    { name: 'a400m', id: 'nato-a400m', status: 'complete', ok: true,
      networks: [{ name: 'nato-a400m-pub', role: 'public', cidr: '10.102.2.0/24', vlan: 2002, exists: true, leases: 1, drift: [] }],
      securityGroups: [{ name: 'sg-nato-a400m-pub', role: 'public', exists: true, rules: ['inbound TCP 443'], extra: [], missing: [] }],
      vms: [{ id: '40', name: 'vm-nato-a400m-tools', state: 'RUNNING', role: 'vm', ips: ['10.102.102.11'], owner: 'console-nato-a400m', group: 'nato-a400m', console: true,
        disks: [{ image: 'oneke-cis', sizeMb: 30720, target: 'vda' }], nics: [{ network: 'nato-a400m-priv', ip: '10.102.102.11', mac: '02:00:0a', securityGroups: '0,7' }] }] },
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
  if (u.endsWith('/zone/vms')) return new Response(JSON.stringify({ policy: { images: {}, sizes: {}, limits: {} }, vms: [], allowed: true }));
  if (u.endsWith('/infra')) return new Response(JSON.stringify(infra));
  if (u.endsWith('/zone')) return new Response(JSON.stringify(zone));
  return new Response('{}', { status: 404 });
};
const wrap = (children: ReactNode, route?: string) =>
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
    route ? { routeEntries: [route] } : undefined,
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Create with this profile' })[0]); // minimal
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/clusters'))?.body).toEqual({ zone: 'nato', program: 'a400m', profile: 'minimal' }));
  });

  it('scales this cluster directly, after confirming', async () => {
    await wrap(<ClusterScalePage />);
    const workers = await screen.findByLabelText(/Workers/);
    fireEvent.change(workers, { target: { value: '3' } });
    expect(screen.getByText(/New nodes need 20 GB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scale' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Scale nato-sirtap-oneke to 2 masters, 3 workers and 1 storage nodes?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/clusters/scale'))?.body).toEqual({ zone: 'nato', program: 'sirtap', workers: 3, storage: 1 }));
    expect(await screen.findByText(/Committed: 2 masters, 3 workers/)).toBeInTheDocument();
  });

  it('follows a request from review to the host', () => {
    const p = { number: 3, title: 't', url: 'u', created: '2026-11-01T09:00:00Z', branch: 'console/seg-occar-a400m-1', body: '```json\n{"zone":"occar","program":"a400m"}\n```' };
    expect(lifecycle(p).label).toBe('Waiting for review');
    const merged = { ...p, merged: '2026-11-01T10:00:00Z' };
    expect(lifecycle(merged, { clusters: [], segregation: { state: 'applied', at: '2026-11-01T09:30:00Z' } }).label).toBe('Merged · waiting for the host');
    expect(lifecycle(merged, { clusters: [], segregation: { state: 'applied', at: '2026-11-01T10:04:00Z' } }).label).toBe('Applied');
    expect(lifecycle(merged, { clusters: [], segregation: { state: 'failed', at: '2026-11-01T10:04:00Z', detail: 'boom' } }).label).toBe('Failed');
    const c = { ...merged, branch: 'console/cluster-nato-a400m-1', body: '```json\n{"zone":"nato","program":"a400m"}\n```' };
    expect(lifecycle(c, { clusters: [{ zone: 'nato', program: 'a400m', action: 'cluster-create', state: 'pending', last: { action: 'cluster-create', state: 'done', at: '2026-11-01T10:05:00Z' } }] }).label).toBe('In progress');
    expect(lifecycle(c, { clusters: [{ zone: 'nato', program: 'a400m', action: 'ok', state: 'ok', last: { action: 'cluster-create', state: 'done', at: '2026-11-01T10:05:00Z' } }] }).label).toBe('Done');
  });

  it('shows the networks of a programme', async () => {
    await wrap(
      <Routes>
        <Route path="/p/:zone/:program" element={<ProgrammePage />} />
      </Routes>,
      '/p/nato/a400m',
    );
    expect(await screen.findByText('nato-a400m-pub')).toBeInTheDocument();
    expect(screen.getByText('10.102.2.0/24')).toBeInTheDocument();
    expect(screen.getByText('sg-nato-a400m-pub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove nato/a400m' })).toBeDisabled(); // it has a VM
    expect(screen.getByText('Delete its VMs first.')).toBeInTheDocument();
  });

  it('shows the detail of a VM', async () => {
    await wrap(
      <Routes>
        <Route path="/vm/:name" element={<VmDetailPage />} />
      </Routes>,
      '/vm/vm-nato-a400m-tools',
    );
    expect(await screen.findByText('console-nato-a400m · nato-a400m')).toBeInTheDocument();
    expect(screen.getByText('02:00:0a')).toBeInTheDocument();
    expect(screen.getByText('30 GB')).toBeInTheDocument();
  });

  it('groups the kube-bench failures by check', () => {
    const g = groupFailures([
      { node: 'm0', failures: [{ id: '1.2.10', desc: 'a' }, { id: '1.1.9', desc: 'b', change: 'new_fail' }] },
      { node: 'm1', failures: [{ id: '1.2.10', desc: 'a' }] },
    ]);
    expect(g.map(x => [x.id, x.nodes.length, x.isNew])).toEqual([['1.1.9', 1, true], ['1.2.10', 2, false]]);
  });
});
