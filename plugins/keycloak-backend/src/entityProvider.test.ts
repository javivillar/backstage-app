import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import { KeycloakEntityProvider, groupEntityName } from './entityProvider';

const config = new ConfigReader({
  keycloakAdmin: { baseUrl: 'http://kc', realm: 'R', clientId: 'sa', clientSecret: 's' },
});

type Route = (url: URL) => unknown;

/** a fake Keycloak admin API: answers by path, pages with first/max like Keycloak */
function fakeKeycloak(data: {
  groups: { id: string; name: string; path: string; children?: string[] }[];
  users: { id: string; username: string; firstName?: string; email?: string }[];
  members: Record<string, string[]>;
}) {
  const page = <T,>(url: URL, all: T[]) => {
    const first = Number(url.searchParams.get('first') ?? 0);
    const max = Number(url.searchParams.get('max') ?? 10); // Keycloak's default for children
    return all.slice(first, first + max);
  };
  const byId = new Map(data.groups.map(g => [g.id, g]));
  const roots = data.groups.filter(g => g.path.split('/').filter(Boolean).length === 1);
  const routes: [RegExp, Route][] = [
    [/\/protocol\/openid-connect\/token$/, () => ({ access_token: 't', expires_in: 300 })],
    [/\/admin\/realms\/R\/groups$/, u => page(u, roots)],
    [/\/admin\/realms\/R\/groups\/([^/]+)\/children$/, u => {
      const id = u.pathname.split('/')[5];
      return page(u, (byId.get(id)?.children ?? []).map(c => byId.get(c)!));
    }],
    [/\/admin\/realms\/R\/groups\/([^/]+)\/members$/, u => {
      const id = u.pathname.split('/')[5];
      return page(u, (data.members[id] ?? []).map(n => data.users.find(x => x.username === n)!));
    }],
    [/\/admin\/realms\/R\/users$/, u => page(u, data.users)],
  ];
  return jest.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const route = routes.find(([re]) => re.test(url.pathname));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route[1](url)), { status: 200 });
  });
}

describe('KeycloakEntityProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('names a subgroup by its path, so a subgroup named as its parent does not collide', () => {
    expect(groupEntityName('/backstage-admin')).toBe('backstage-admin');
    expect(groupEntityName('/atlas-admin/atlas-admin')).toBe('atlas-admin.atlas-admin');
    expect(groupEntityName('/a b/c@d')).toBe('a_b.c_d');
  });

  it('syncs every group and user with members, parents and children, past the first page', async () => {
    // 12 children of one group: more than the 10 Keycloak gives without max
    const kids = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, name: `kid${i}`, path: `/team/kid${i}` }));
    global.fetch = fakeKeycloak({
      groups: [
        { id: 'g1', name: 'backstage-admin', path: '/backstage-admin' },
        { id: 'g2', name: 'atlas-admin', path: '/atlas-admin', children: ['g3'] },
        { id: 'g3', name: 'atlas-admin', path: '/atlas-admin/atlas-admin' },
        { id: 'g4', name: 'team', path: '/team', children: kids.map(k => k.id) },
        ...kids,
      ],
      users: [
        { id: 'u1', username: 'javi', firstName: 'Javier', email: 'j@example.org' },
        { id: 'u2', username: 'ana' },
      ],
      members: { g1: ['javi'], g3: ['ana'], k11: ['ana'] },
    }) as unknown as typeof fetch;

    const applyMutation = jest.fn();
    const provider = new KeycloakEntityProvider(config, mockServices.logger.mock(), {
      run: async ({ fn }: { fn: () => Promise<void> }) => fn(),
    } as any);
    await provider.connect({ applyMutation, refresh: jest.fn() } as unknown as EntityProviderConnection);

    expect(applyMutation).toHaveBeenCalledTimes(1);
    const { type, entities } = applyMutation.mock.calls[0][0];
    expect(type).toBe('full');
    const all = entities.map((e: any) => e.entity);
    const refs = all.map((e: any) => `${e.kind}:${e.metadata.name}`);
    expect(new Set(refs).size).toBe(refs.length); // no two entities with one name
    expect(all.filter((e: any) => e.kind === 'Group')).toHaveLength(4 + kids.length);

    const get = (kind: string, name: string) => all.find((e: any) => e.kind === kind && e.metadata.name === name);
    expect(get('Group', 'backstage-admin').spec.members).toEqual(['user:default/javi']);
    expect(get('Group', 'atlas-admin').spec.children).toEqual(['group:default/atlas-admin.atlas-admin']);
    expect(get('Group', 'atlas-admin.atlas-admin').spec.parent).toBe('group:default/atlas-admin');
    expect(get('Group', 'team').spec.children).toHaveLength(12);
    expect(get('User', 'javi').spec).toEqual({
      profile: { displayName: 'Javier', email: 'j@example.org' },
      memberOf: ['group:default/backstage-admin'],
    });
    expect(get('User', 'ana').spec.memberOf.sort()).toEqual(['group:default/atlas-admin.atlas-admin', 'group:default/team.kid11']);
  });

  it('does not apply a partial catalog when Keycloak fails', async () => {
    global.fetch = jest.fn(async (input: string | URL) =>
      String(input).endsWith('/token')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 300 }))
        : new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const applyMutation = jest.fn();
    const logger = mockServices.logger.mock();
    const provider = new KeycloakEntityProvider(config, logger, {
      run: async ({ fn }: { fn: () => Promise<void> }) => fn(),
    } as any);
    await provider.connect({ applyMutation, refresh: jest.fn() } as unknown as EntityProviderConnection);
    expect(applyMutation).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
