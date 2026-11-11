import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { interFiles, interPolicy, interView } from '../interFixture';
import type { InfraView, VmPolicy } from '../zone';
import { ClusterOverviewPage } from './ClusterOverviewPage';
import { ClustersPage } from './ClustersPage';
import { PlatformPage } from './InfraPages';
import { InterconnectionPage } from './InterconnectionPage';
import { MarketplacePage } from './MarketplacePage';
import { PlatformOverviewPage } from './PlatformOverviewPage';

/** What the backend answers; a test may change the zone view or the policy before rendering. */
let zoneAnswer: InfraView = interView;
let policyAnswer: VmPolicy = interPolicy;
const infra = { allowed: true, admins: ['nato/sirtap'], repo: 'javivillar/opennebula', clusters: [], pulls: [], merged: [] };
const overview = {
  generatedAt: '2026-11-10T21:00:00.000Z',
  nodes: [
    { name: 'master-0', ip: '10.0.0.1', roles: ['master'], kubelet: 'v1.33.4+rke2r1', ready: true, schedulable: true, pods: 30, cpu: { allocatable: 4, requested: 2 }, memory: { allocatable: 4 * 2 ** 30, requested: 2 * 2 ** 30 } },
    { name: 'worker-0', ip: '10.0.0.2', roles: [], ready: true, schedulable: true, pods: 80, cpu: { allocatable: 10, requested: 5 }, memory: { allocatable: 20 * 2 ** 30, requested: 19 * 2 ** 30 } },
  ],
  apps: [
    { name: 'iam-oneke', sync: 'Synced', health: 'Healthy', autosync: true, namespace: 'nato-sirtap-iam-oneke' },
    { name: 'wazuh-oneke', sync: 'Synced', health: 'Degraded', autosync: true },
    { name: 'segments-oneke', sync: 'Synced', health: 'Healthy', autosync: true },
  ],
  storage: [],
};
const component = (name: string, annotations: Record<string, string> = {}, type = 'platform-service') => ({ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name, namespace: 'default', annotations }, spec: { type } });
const entities = [
  component('iam-oneke', { 'refresquito.io/namespace': 'nato-sirtap-iam-oneke', 'refresquito.io/product': 'Keycloak 26.5' }),
  component('wazuh-oneke', { 'refresquito.io/namespace': 'nato-sirtap-wazuh-oneke' }),
  component('segments-oneke'),
  component('petstore', { 'refresquito.io/namespace': 'nato-sirtap-petstore', 'refresquito.io/application': 'petstore' }, 'application-instance'),
];

const posts: Array<{ url: string; body: unknown }> = [];
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    posts.push({ url: u, body: JSON.parse(String(init.body)) });
    return new Response('{"ok":true,"pull":{"number":9,"url":"https://github.com/x/pull/9"}}');
  }
  if (u.endsWith('/zone/vms')) {
    return new Response(JSON.stringify({
      policy: policyAnswer, vms: interFiles, allowed: true, merged: [],
      pulls: [{ number: 131, title: 'console: create component sftpgo-0', url: 'https://github.com/x/pull/131', branch: 'console/vm-new-nato-landing-sftpgo-0-abc', created: '2026-11-10T20:00:00Z', body: '```json\n{"zone":"nato","program":"landing","name":"sftpgo-0","component":"sftpgo"}\n```' }],
    }));
  }
  if (u.endsWith('/infra')) return new Response(JSON.stringify(infra));
  if (u.endsWith('/zone')) return new Response(JSON.stringify(zoneAnswer));
  if (u.endsWith('/overview')) return new Response(JSON.stringify(overview));
  return new Response(JSON.stringify({ error: 'not in this test' }), { status: 503 });
};
const wrap = (children: ReactNode, route?: string) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program', zone: 'nato', program: 'sirtap' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: fetchFake }],
        [catalogApiRef, { getEntities: async () => ({ items: entities }) }],
      ]}
    >
      {children}
    </TestApiProvider>,
    route ? { routeEntries: [route] } : undefined,
  );
const posted = (path: string) => posts.find(p => p.url.endsWith(path))?.body;

describe('Interconnection in the Platform console', () => {
  beforeEach(() => {
    zoneAnswer = interView;
    policyAnswer = interPolicy;
    posts.length = 0;
  });

  it('Zones and segregations: the kind of each one, Remove by pull request or why not, no creation form', async () => {
    await wrap(<PlatformPage />);
    const a400m = await screen.findByTestId('seg-nato/a400m');
    expect(within(a400m).getByText('Programme')).toBeInTheDocument();
    expect(within(screen.getByTestId('seg-nato/landing')).getByText('Landing · core')).toBeInTheDocument();
    expect(within(screen.getByTestId('seg-nato/common')).getByText('Common')).toBeInTheDocument();
    expect(within(screen.getByTestId('seg-nato/common')).getByText('Removed with the last segregation of the zone')).toBeInTheDocument();
    expect(within(screen.getByTestId('seg-nato/sirtap')).getByText('The programme of this console: not removed from here')).toBeInTheDocument();
    expect(await screen.findByText('It has 3 component(s): delete them in Interconnection')).toBeInTheDocument();
    expect(screen.getByText('2 programme(s) · 1 common · 1 landing')).toBeInTheDocument();
    expect(screen.getByText('Reserved')).toBeInTheDocument(); // diflim
    expect(screen.queryByRole('button', { name: 'New segregation' })).toBeNull();
    expect(screen.queryByLabelText(/Programme/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove nato/a400m' }));
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(posted('/infra/segregations/delete')).toEqual({ zone: 'nato', program: 'a400m' }));
    expect(await screen.findByText(/Pull request #9 opened: once merged, the host removes nato\/a400m/)).toBeInTheDocument();
  });

  it('Marketplace › Segregations: a zone that has its landing zone gets neither a second one nor an integration zone', async () => {
    await wrap(<MarketplacePage />);
    expect(await screen.findByText('Core site')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(x => x.textContent)).toEqual(['1 · Segregations', '2 · Kubernetes clusters', '3 · Interconnection components']);
    // nato already has its landing zone: neither of the two is left to pick, each with its reason
    expect(screen.getByText('nato/landing already exists')).toBeInTheDocument();
    expect(screen.getByText('nato already has its landing zone: a zone holds a landing zone or an integration zone, never both')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Create this segregation' })).toHaveLength(0);
    // a reserved name cannot be asked as a programme
    fireEvent.change(screen.getByLabelText(/Programme/), { target: { value: 'common' } });
    expect(screen.getByText('nato/common already exists')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Programme/), { target: { value: 'integration' } });
    expect(screen.getByText('integration is a reserved name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the pull request' })).toBeDisabled();
  });

  it('Marketplace › Segregations: a zone with neither offers the landing zone and the integration zone, on any site', async () => {
    // only diflim in the catalog: reserved and empty, on a core site
    zoneAnswer = { ...interView, catalog: interView.catalog!.filter(c => c.name === 'diflim') };
    await wrap(<MarketplacePage />);
    expect(await screen.findByText('Core site')).toBeInTheDocument();
    // programme is chosen: the landing zone and the integration zone are left to pick
    const pick = screen.getAllByRole('button', { name: 'Create this segregation' });
    expect(pick).toHaveLength(2);
    fireEvent.click(pick[1]);
    const name = screen.getByLabelText('Name (fixed)');
    expect(name).toHaveValue('integration');
    expect(name).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open the pull request' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posted('/infra/segregations')).toEqual({ zone: 'diflim', program: 'integration', kind: 'integration' }));
  });

  it('Marketplace › Segregations: the first segregation of a zone says it also creates its common', async () => {
    // only diflim in the catalog: reserved and empty
    zoneAnswer = { ...interView, catalog: interView.catalog!.filter(c => c.name === 'diflim') };
    await wrap(<MarketplacePage />);
    expect(await screen.findByText(/The first segregation of diflim: the pull request also creates diflim\/common/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Programme/), { target: { value: 'efa' } });
    expect(screen.getByText('diflim/efa · n=2 · enables the zone')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open the pull request' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posted('/infra/segregations')).toEqual({ zone: 'diflim', program: 'efa', kind: 'programme' }));
  });

  it('Marketplace › Kubernetes clusters: only programme segregations are offered', async () => {
    await wrap(<MarketplacePage />, '/?tab=clusters');
    expect(await screen.findByText('OneKE · minimal')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open the pull request' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    // nato/a400m: not nato/landing nor nato/common, which have no cluster either
    await waitFor(() => expect(posted('/infra/clusters')).toEqual({ zone: 'nato', program: 'a400m', profile: 'minimal' }));
  });

  it('Marketplace › Interconnection components: fixed image, sizes of the policy, the name it will get', async () => {
    await wrap(<MarketplacePage />, '/?tab=components');
    expect(await screen.findByText('APISIX + Coraza')).toBeInTheDocument();
    expect(screen.getByText('SFTPGo')).toBeInTheDocument();
    expect(screen.getByText('Kafka')).toBeInTheDocument();
    expect(screen.getByDisplayValue('refresquito-apisix-coraza-ubuntu2404-0.1.4')).toHaveAttribute('readonly');
    // apisix-u2m-0 is in git: the next U2M gateway is 1
    expect(screen.getByText('vm-nato-landing-apisix-u2m-1')).toBeInTheDocument();
    expect(screen.getByText(/limits of the zone: 6 VMs, 16 vCPU, 32 GiB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posted('/zone/vms')).toEqual({ zone: 'nato', program: 'landing', component: 'apisix', traffic: 'u2m', cpu: 2, memory_mb: 4096, disk_gb: 20 }));
    expect(await screen.findByText(/Pull request #9 opened for apisix-u2m-1 in nato\/landing/)).toBeInTheDocument();
    // Kafka: no traffic, its own disk list, and kafka-0 exists
    fireEvent.click(screen.getAllByRole('button', { name: 'Create this component' })[1]);
    expect(screen.getByDisplayValue('refresquito-kafka-ubuntu2404-0.1.0')).toBeInTheDocument();
    expect(screen.getByText('vm-nato-landing-kafka-1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Traffic')).toBeNull();
    // the requests list covers the components
    expect(screen.getByText('#131')).toBeInTheDocument();
    expect(screen.getByText('New component')).toBeInTheDocument();
  });

  it('Marketplace › Interconnection components: says so while the chart has no components', async () => {
    policyAnswer = { ...interPolicy, components: undefined, component_limits: undefined };
    await wrap(<MarketplacePage />, '/?tab=components');
    expect(await screen.findByText('Interconnection components are not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the pull request' })).toBeNull();
  });

  it('Marketplace › Interconnection components: asks for a landing or integration zone first', async () => {
    zoneAnswer = { ...interView, catalog: interView.catalog!.map(c => ({ ...c, programs: c.programs.filter(p => p.name !== 'landing') })), zones: interView.zones.map(z => ({ ...z, programs: z.programs.filter(p => p.name !== 'landing') })) };
    await wrap(<MarketplacePage />, '/?tab=components');
    expect(await screen.findByText('No landing or integration zone yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a landing or integration zone' })).toBeInTheDocument();
  });

  it('Kubernetes clusters: Open, Scale and Delete after typing the name; never the cluster of this console', async () => {
    zoneAnswer = { ...interView, zones: interView.zones.map(z => ({ ...z, programs: z.programs.map(p => (p.name === 'a400m' ? { ...p, cluster: { name: 'oneke-nato-a400m', state: 'RUNNING', roles: { master: 1 } } } : p)) })) };
    await wrap(<ClustersPage />);
    expect(await screen.findByRole('button', { name: 'Delete oneke-nato-sirtap' })).toBeDisabled();
    expect(await screen.findByText('The cluster of this console is not deleted from here')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Scale' })).toHaveLength(2);
    // a landing zone and common never get a cluster: they are not listed as missing one
    expect(screen.queryByText('nato/landing')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete oneke-nato-a400m' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Delete oneke-nato-a400m' }));
    const dialog = screen.getByRole('alertdialog');
    const open = within(dialog).getByRole('button', { name: 'Open the pull request' });
    expect(open).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Type oneke-nato-a400m to confirm'), { target: { value: 'oneke-nato-a400m' } });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    await waitFor(() => expect(posted('/infra/clusters/delete')).toEqual({ zone: 'nato', program: 'a400m' }));
    expect(await screen.findByText(/Pull request #9 opened: once merged, the host deletes the cluster of nato\/a400m/)).toBeInTheDocument();
  });

  it('Interconnection: the path with what is missing, the components and Delete by pull request', async () => {
    await wrap(<InterconnectionPage />);
    expect(await screen.findByText('vm-nato-landing-kafka-0')).toBeInTheDocument();
    expect(screen.getByText('nato/landing has no M2M gateway: the services of the edges cannot reach the core')).toBeInTheDocument();
    expect(await screen.findByText('1 / 3')).toBeInTheDocument(); // components running
    const path = screen.getByRole('group', { name: 'Path between edge and core through nato/landing' });
    const m2m = path.querySelector('[data-lane="m2m"]') as HTMLElement;
    expect(within(m2m).getByText('Not created')).toBeInTheDocument(); // the M2M gateway of the landing zone
    expect(within(m2m).getByText('Waiting for room')).toBeInTheDocument(); // Kafka
    expect(within(m2m).getByText('Not built yet')).toBeInTheDocument(); // the IPsec tunnel
    const u2m = path.querySelector('[data-lane="u2m"]') as HTMLElement;
    expect(within(u2m).getByText('VIP 10.102.1.200')).toBeInTheDocument();
    expect(within(path).getByText(/nato\/common exists, without a ClamAV VM yet/)).toBeInTheDocument();
    // the edges are another OpenNebula: nothing invented
    expect(screen.getAllByText('No edge site connected yet.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete vm-nato-landing-kafka-0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(posted('/zone/vms/delete')).toEqual({ zone: 'nato', program: 'landing', name: 'kafka-0' }));
  });

  it('Platform overview: the segregations by kind, the interconnection and what needs attention', async () => {
    await wrap(<PlatformOverviewPage />);
    expect(await screen.findByText('2 programme(s) · 1 common · 1 landing')).toBeInTheDocument();
    expect(await screen.findByText('nato/landing has no M2M gateway: the services of the edges cannot reach the core')).toBeInTheDocument();
    expect(await screen.findByText('vm-nato-landing-kafka-0 waits for room in the hosts')).toBeInTheDocument();
    expect(screen.getByText('nato/a400m has no cluster')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Interconnection' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(x => x.textContent)).toEqual(['Summary', 'Architecture']);
  });

  it('Platform overview › Architecture: the site, a lane per zone, its segregations and the other site as a placeholder', async () => {
    await wrap(<PlatformOverviewPage />, '/?tab=architecture');
    const arch = await screen.findByRole('group', { name: 'Architecture of the platform' });
    expect(Array.from(arch.querySelectorAll('[data-zone]')).map(z => z.getAttribute('data-zone'))).toEqual(['nato', 'diflim']);
    expect(within(arch).getByText('vr-nato')).toBeInTheDocument();
    expect(Array.from(arch.querySelectorAll('[data-seg]')).map(s => s.getAttribute('data-seg'))).toEqual(['nato/sirtap', 'nato/a400m', 'nato/landing', 'nato/common']);
    expect(arch.querySelector('[data-seg="nato/sirtap"]')).toHaveTextContent('10.102.1.200 · oneke-nato-sirtap');
    expect(arch.querySelector('[data-seg="nato/sirtap"]')).toHaveTextContent('2 master(s)');
    const landing = arch.querySelector('[data-seg="nato/landing"]') as HTMLElement;
    expect(within(landing).getByText('APISIX M2M').closest('[data-dashed]')).not.toBeNull(); // missing: dashed
    await waitFor(() => expect(within(landing).getByText('APISIX U2M').closest('[data-dashed]')).toBeNull());
    expect(within(arch.querySelector('[data-seg="nato/common"]') as HTMLElement).getByText('ClamAV').closest('[data-dashed]')).not.toBeNull();
    expect(arch.querySelector('[data-site="core"]')).toHaveTextContent('Core site · refresquito · 16 vCPU · 62.5 GiB');
    expect(arch.querySelector('[data-site="remote"]')).toHaveTextContent('No edge site connected yet.');
    expect(arch.querySelectorAll('[data-flow="moving"]').length).toBeGreaterThan(0);
  });

  it('Cluster overview › Architecture: what is deployed by the bands of the catalogue, each piece with its namespace', async () => {
    await wrap(<ClusterOverviewPage />, '/?tab=architecture');
    const arch = await screen.findByRole('group', { name: 'Architecture of the cluster' });
    expect(await within(arch).findByText('iam')).toBeInTheDocument();
    expect(Array.from(arch.querySelectorAll('[data-band]')).map(b => b.getAttribute('data-band'))).toEqual(['biz', 'app', 'dat', 'ops', 'dev', 'obs', 'sec', 'inf', 'fwk']);
    const sec = arch.querySelector('[data-band="sec"]') as HTMLElement;
    expect(within(sec).getByText('ns nato-sirtap-iam-oneke')).toBeInTheDocument();
    expect(within(sec).getByText('Keycloak 26.5')).toBeInTheDocument();
    expect(sec.querySelector('[data-tile="wazuh"]')).toHaveAttribute('data-health', 'bad');
    expect(within(arch.querySelector('[data-band="biz"]') as HTMLElement).getByText('ns nato-sirtap-petstore')).toBeInTheDocument();
    // segments runs cluster-wide: it says it has no namespace
    expect(within(arch.querySelector('[data-band="inf"]') as HTMLElement).getByText('no namespace of its own')).toBeInTheDocument();
    await waitFor(() => expect(arch.querySelector('[data-entry]')).toHaveTextContent('10.102.1.200'));
    expect(arch.querySelector('[data-nodes]')).toHaveTextContent('10.0.0.1');
    expect(arch.querySelectorAll('[data-node]')).toHaveLength(2);
  });
});
