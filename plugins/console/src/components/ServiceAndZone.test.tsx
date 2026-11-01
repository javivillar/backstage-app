import type { Entity } from '@backstage/catalog-model';
import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ServiceDataProvider, serviceAttention } from './ServiceData';
import { ServiceHeader, ServiceOverview, vitals } from './ServiceViews';
import { ZoneOverviewPage, ZoneVmsPage } from './ZonePages';

const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'petstore-oneke', title: 'Petstore', annotations: { 'refresquito.io/namespace': 'shop', 'refresquito.io/application': 'petstore' } },
  spec: { owner: 'group:default/team-pets', system: 'business-systems', lifecycle: 'production' },
  relations: [{ type: 'dependsOn', targetRef: 'component:default/iam-oneke' }],
};

const answers: Record<string, unknown> = {
  '/overview': { generatedAt: '', nodes: [], storage: [], volumes: [{ namespace: 'shop', pvc: 'data-db', requestedBytes: 2 ** 30, storageClass: 'longhorn-retain' }], apps: [{ name: 'petstore-oneke', namespace: 'shop', sync: 'Synced', health: 'Healthy', autosync: true }] },
  '/network': { generatedAt: '', warnings: [], hosts: [{ host: 'petstore.x', namespace: 'shop', ingress: 'p', tls: true, tlsSource: 'cluster' }], segments: [], namespaces: [{ name: 'shop', segment: 'business-support', system: false, hosts: ['petstore.x'], isolation: 'open', egressRestricted: false, policies: [] }], certificate: { name: 'c', namespace: 't', dnsNames: [], notAfter: '2099-01-01T00:00:00Z', ready: true } },
  '/live': { generatedAt: '', namespace: 'shop', pods: [{ name: 'api-1', ready: false, phase: 'Running', restarts24h: 5, lastTermination: 'OOMKilled' }], jobs: [] },
  '/workloads': { generatedAt: '', namespace: 'shop', warnings: [], events: [], workloads: [{ kind: 'Deployment', name: 'api', desired: 1, ready: 0, rollingOut: false, images: ['ghcr.io/x/api:1'] }] },
  '/vulnerabilities': { configured: true, scan: { counts: { CRITICAL: 0, HIGH: 2 }, vulns: [] } },
  '/actions': { allowed: true, configured: true, groups: ['backstage-admin'], log: [] },
  '/zone': {
    generated: '2026-11-01T10:00:00Z',
    warnings: [],
    host: { name: 'refresquito', cpus: 16, memoryGiB: 62.5, availableGiB: 21.9, interfaces: [] },
    drift: [{ zone: 'nato', program: 'sirtap', kind: 'security group', name: 'sg-pub', detail: 'rule not in the design: inbound TCP 8443 anywhere' }],
    consoleVms: { applied: '2026-11-01T12:00:00Z', vms: [{ zone: 'nato', program: 'sirtap', name: 'tools', state: 'waiting', detail: 'the host has 9000 MiB available' }] },
    zones: [
      {
        name: 'nato',
        status: 'complete',
        router: { name: 'vr-nato', exists: true, vms: [{ id: '7', name: 'vr-nato-0', state: 'ACTIVE', role: 'zone router', ips: ['10.102.0.2'] }] },
        transit: { name: 'nato-transit', cidr: '10.102.0.0/24', exists: true, leases: 2, drift: [] },
        programs: [
          {
            name: 'sirtap',
            id: 'nato-sirtap',
            status: 'complete',
            ok: true,
            cluster: { name: 'oneke-nato-sirtap', state: 'RUNNING', vip: '10.102.1.200', roles: { master: 2, worker: 3 } },
            networks: [{ name: 'nato-sirtap-pub', role: 'public', cidr: '10.102.1.0/24', exists: true, leases: 4, drift: [] }],
            securityGroups: [{ name: 'sg-pub', exists: true, rules: [], extra: ['inbound TCP 8443 anywhere'], missing: [] }],
            vms: [{ id: '21', name: 'oneke-ip-10-102-101-17', state: 'ACTIVE', role: 'master', ips: ['10.102.101.17'] }],
          },
        ],
      },
    ],
  },
};
const posts: Array<{ url: string; body: unknown }> = [];
const vmSpec = {
  limits: { vms: 2, cpu: 4, memory_mb: 8192, host_reserve_mb: 8192 },
  sizes: { small: { cpu: 1, memory_mb: 2048, disk_gb: 20 } },
  images: { 'ubuntu-22.04-cis': 'oneke-cis-1.33-ubuntu2204-0.1.2' },
  vms: [{ zone: 'nato', program: 'sirtap', name: 'tools', size: 'small', image: 'ubuntu-22.04-cis', state: 'running', requested_by: 'user:default/javi' }],
};
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    posts.push({ url: u, body: JSON.parse(String(init.body)) });
    return new Response('{"ok":true}');
  }
  if (u.endsWith('/zone/vms')) return new Response(JSON.stringify({ spec: vmSpec, allowed: true }));
  const key = Object.keys(answers).find(k => u.includes(k));
  if (u.includes('/opencost/')) {
    const daily = u.includes('accumulate=false');
    return new Response(JSON.stringify(daily ? { data: [{ shop: { totalCost: 0.5 } }, { shop: { totalCost: 0.6 } }] } : { data: [{ shop: { totalCost: 3.84, cpuCost: 1, ramCost: 2, pvCost: 0.1 } }] }));
  }
  if (u.includes('/deployments')) return new Response(JSON.stringify({ namespaces: { shop: { versions: [{ image: 'ghcr.io/x/api:1', firstSeen: '2026-10-31T08:00:00Z' }] } } }));
  return key ? new Response(JSON.stringify(answers[key])) : new Response('{}', { status: 404 });
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

describe('service page', () => {
  it('shows the vital signs and what needs attention', async () => {
    await wrap(
      <ServiceDataProvider entity={entity}>
        <ServiceHeader />
        <ServiceOverview />
      </ServiceDataProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Petstore' })).toBeInTheDocument();
    expect(await screen.findByText('0 / 1')).toBeInTheDocument();
    expect(await screen.findByText('2 high')).toBeInTheDocument();
    expect(await screen.findByText('api-1 is not ready')).toBeInTheDocument();
    expect(screen.getByText('kept if deleted')).toBeInTheDocument();
    expect(await screen.findByText('ghcr.io/x/api:1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Actions/ }));
    expect(await screen.findByRole('button', { name: 'Sync with git' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Restart api' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Restart Deployment api?');
  });

  it('ranks the problems of a service', () => {
    const items = serviceAttention({
      entity,
      base: '/console/entity/default/component/petstore-oneke',
      namespace: 'shop',
      app: { name: 'p', sync: 'OutOfSync', health: 'Healthy', autosync: true },
      findings: [{ image: 'a', counts: { CRITICAL: 1 }, kev: 0 }],
      images: ['a'],
      money: String,
    });
    expect(items.map(i => [i.tone, i.tab])).toEqual([
      ['bad', 'security'],
      ['info', 'changes'],
    ]);
    expect(vitals({ entity, base: '', findings: [], images: [], money: String })).toEqual([]);
  });
});

describe('zone pages', () => {
  it('draws the zone and its differences with the design', async () => {
    await wrap(<ZoneOverviewPage />);
    expect(await screen.findByText('Infrastructure of zone nato')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Zone map' })).toBeInTheDocument();
    expect(screen.getByText('rule not in the design: inbound TCP 8443 anywhere')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('lists the VMs of the zone and requests a new one on the private network', async () => {
    await wrap(<ZoneVmsPage />);
    expect(await screen.findByText('oneke-ip-10-102-101-17')).toBeInTheDocument();
    expect(screen.getByText('vr-nato-0')).toBeInTheDocument();
    // what the host did with the request
    expect(await screen.findByText('waiting')).toBeInTheDocument();
    expect(screen.getByText('the host has 9000 MiB available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create VM' }));
    expect(screen.getByText(/private network of sirtap \(nato-sirtap-pub|private network of sirtap/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'builder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request the VM' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/zone/vms'))?.body).toEqual({ zone: 'nato', program: 'sirtap', name: 'builder', image: 'ubuntu-22.04-cis', size: 'small' }));
    expect(await screen.findByText(/Requested: the host creates builder/)).toBeInTheDocument();
  });
});
