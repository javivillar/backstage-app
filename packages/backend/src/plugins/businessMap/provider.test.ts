import { BusinessMapEntityProvider, LOCATION_KEY, providerEntities } from './provider';

// made-up files
const SRC = { repo: 'acme/services', branch: 'main' };
const DOMAIN = 'apiVersion: backstage.io/v1alpha1\nkind: Domain\nmetadata: { name: sales, namespace: acme }\nspec: { type: business-area, owner: group:default/x }\n';
const PROCESS = 'apiVersion: refresquito.io/v1alpha1\nkind: BusinessProcess\nmetadata: { name: sell, namespace: acme }\nspec: { owner: group:default/x, domain: sales, criticality: standard }\n';

describe('providerEntities', () => {
  it('the entities of every file, with where each one is', () => {
    const { entities, skipped } = providerEntities(
      [
        { path: 'catalog/business-map/acme/domain-sales.yaml', text: DOMAIN },
        { path: 'catalog/business-map/acme/process-sell.yaml', text: `${PROCESS}---\n` },
      ],
      SRC,
    );
    expect(skipped).toEqual([]);
    expect(entities.map(e => `${e.kind}:${e.metadata.namespace}/${e.metadata.name}`)).toEqual(['Domain:acme/sales', 'BusinessProcess:acme/sell']);
    expect(entities[1].metadata.annotations).toEqual({
      'backstage.io/managed-by-location': 'url:https://github.com/acme/services/blob/main/catalog/business-map/acme/process-sell.yaml',
      'backstage.io/managed-by-origin-location': 'url:https://github.com/acme/services/blob/main/catalog/business-map/acme/process-sell.yaml',
      'backstage.io/view-url': 'https://github.com/acme/services/blob/main/catalog/business-map/acme/process-sell.yaml',
      'backstage.io/edit-url': 'https://github.com/acme/services/edit/main/catalog/business-map/acme/process-sell.yaml',
    });
  });
  it('one bad file or document does not drop the rest', () => {
    const { entities, skipped } = providerEntities(
      [
        { path: 'a/bad.yaml', text: 'kind: [unclosed\n' },
        { path: 'a/other.yaml', text: 'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata: { name: x }\n' },
        { path: 'a/half.yaml', text: `${DOMAIN}---\nfoo: bar\n` },
        { path: 'a/again.yaml', text: DOMAIN },
      ],
      SRC,
    );
    expect(entities.map(e => e.metadata.name)).toEqual(['sales']);
    expect(skipped.map(s => s.path)).toEqual(['a/bad.yaml', 'a/other.yaml', 'a/half.yaml (document 2)', 'a/again.yaml']);
    expect(skipped[1].reason).toBe('Component is none of Domain, BusinessProcess, ReferenceModel');
    expect(skipped[3].reason).toBe('domain:acme/sales is also in a/half.yaml (document 1)');
  });
});

describe('BusinessMapEntityProvider', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger } as never;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
  const tree = {
    data: {
      repository: {
        object: {
          entries: [
            {
              name: 'acme',
              type: 'tree',
              object: {
                entries: [
                  { name: 'domain-sales.yaml', type: 'blob', object: { text: DOMAIN, isTruncated: false } },
                  { name: 'process-sell.yaml', type: 'blob', object: { text: null, isTruncated: true } },
                  { name: 'README.md', type: 'blob', object: { text: '#', isTruncated: false } },
                ],
              },
            },
          ],
        },
      },
    },
  };
  const setup = (answers: Array<() => Response>) => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(String(url));
      return answers.shift()!();
    }) as unknown as typeof fetch;
    const mutations: unknown[] = [];
    const p = new BusinessMapEntityProvider({ ...SRC, fetchFn }, logger);
    return { p, calls, mutations, connect: () => p.connect({ applyMutation: async (m: unknown) => void mutations.push(m), refresh: async () => {} } as never) };
  };
  it('one GraphQL query for the tree (and the one file GitHub gives no text of), a full mutation', async () => {
    const s = setup([() => json(200, tree), () => new Response(PROCESS, { status: 200 })]);
    await s.connect();
    expect(await s.p.refresh()).toBe('applied');
    expect(s.calls).toEqual(['https://api.github.com/graphql', 'https://api.github.com/repos/acme/services/contents/catalog/business-map/acme/process-sell.yaml?ref=main']);
    const m = s.mutations[0] as { type: string; entities: Array<{ entity: { metadata: { name: string } }; locationKey: string }> };
    expect(m.type).toBe('full');
    expect(m.entities.map(x => [x.entity.metadata.name, x.locationKey])).toEqual([
      ['sales', LOCATION_KEY],
      ['sell', LOCATION_KEY],
    ]);
  });
  it('skips the run (no mutation) when GitHub limits the token or answers an error', async () => {
    const limited = setup([() => json(200, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] })]);
    await limited.connect();
    expect(await limited.p.refresh()).toBe('skipped');
    const forbidden = setup([() => json(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794150000' })]);
    await forbidden.connect();
    expect(await forbidden.p.refresh()).toBe('skipped');
    const down = setup([() => json(502, {})]);
    await down.connect();
    expect(await down.p.refresh()).toBe('skipped');
    expect([limited.mutations, forbidden.mutations, down.mutations]).toEqual([[], [], []]);
  });
});
