import { Entity } from '@backstage/catalog-model';
import { catalogApiRef, EntityProvider } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { keycloakOIDCAuthApiRef } from '@internal/plugin-keycloak';
import {
  EntitySupportContent,
  fetchChanges,
  fetchIncidents,
  supportLinks,
  supportUrl,
} from './EntitySupportContent';

const deployment = (stage: string, url?: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: `support-${stage}-oneke`,
    annotations: {
      'refresquito.io/application': 'support',
      'refresquito.io/stage': stage,
      ...(url ? { 'refresquito.io/url': url } : {}),
    },
  },
});

const petstore: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'petstore-oneke',
    namespace: 'default',
    title: 'Pet Store',
  },
  spec: { type: 'service' },
};

const incident = {
  id: 7,
  title: 'Orders do not load',
  priority: 'P2',
  state: 'in_progress',
  requester: 'ana',
  requester_name: 'Ana',
  assignee: 'luis',
  opened_at: '2026-10-30T08:00:00Z',
};
const change = {
  id: 54,
  what: 'Upgrade the Pet Store to 2.1',
  state: 'approved',
  risk: 'medium',
  urgent: false,
  planned_on: '2026-11-03',
  requester: 'ana',
  requester_name: 'Ana',
  assignee: null,
};
const answer = (status: number, body: unknown = {}) => ({
  ok: status < 300,
  status,
  json: async () => body,
});
/** the support answers the incidents and the changes of the element, each on its own route */
const support = (incidents: unknown[], changes: unknown[]) =>
  jest.fn(async (url: string) =>
    url.includes('/changes')
      ? answer(200, changes)
      : answer(200, { items: incidents, total: incidents.length }),
  );
const keycloak = (token = 'tok') => ({
  getAccessToken: jest.fn().mockResolvedValue(token),
});

afterEach(() => {
  (global as any).fetch = undefined;
});

describe('the support of an element', () => {
  it('is the most stable stage of the support in the catalog', () => {
    expect(
      supportUrl([
        deployment('dev', 'https://support-dev.x/'),
        deployment('pro', 'https://support.x'),
      ]),
    ).toBe('https://support.x');
    expect(supportUrl([deployment('dev', 'https://support-dev.x/')])).toBe(
      'https://support-dev.x',
    );
    expect(supportUrl([deployment('pro')])).toBeNull();
    expect(supportUrl([])).toBeNull();
  });

  it('links to open an incident on the element and to its incidents', () => {
    expect(supportLinks('https://support.x', petstore)).toEqual({
      open: 'https://support.x/incidents/new?element=component%3Adefault%2Fpetstore-oneke',
      incidents:
        'https://support.x/elements/component%3Adefault/petstore-oneke',
      change:
        'https://support.x/changes/new?element=component%3Adefault%2Fpetstore-oneke',
    });
  });

  it('shows the links when the support is deployed', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(answer(200, { items: [], total: 0 }));
    const catalogApi = {
      getEntities: jest.fn().mockResolvedValue({
        items: [deployment('dev', 'https://support-dev.x')],
      }),
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [keycloakOIDCAuthApiRef, keycloak()],
        ]}
      >
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    const open = await screen.findByText('Open an incident on Pet Store');
    expect(open.closest('a')?.getAttribute('href')).toBe(
      'https://support-dev.x/incidents/new?element=component%3Adefault%2Fpetstore-oneke',
    );
    expect(
      screen
        .getByText('Its incidents not closed')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('https://support-dev.x/elements/component%3Adefault/petstore-oneke');
    expect(catalogApi.getEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          kind: 'component',
          'metadata.annotations.refresquito.io/application': 'support',
        },
      }),
    );
  });

  it('says so when the support is not deployed', async () => {
    const catalogApi = {
      getEntities: jest.fn().mockResolvedValue({ items: [] }),
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [keycloakOIDCAuthApiRef, keycloak()],
        ]}
      >
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    expect(await screen.findByText('The support is not deployed')).toBeTruthy();
  });

  it('reads the incidents not closed of the element with the token of Keycloak', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(answer(200, { items: [incident], total: 1 }));
    (global as any).fetch = fetch;
    expect(
      await fetchIncidents(
        'https://support.x',
        'component:default/petstore-oneke',
        'tok',
      ),
    ).toEqual({ items: [incident], total: 1 });
    expect(fetch).toHaveBeenCalledWith(
      'https://support.x/api/incidents?element=component%3Adefault%2Fpetstore-oneke&open=true&size=50',
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  it('says why the support refused', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(answer(401));
    await expect(fetchIncidents('https://support.x', 'r', 't')).rejects.toThrow(
      'did not accept the sign-in',
    );
    (global as any).fetch = jest.fn().mockResolvedValue(answer(403));
    await expect(fetchIncidents('https://support.x', 'r', 't')).rejects.toThrow(
      'no role in the support',
    );
  });

  it('lists the incidents, each a link to the support', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(answer(200, { items: [incident], total: 1 }));
    const catalogApi = {
      getEntities: jest.fn().mockResolvedValue({
        items: [deployment('dev', 'https://support-dev.x')],
      }),
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [keycloakOIDCAuthApiRef, keycloak()],
        ]}
      >
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    const title = await screen.findByText('Orders do not load');
    expect(title.closest('a')?.getAttribute('href')).toBe(
      'https://support-dev.x/incidents/7',
    );
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Its incidents not closed (1)')).toBeTruthy();
  });

  it('keeps the links when the support cannot be reached', async () => {
    (global as any).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const catalogApi = {
      getEntities: jest.fn().mockResolvedValue({
        items: [deployment('dev', 'https://support-dev.x')],
      }),
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [keycloakOIDCAuthApiRef, keycloak()],
        ]}
      >
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    expect(
      await screen.findByText(/The support could not be reached/),
    ).toBeTruthy();
    expect(screen.getByText('Open an incident on Pet Store')).toBeTruthy();
  });

  it('reads the changes planned on the element with the token of Keycloak', async () => {
    const fetch = jest.fn().mockResolvedValue(answer(200, [change]));
    (global as any).fetch = fetch;
    expect(
      await fetchChanges(
        'https://support.x',
        'component:default/petstore-oneke',
        'tok',
      ),
    ).toEqual([change]);
    expect(fetch).toHaveBeenCalledWith(
      'https://support.x/api/elements/component%3Adefault%2Fpetstore-oneke/changes',
      { headers: { Authorization: 'Bearer tok' } },
    );
    // an element the support does not know has no changes
    (global as any).fetch = jest.fn().mockResolvedValue(answer(404));
    expect(await fetchChanges('https://support.x', 'r', 't')).toEqual([]);
    (global as any).fetch = jest.fn().mockResolvedValue(answer(403));
    await expect(fetchChanges('https://support.x', 'r', 't')).rejects.toThrow(
      'no role in the support',
    );
  });

  it('lists the changes planned on the element and links to ask for one', async () => {
    (global as any).fetch = support([], [change]);
    const catalogApi = {
      getEntities: jest.fn().mockResolvedValue({
        items: [deployment('dev', 'https://support-dev.x')],
      }),
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [keycloakOIDCAuthApiRef, keycloak()],
        ]}
      >
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    const what = await screen.findByText('Upgrade the Pet Store to 2.1');
    expect(what.closest('a')?.getAttribute('href')).toBe(
      'https://support-dev.x/changes/54',
    );
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('Changes planned on it (1)')).toBeTruthy();
    expect(
      screen
        .getByText('Ask for a change on Pet Store')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe(
      'https://support-dev.x/changes/new?element=component%3Adefault%2Fpetstore-oneke',
    );
  });

  it('says when no change is planned on the element', async () => {
    (global as any).fetch = support([], []);
    const catalogApi = {
      getEntities: jest.fn().mockResolvedValue({
        items: [deployment('dev', 'https://support-dev.x')],
      }),
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [keycloakOIDCAuthApiRef, keycloak()],
        ]}
      >
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    expect(
      await screen.findByText('No change planned on this element.'),
    ).toBeTruthy();
  });
});
