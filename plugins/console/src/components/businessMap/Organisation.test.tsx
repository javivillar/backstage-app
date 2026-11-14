import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ImportOrganisationPage } from './ImportOrganisationPage';
import { OrganisationPage } from './OrganisationPage';
import { OwnershipPage } from './OwnershipPage';
import { checksOf, ProcessModel } from './ProcessModel';

// the viewer is a script Backstage serves: here a stand-in that "reads" one lane and two steps
jest.mock('./bpmnViewer', () => {
  const elements = [
    { id: 'lane', type: 'bpmn:Lane', businessObject: { name: 'Line Maintenance', flowNodeRef: [{ id: 'a' }, { id: 'b' }] } },
    { id: 'a', type: 'bpmn:UserTask', x: 1, businessObject: { name: 'Raise the defect report' } },
    { id: 'b', type: 'bpmn:ServiceTask', x: 2, businessObject: { name: 'Record the defect' } },
    { id: 's', type: 'bpmn:StartEvent' },
  ];
  class Viewer {
    async importXML(xml: string) {
      if (!xml.includes('definitions')) throw new Error('failed to parse document as <bpmn:Definitions>');
      return { warnings: [] };
    }
    get(name: string) {
      if (name === 'elementRegistry') return { filter: () => elements, get: (id: string) => elements.find(e => e.id === id) };
      if (name === 'canvas') return { zoom: () => 1, addMarker: () => undefined, removeMarker: () => undefined };
      return { on: () => undefined };
    }
    getDefinitions() {
      return { rootElements: [{ $type: 'bpmn:Process', name: 'Troubleshoot and rectify defects' }] };
    }
    destroy() {}
  }
  return { BPMN_VIEWER_PATH: '/vendor/x.js', loadBpmnViewer: async () => Viewer, nameInFile: (v: Viewer) => v.getDefinitions().rootElements[0].name };
});

const person = (name: string, user: string, inKeycloak = true, role?: string) => ({ name, user, inKeycloak, role });
const customer = {
  side: 'customer', name: 'aerospace-iberia', title: 'Aerospace Iberia', path: 'catalog/organisations/customer/aerospace-iberia.yaml',
  head: person('Elena Ruiz', 'eruiz', true, 'Services Director'),
  units: [
    { name: 'Maintenance', head: person('Raúl Méndez', 'rmendez'), teams: [{ name: 'Line Maintenance', people: [person('Diego Navarro', 'dnavarro', true, 'Station manager'), person('Alba Serrano', 'aserrano', false)] }] },
    { name: 'Logistics', teams: [{ name: 'Stores', people: [person('Víctor Reyes', 'vreyes')] }] },
  ],
  productOwners: [{ application: 'aib-etechlog', user: 'dnavarro' }],
};
const provider = {
  side: 'provider', name: 'provider', title: 'Refresquito Services', path: 'catalog/organisations/provider.yaml',
  units: [{ name: 'Products', teams: [{ name: 'Maintenance products', people: [person('Teresa Barrios', 'tbarrios')] }] }],
  productOwners: [{ application: 'aib-etechlog', user: 'tbarrios' }],
};
const org = {
  namespace: 'aerospace-iberia', may: true, keycloak: true, customer, provider,
  paths: { customer: customer.path, provider: provider.path },
  applications: [
    { name: 'aib-etechlog', title: 'Electronic Tech Log', ref: 'component:default/aib-etechlog', criticality: 'critical', processes: 6,
      customer: { user: 'dnavarro', name: 'Diego Navarro', unit: 'Maintenance', team: 'Line Maintenance', inKeycloak: true },
      provider: { user: 'tbarrios', name: 'Teresa Barrios', unit: 'Products', team: 'Maintenance products', inKeycloak: true } },
    { name: 'aib-stores', title: 'Stores and Logistics', ref: 'component:default/aib-stores', criticality: 'important', processes: 8 },
  ],
};
const map = { namespace: 'aerospace-iberia', namespaces: ['aerospace-iberia', 'nato-sirtap'], models: [], defaults: {}, domains: [], processes: [] };
let bpmn: { xml: string; path: string; url: string } | undefined;
const posts: Array<{ url: string; body: any }> = [];
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'POST') {
    posts.push({ url: u, body: JSON.parse(String(init.body)) });
    if (u.endsWith('/organisation/preview')) {
      return new Response(JSON.stringify({ organisation: customer, counts: { units: 2, teams: 2, people: 5, notInKeycloak: 1, productOwners: 1 }, keycloak: true, errors: [{ row: 7, message: 'A row needs a name and a user name.' }], replaces: true, fileName: 'org.xlsx', sheet: 'Organisation' }));
    }
    return new Response(JSON.stringify({ pull: { number: 12, url: 'https://github.com/x/pull/12' }, path: 'p' }));
  }
  if (u.includes('/organisation')) return new Response(JSON.stringify(org));
  if (u.includes('/map')) return new Response(JSON.stringify(map));
  if (u.includes('/bpmn')) return bpmn ? new Response(JSON.stringify(bpmn)) : new Response(JSON.stringify({ error: 'no model' }), { status: 404 });
  return new Response('{}', { status: 404 });
};
const wrap = (children: ReactNode, route = '/?ns=aerospace-iberia') =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ app: { baseUrl: 'http://app' } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: fetchFake }],
      ]}
    >
      {children}
    </TestApiProvider>,
    { routeEntries: [route] },
  );

describe('Business continuity › Organisation', () => {
  it('draws the organisation of the customer and the team that answers for an application', async () => {
    await wrap(<OrganisationPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Aerospace Iberia' })).toBeInTheDocument());
    expect(screen.getByText('Elena Ruiz · Services Director')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Line Maintenance/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Customer PO · 1')).toBeInTheDocument();
    expect(screen.getAllByText('1 not in Keycloak').length).toBeGreaterThan(0);
    // the team picked: its people and its application
    expect(screen.getByText('Alba Serrano')).toBeInTheDocument();
    expect(screen.getByText('Not in Keycloak')).toBeInTheDocument();
    expect(screen.getByText('Electronic Tech Log')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Stores/ }));
    await waitFor(() => expect(screen.getByText('This team is not the product owner of any business application.')).toBeInTheDocument());
  });

  it('shows the organisation of the provider', async () => {
    await wrap(<OrganisationPage />, '/?ns=aerospace-iberia&side=provider');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Refresquito Services' })).toBeInTheDocument());
    expect(screen.getByText('Provider PO · 1')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });
});

describe('Business continuity › Ownership', () => {
  it('lists both product owners of each application and its gaps', async () => {
    await wrap(<OwnershipPage />);
    await waitFor(() => expect(screen.getByText('Product owners per business application')).toBeInTheDocument());
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('No customer product owner')).toBeInTheDocument();
    expect(screen.getByText('No provider product owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gaps only' }));
    expect(screen.queryByText('Electronic Tech Log')).not.toBeInTheDocument();
    expect(screen.getByText('Stores and Logistics')).toBeInTheDocument();
  });

  it('names a product owner through a pull request', async () => {
    posts.length = 0;
    await wrap(<OwnershipPage />);
    await waitFor(() => expect(screen.getByText('Stores and Logistics')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByLabelText('Customer product owner'));
    fireEvent.click(await screen.findByRole('option', { name: /Víctor Reyes/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts.find(p => p.url.endsWith('/organisation/owner'))?.body).toEqual({ side: 'customer', namespace: 'aerospace-iberia', application: 'aib-stores', user: 'vreyes' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pull request #12 opened'));
  });
});

describe('Business continuity › Organisation › Import', () => {
  it('previews the file with who has no Keycloak user, then opens the pull request', async () => {
    posts.length = 0;
    await wrap(<ImportOrganisationPage />);
    await waitFor(() => expect(screen.getByText('2 · Choose the file')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Organisation file'), { target: { files: [new File(['x'], 'org.xlsx')] } });
    await waitFor(() => expect(screen.getByText('Preview · org.xlsx')).toBeInTheDocument());
    expect(screen.getByText(/1 people have no Keycloak user \(aserrano\)/)).toBeInTheDocument();
    expect(screen.getByText(/Row 7: A row needs a name/)).toBeInTheDocument();
    expect(posts[0].body).toMatchObject({ side: 'customer', namespace: 'aerospace-iberia', fileName: 'org.xlsx' });
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pull request #12 opened'));
    const sent = posts.find(p => p.url.endsWith('/organisation'))?.body;
    expect(sent).toMatchObject({ side: 'customer', namespace: 'aerospace-iberia' });
    expect(sent.organisation.units[0].teams[0].people[1]).toEqual({ name: 'Alba Serrano', user: 'aserrano' });
    expect(sent.organisation.path).toBeUndefined();
  });
});

describe('the model of a process', () => {
  const page = <ProcessModel namespace="aerospace-iberia" process="troubleshoot-and-rectify-defects" title="Troubleshoot and rectify defects" />;
  // the file is read by a FileReader, outside what the test library waits for: give it its turn inside act
  const choose = (file: File) =>
    act(async () => {
      fireEvent.change(screen.getByLabelText('BPMN file'), { target: { files: [file] } });
      await new Promise(r => setTimeout(r, 50));
    });

  it('draws the model kept in the repository, with its steps and their team', async () => {
    bpmn = { xml: '<definitions/>', path: 'catalog/business-map/aerospace-iberia/bpmn/troubleshoot-and-rectify-defects.bpmn', url: 'https://github.com/x' };
    await wrap(page);
    await waitFor(() => expect(screen.getByText('Steps and who does them')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Raise the defect report' })).toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
    expect(screen.getAllByText('Line Maintenance')).toHaveLength(2);
    expect(screen.queryByText('no team with this name')).not.toBeInTheDocument();
    expect(screen.getByText(bpmn.path)).toBeInTheDocument();
  });

  it('imports a model from a file for a process that has none', async () => {
    bpmn = undefined;
    posts.length = 0;
    await wrap(page);
    await waitFor(() => expect(screen.getByText('This process has no model yet')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Import from file' }));
    await choose(new File(['<definitions>…</definitions>'], 'defects.bpmn'));
    await waitFor(() => expect(screen.getByText('Valid BPMN 2.0')).toBeInTheDocument());
    expect(screen.getByText('1 lane(s) matched')).toBeInTheDocument();
    expect(screen.getByText('The file is called "Troubleshoot and rectify defects", like this process.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pull request #12 opened'));
    expect(posts.find(p => p.url.endsWith('/bpmn'))?.body).toEqual({ namespace: 'aerospace-iberia', process: 'troubleshoot-and-rectify-defects', title: 'Troubleshoot and rectify defects', fileName: 'defects.bpmn', xml: '<definitions>…</definitions>' });
  });

  it('refuses a file that is not BPMN', async () => {
    bpmn = undefined;
    await wrap(page);
    await waitFor(() => expect(screen.getByText('This process has no model yet')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Import from file' }));
    await choose(new File(['<html/>'], 'notes.bpmn'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not a BPMN file'));
    expect(screen.getByRole('button', { name: 'Open the pull request' })).toBeDisabled();
  });

  it('warns when the file names another process or a lane is no team', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? ` ${JSON.stringify(v)}` : ''}`;
    const checks = checksOf({ name: 'Receive parts', steps: [], lanes: ['Stores', 'Procurement'], gateways: 0, events: 0, warnings: 2 }, { title: 'Perform line checks', teams: ['Stores'], path: 'p' }, t);
    expect(checks.map(c => [c.tone, c.label.split(' ')[0]])).toEqual([['pos', 'bpmn.check.valid'], ['warn', 'bpmn.check.warnings'], ['pos', 'bpmn.check.matched'], ['warn', 'bpmn.check.unmatched'], ['warn', 'bpmn.check.otherName'], ['info', 'bpmn.check.pull']]);
  });
});
