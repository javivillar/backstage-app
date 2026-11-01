import { configApiRef, discoveryApiRef, fetchApiRef, identityApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { useEntity } from '@backstage/plugin-catalog-react';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { ConsoleRouter } from './ConsoleRouter';

const identity = (refs: string[]) => ({
  getBackstageIdentity: async () => ({ type: 'user' as const, userEntityRef: 'user:default/ana', ownershipEntityRefs: refs }),
  getProfileInfo: async () => ({}),
  getCredentials: async () => ({}),
  signOut: async () => {},
});

const petstore = {
  kind: 'Component',
  metadata: { name: 'petstore', namespace: 'default', annotations: { 'refresquito.io/application': 'petstore' } },
  spec: { owner: 'group:default/sirtap-dev', lifecycle: 'production' },
};

const catalog = {
  getEntityByRef: async ({ name }: { name: string }) => (name === 'petstore' ? petstore : undefined),
  getEntities: async ({ filter }: { filter: { kind: string } }) => ({
    items:
      filter.kind === 'api'
        ? [{ metadata: { name: 'petstore-api' } }]
        : [
            { kind: 'Component', metadata: { name: 'petstore', annotations: { 'refresquito.io/application': 'petstore' }, labels: { 'refresquito.io/segment': 'business-support' } } },
            { kind: 'Component', metadata: { name: 'iam-oneke', labels: { 'refresquito.io/segment': 'iam' } } },
          ],
  }),
};

const Cards = () => {
  const { entity } = useEntity();
  return <a href="/catalog/default/api/petstore-api">cards of {entity.metadata.name}</a>;
};

const render = (consoleCfg: object, refs: string[] = ['user:default/ana'], route = '/') =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: consoleCfg })],
        [identityApiRef, identity(refs)],
        [catalogApiRef, catalog],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: async () => new Response(JSON.stringify({ error: 'not in this test' }), { status: 503 }) }],
      ]}
    >
      <ConsoleRouter
        entityContent={<Cards />}
        pages={[{ id: 'costs', title: 'Costs', layer: 'portal', classicPath: '/costs', element: <p>costs page</p> }]}
      />
    </TestApiProvider>,
    { routeEntries: [route] },
  );

describe('ConsoleRouter', () => {
  it('is off by default: the portal works as always', async () => {
    await render({});
    expect(await screen.findByText('The console is not enabled in this portal')).toBeInTheDocument();
  });

  it('keeps out users outside allowedGroups', async () => {
    await render({ enabled: true, allowedGroups: ['console-beta'] });
    expect(await screen.findByText('The console is in beta')).toBeInTheDocument();
  });

  it('shows business applications apart from Refresquito services', async () => {
    await render(
      { enabled: true, allowedGroups: ['console-beta'], cluster: { id: 'nato-sirtap', kind: 'program', zone: 'nato', program: 'sirtap' } },
      ['user:default/ana', 'group:default/console-beta'],
    );
    expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument();
    expect(screen.getByText('petstore').closest('a')).toHaveAttribute('href', '/console/entity/default/component/petstore');
    expect(screen.getByText('iam-oneke')).toBeInTheDocument();
    // a programme cluster has no infrastructure layer
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();
  });

  it('shows the classic entity cards under the console header', async () => {
    await render(
      { enabled: true, allowedGroups: ['console-beta'], cluster: { id: 'nato-sirtap', kind: 'program' } },
      ['user:default/ana', 'group:default/console-beta'],
      '/entity/default/component/petstore',
    );
    expect(await screen.findByText('cards of petstore')).toBeInTheDocument();
    expect(screen.getByText('Business application')).toBeInTheDocument();
    expect(screen.getByText('Open in the classic portal')).toHaveAttribute('href', '/catalog/default/component/petstore');
  });

  it('shows classic pages in the console menu and under its header', async () => {
    await render(
      { enabled: true, allowedGroups: ['console-beta'], cluster: { id: 'nato-sirtap', kind: 'program' } },
      ['user:default/ana', 'group:default/console-beta'],
      '/costs',
    );
    expect(await screen.findByText('costs page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Costs' })).toBeInTheDocument();
    expect(screen.getByText('Open in the classic portal')).toHaveAttribute('href', '/costs');
  });

  it('shows one layer at a time and moves between them', async () => {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [configApiRef, new MockConfigApi({ console: { enabled: true, allowedGroups: ['console-beta'], cluster: { id: 'nato-sirtap', kind: 'program', zone: 'nato', program: 'sirtap' } } })],
          [identityApiRef, identity(['user:default/ana', 'group:default/console-beta'])],
          [catalogApiRef, catalog],
          [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
          [fetchApiRef, { fetch: async () => new Response(JSON.stringify({ error: 'not in this test' }), { status: 503 }) }],
        ]}
      >
        <Routes>
          <Route path="/console/*" element={<ConsoleRouter />} />
        </Routes>
      </TestApiProvider>,
      { routeEntries: ['/console/cluster'] },
    );
    expect(await screen.findByRole('note', { name: 'Layer: Kubernetes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the portal' })).toBeInTheDocument();
    // the menu of the cluster layer only
    expect(screen.queryByRole('link', { name: 'Virtual machines' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zone\s*nato/ })).toBeInTheDocument();
  });
});
