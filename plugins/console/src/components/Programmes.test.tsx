import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MarketplacePage } from './MarketplacePage';
import { ProgrammesPage } from './ProgrammesPage';

const standard = {
  name: 'standard', default: true, description: 'HA control plane', counts: { vnf: 1, master: 2, worker: 2, storage: 1 }, memoryMb: 20480,
  roles: { vnf: { vcpu: 2, memory_mb: 2048 }, master: { vcpu: 4, memory_mb: 4096 }, worker: { vcpu: 10, memory_mb: 20480 }, storage: { vcpu: 4, memory_mb: 6144 } },
  k8sCis: true, k8sPsa: 'audit', cni: 'calico', longhorn: true,
};
const prog = (zone: string, name: string, title: string, over: Record<string, unknown> = {}) => ({ zone, name, title, description: `About ${title}.`, industry: 'Air', customer: 'Air Force', customerDetail: 'Luftwaffe (DE)', nations: ['DE', 'ES'], managingBody: 'NETMA', primeContractor: 'Airbus', spain: true, confidence: 'high', ...over });
const zone = {
  generated: '2026-11-14T10:00:00Z', warnings: [], drift: [], zones: [],
  catalog: [
    { name: 'occar', label: 'OCCAR', status: 'complete', enabled: true, maxProgramN: 99, programs: [{ name: 'a400m', n: 1, declared: true, ok: true }] },
    { name: 'nato', label: 'NATO', status: 'complete', enabled: true, maxProgramN: 99, programs: [
      { name: 'sirtap', n: 1, declared: true, ok: true, cluster: 'oneke-nato-sirtap' },
      { name: 'cistest', n: 2, declared: true, ok: true, test: true },
    ] },
    { name: 'diflim', label: 'Limited distribution', status: 'reserved', enabled: false, maxProgramN: 99, programs: [] },
  ],
  programmeCatalogue: {
    industries: ['Air', 'Land'],
    programmes: [
      prog('occar', 'a400m', 'A400M', { managingBody: 'OCCAR-EA' }),
      prog('occar', 'boxer', 'Boxer', { industry: 'Land', customer: 'Army', nations: ['DE', 'NL'], managingBody: 'OCCAR-EA', primeContractor: 'ARTEC', spain: false, confidence: 'verify' }),
      prog('nato', 'efa', 'Eurofighter Typhoon (EFA)'),
      prog('diflim', 'sirtap', 'SIRTAP', { managingBody: 'DGAM', nations: ['ES'] }),
    ],
  },
  kubernetes: { profiles: [standard], defaultProfile: 'standard' },
  capacity: { freeMemoryMb: 61440 },
};
const infra = { allowed: true, repo: 'javivillar/opennebula', clusters: [], pulls: [] };
const posts: Array<{ url: string; body: unknown }> = [];
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    posts.push({ url: u, body: JSON.parse(String(init.body)) });
    return new Response('{"ok":true,"pull":{"number":9,"url":"https://github.com/x/pull/9"}}');
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
const rowsShown = () => screen.getAllByRole('row').length - 1;
const open = (label: RegExp | string) => fireEvent.mouseDown(screen.getByLabelText(label));

describe('Platform › Programmes', () => {
  it('lists the catalogue with what the platform has, and the test programmes', async () => {
    await wrap(<ProgrammesPage />);
    await waitFor(() => expect(screen.getByText('Programme catalogue')).toBeInTheDocument());
    expect(rowsShown()).toBe(5);
    expect(screen.getByRole('status')).toHaveTextContent('5 of 5 programmes (4 in the catalogue, 1 test)');
    expect(screen.getByText('Segregation occar/a400m · no cluster')).toBeInTheDocument();
    expect(screen.getByText('Runs in nato/sirtap: zone differs')).toBeInTheDocument();
    expect(screen.getAllByText('Not created')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Create cluster' })[0]).toHaveAttribute('href', '/console/infrastructure/marketplace?tab=clusters&zone=occar&programme=a400m');
    expect(screen.getAllByRole('link', { name: 'Create' })[0]).toHaveAttribute('href', '/console/infrastructure/marketplace?zone=occar&programme=boxer');
  });

  it('filters by zone and searches by any value clicked', async () => {
    await wrap(<ProgrammesPage />);
    await waitFor(() => expect(screen.getByText('Programme catalogue')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OCCAR · 2' }));
    expect(rowsShown()).toBe(2);
    // a clicked value clears the filters and matches as a whole word, in any column
    fireEvent.click(screen.getByRole('button', { name: 'All zones' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'NETMA' })[0]);
    expect(screen.getByLabelText('Search')).toHaveValue('NETMA');
    expect(rowsShown()).toBe(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'ES' })[0]);
    expect(rowsShown()).toBe(3);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'box' } });
    expect(rowsShown()).toBe(1);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No programme matches')).toBeInTheDocument();
  });
});

describe('the Marketplace with a programme catalogue', () => {
  it('offers the programmes of the zone chosen and creates the segregation of one', async () => {
    await wrap(<MarketplacePage />);
    await waitFor(() => expect(screen.getByText('Create a segregation · programme')).toBeInTheDocument());
    // occar: a400m exists, boxer is offered and described
    expect(within(screen.getByTestId('programme-card')).getByText('Boxer')).toBeInTheDocument();
    expect(within(screen.getByTestId('programme-card')).getByText('Land')).toBeInTheDocument();
    open('Zone');
    fireEvent.click(await screen.findByRole('option', { name: /NATO \(nato\) · 1 programmes/ }));
    await waitFor(() => expect(within(screen.getByTestId('programme-card')).getByText('Eurofighter Typhoon (EFA)')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/segregations'))?.body).toEqual({ zone: 'nato', program: 'efa', kind: 'programme' }));
  });

  it('creates a test programme with a typed name', async () => {
    posts.length = 0;
    await wrap(<MarketplacePage />);
    await waitFor(() => expect(screen.getByText('Create a segregation · programme')).toBeInTheDocument());
    open('Programme');
    fireEvent.click(await screen.findByRole('option', { name: 'Test programme: type a name' }));
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: 'lab1' } });
    expect(within(screen.getByTestId('programme-card')).getByText('Test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/segregations'))?.body).toEqual({ zone: 'occar', program: 'lab1', kind: 'programme', test: true }));
  });

  it('a cluster: the zone, then its programmes; one without a segregation is sent to step 1', async () => {
    posts.length = 0;
    await wrap(<MarketplacePage />, '/?tab=clusters');
    await waitFor(() => expect(screen.getByText('Create a cluster')).toBeInTheDocument());
    // occar/a400m has a segregation and no cluster: ready
    expect(within(screen.getByTestId('programme-card')).getByText('A400M')).toBeInTheDocument();
    expect(screen.getByText('The pull request adds clusters/occar-a400m.json · cluster oneke-occar-a400m.')).toBeInTheDocument();
    open('Programme');
    fireEvent.click(await screen.findByRole('option', { name: 'boxer — Boxer' }));
    await waitFor(() => expect(screen.getByText(/There is no segregation occar\/boxer yet/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open the pull request' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'create it in step 1 · Segregations' }));
    await waitFor(() => expect(screen.getByText('Create a segregation · programme')).toBeInTheDocument());
    expect(within(screen.getByTestId('programme-card')).getByText('Boxer')).toBeInTheDocument();
  });

  it('a cluster for a test programme of another zone', async () => {
    posts.length = 0;
    await wrap(<MarketplacePage />, '/?tab=clusters&zone=nato&programme=cistest');
    await waitFor(() => expect(screen.getByText('Create a cluster')).toBeInTheDocument());
    expect(within(screen.getByTestId('programme-card')).getByText('Test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/infra/clusters'))?.body).toEqual({ zone: 'nato', program: 'cistest', profile: 'standard' }));
  });
});
