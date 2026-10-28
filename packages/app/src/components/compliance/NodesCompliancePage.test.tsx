import '@testing-library/jest-dom';
import { fireEvent, screen, within } from '@testing-library/react';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { NodesCompliancePage } from './NodesCompliancePage';
// GET /compliance of the security exporter of wazuh-oneke 0.25.0 on the events of scripts/sca-cis-test.sh --offline
// (scan 2: a regression and a check still failing on worker-1), titles of Wazuh's policy; storage-1 made clean
import fixture from './compliance.fixture.json';

function render(body: unknown, status = 200) {
  const fetch = jest.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  return {
    fetch,
    view: renderInTestApp(
      <TestApiProvider
        apis={[
          [discoveryApiRef, { getBaseUrl: async () => 'http://backstage/api/sbom' }],
          [fetchApiRef, { fetch }],
        ]}
      >
        <NodesCompliancePage />
      </TestApiProvider>,
    ),
  };
}

describe('NodesCompliancePage', () => {
  it('shows the score in scope of each node, and the failures of the first failing node with the regression', async () => {
    const { fetch } = render({ configured: true, ...fixture });
    expect(await screen.findByText('worker-1')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('http://backstage/api/sbom/compliance');
    const nodes = screen.getByRole('table', { name: 'nodes' });
    expect(within(nodes).getAllByText('60.0 %')).toHaveLength(1);
    expect(within(nodes).getByText('100.0 %')).toBeInTheDocument();
    expect(within(nodes).getByText('41 %')).toBeInTheDocument();
    const failures = screen.getByRole('table', { name: 'failures of worker-1' });
    expect(within(failures).getByText('Ensure /tmp is a separate partition')).toBeInTheDocument();
    expect(within(failures).getByText('regression')).toBeInTheDocument();
    expect(within(failures).getByText('still failing')).toBeInTheDocument();
    fireEvent.click(within(failures).getByRole('button', { name: 'how to fix 1.1.2.1.1' }));
    expect(await screen.findByText(/Fix it in the node image/)).toBeInTheDocument();
  });

  it('lists the accepted exceptions with reason, review date and on how many nodes they fail', async () => {
    render({ configured: true, ...fixture });
    const exceptions = await screen.findByRole('table', { name: 'accepted exceptions' });
    expect(within(exceptions).getByText('4.1.7')).toBeInTheDocument();
    expect(within(exceptions).getByText(/Outgoing traffic is allowed/)).toBeInTheDocument();
    expect(within(exceptions).getByText('2027-04-28')).toBeInTheDocument();
    expect(within(exceptions).getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getByText(/checks of Level 2/)).toHaveTextContent("38 checks of Level 2");
  });

  it('says when Wazuh does not score the nodes, and shows the error of the backend', async () => {
    render({ configured: false, nodes: [] });
    expect(await screen.findByText(/Not turned on/)).toBeInTheDocument();
    render({ error: "Wazuh's CIS compliance could not be read: timeout" }, 502);
    expect(await screen.findByText(/timeout/)).toBeInTheDocument();
  });
});
