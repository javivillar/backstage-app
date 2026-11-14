import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PricesPage } from './PricesPage';

const pricing = {
  description: 'Example prices', cpuPerCoreHour: 0.0205, ramPerGiBHour: 0.0027, storagePerGiBHour: 0.0001, gpuPerHour: 0, gpuNodeLabel: '',
  spot: { cpuPerCoreHour: 0.0205, ramPerGiBHour: 0.0027, nodeLabel: '' }, network: { zoneEgressPerGiB: 0, regionEgressPerGiB: 0, internetEgressPerGiB: 0, gatewayEgressPerGiB: 0, gatewayIngressPerGiB: 0 },
  loadBalancer: { perHour: 0 }, discount: { sustainedUse: 0, negotiated: 0 }, perDeployment: 0.5, perIncident: { P1: 50, P2: 25, P3: 10, P4: 5 },
  assistants: [{ model: 'claude-sonnet', inputPerMillion: 2.8, outputPerMillion: 14 }, { model: '*', runner: 'api', perHour: 0.4 }],
};
const flat = {
  cpuPerCoreHour: 0.0205, ramPerGiBHour: 0.003, storagePerGiBHour: 0.0001, gpuPerHour: 0, gpuNodeLabel: '', 'spot.cpuPerCoreHour': 0.0205, 'spot.ramPerGiBHour': 0.0027, 'spot.nodeLabel': '',
  'network.zoneEgressPerGiB': 0, 'network.regionEgressPerGiB': 0, 'network.internetEgressPerGiB': 0, 'network.gatewayEgressPerGiB': 0, 'network.gatewayIngressPerGiB': 0, 'loadBalancer.perHour': 0,
  'discount.sustainedUse': 0, 'discount.negotiated': 0, perDeployment: 0.5, 'perIncident.P1': 50, 'perIncident.P2': 25, 'perIncident.P3': 10, 'perIncident.P4': 5,
  'assistants.claude-sonnet.inputPerMillion': 2.8, 'assistants.claude-sonnet.outputPerMillion': 14, 'assistants.*@api.perHour': 0.4,
};
let answer: { status: number; body: unknown };
const posts: unknown[] = [];
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  if (!String(url).endsWith('/api/costs/prices')) return new Response('{}', { status: 404 });
  if (init?.method === 'POST') {
    posts.push(JSON.parse(String(init.body)));
    return new Response('{"pull":{"number":12,"url":"https://github.com/x/pull/12"},"version":"0.2.121"}');
  }
  return new Response(JSON.stringify(answer.body), { status: answer.status });
};
const show = () =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ opencost: { currency: 'EUR', pricing } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: fetchFake }],
      ]}
    >
      <PricesPage />
    </TestApiProvider>,
  );
const repo = (may: boolean) => ({ status: 200, body: { may, groups: ['backstage-admin', 'finops'], repo: 'o/services', path: 'charts/cnoe-oneke/values.yaml', url: 'https://github.com/o/services/blob/main/charts/cnoe-oneke/values.yaml', version: '0.2.120', currency: 'EUR', description: 'Example prices', prices: flat } });
const section = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement;

beforeEach(() => {
  posts.length = 0;
  answer = repo(true);
});

describe('FinOps › Prices', () => {
  it('lists every price by group, with what is charged today and what is not', async () => {
    await show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change prices' })).toBeInTheDocument());
    const compute = within(section('Compute'));
    expect(compute.getByText('2 of 7 in use')).toBeInTheDocument();
    expect(compute.getByText('Charged by OpenCost')).toBeInTheDocument();
    expect(compute.getByText('cpuPerCoreHour')).toBeInTheDocument();
    expect(compute.getByText('OpenCost: CPU')).toBeInTheDocument();
    // memory: the repository has a price that is not deployed yet
    expect(compute.getByText('In the repository: 0.003 · not deployed yet')).toBeInTheDocument();
    expect(within(section('Platform services')).getAllByText('In use')).toHaveLength(5);
    expect(within(section('Assistants')).getByText('claude-sonnet · input')).toBeInTheDocument();
    expect(within(section('Network')).getAllByText('Not used')).toHaveLength(5);
    // everything OpenCost offers is in view, also what is no price of ours
    expect(screen.getByRole('heading', { name: 'Price list by node and volume' })).toBeInTheDocument();
    expect(screen.getByText('Carbon estimate')).toBeInTheDocument();
    expect(screen.getByText('Cloud provider bill')).toBeInTheDocument();
    // the example application: 2 vCPU, 4 GiB, 20 GiB of disk
    expect(screen.getByText(/58\.67/)).toBeInTheDocument();
  });

  it('filters by state and by any text', async () => {
    await show();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Network' })).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole('group', { name: 'Prices shown' })).getByRole('button', { name: /In use/ }));
    expect(screen.queryByRole('heading', { name: 'Network' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Price list by node and volume' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Prices shown' })).getByRole('button', { name: /All/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search a price' }), { target: { value: 'token' } });
    expect(screen.getByRole('heading', { name: 'Assistants' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Compute' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search a price' }), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No price matches')).toBeInTheDocument();
  });

  it('changes prices with a pull request: type, review, open', async () => {
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Change prices' }));
    const review = screen.getByRole('button', { name: 'Review the pull request' });
    expect(review).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'CPU, vCPU · hour' }), { target: { value: '0,024' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'GPU, GPU · hour' }), { target: { value: 'abc' } });
    expect(screen.getByText('Not a valid value')).toBeInTheDocument();
    expect(review).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'GPU, GPU · hour' }), { target: { value: '0.85' } });
    // a price typed back to what the repository has is no change
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory, GiB · hour' }), { target: { value: '0.003' } });
    expect(screen.getByText('2 prices changed')).toBeInTheDocument();
    // the example application moves with the draft: 2 vCPU × 730 h × (0.024 − 0.0205)
    expect(screen.getByText(/63\.78/)).toBeInTheDocument();
    expect(screen.getByText(/^today .*58\.67/)).toBeInTheDocument();
    fireEvent.click(review);
    expect(screen.getByText('2 prices change')).toBeInTheDocument();
    expect(screen.getByText('o/services · charts/cnoe-oneke/values.yaml · chart 0.2.120, one patch version up')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(screen.getByText('Pull request #12 opened')).toBeInTheDocument());
    expect(posts).toEqual([{ changes: { cpuPerCoreHour: 0.024, gpuPerHour: 0.85 } }]);
    expect(screen.getByRole('link', { name: /See it on GitHub/ })).toHaveAttribute('href', 'https://github.com/x/pull/12');
  });

  it('only shows the prices to who may not change them, and when the repository does not answer', async () => {
    answer = repo(false);
    const first = await show();
    await waitFor(() => expect(screen.getByText('Only backstage-admin, finops may change the prices')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Change prices' })).not.toBeInTheDocument();
    first.unmount();
    answer = { status: 502, body: { error: 'GitHub answered 401' } };
    await show();
    await waitFor(() => expect(screen.getByText('The prices of the repository could not be read')).toBeInTheDocument());
    expect(screen.getByText(/GitHub answered 401/)).toBeInTheDocument();
    expect(within(section('Compute')).getAllByText('0.0205')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Change prices' })).not.toBeInTheDocument();
  });
});
