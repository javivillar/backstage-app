import { clearFolderCache, setRetryPause } from './githubFolder';
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
  // the tree (names and blob ids), then the text of the .yaml files by id: process-sell is over GitHub's size limit
  const tree = {
    data: {
      repository: {
        object: {
          entries: [
            {
              name: 'acme',
              type: 'tree',
              oid: 't1',
              object: {
                entries: [
                  { name: 'domain-sales.yaml', type: 'blob', oid: 'd1' },
                  { name: 'process-sell.yaml', type: 'blob', oid: 'p1' },
                  { name: 'README.md', type: 'blob', oid: 'r1' },
                ],
              },
            },
          ],
        },
      },
    },
  };
  const texts = { data: { repository: { b0: { text: DOMAIN, isTruncated: false }, b1: { text: null, isTruncated: true } } } };
  beforeEach(() => {
    clearFolderCache();
    setRetryPause(0);
  });
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
  it('the tree, the text in a batch (and the one file GitHub gives no text of), a full mutation; then only the tree', async () => {
    const s = setup([() => json(200, tree), () => json(200, texts), () => new Response(PROCESS, { status: 200 }), () => json(200, tree)]);
    await s.connect();
    expect(await s.p.refresh()).toBe('applied');
    expect(s.calls).toEqual([
      'https://api.github.com/graphql',
      'https://api.github.com/graphql',
      'https://api.github.com/repos/acme/services/contents/catalog/business-map/acme/process-sell.yaml?ref=main',
    ]);
    const m = s.mutations[0] as { type: string; entities: Array<{ entity: { metadata: { name: string } }; locationKey: string }> };
    expect(m.type).toBe('full');
    expect(m.entities.map(x => [x.entity.metadata.name, x.locationKey])).toEqual([
      ['sales', LOCATION_KEY],
      ['sell', LOCATION_KEY],
    ]);
    // nothing changed: one query for the tree, the same entities
    expect(await s.p.refresh()).toBe('applied');
    expect(s.calls).toHaveLength(4);
    expect((s.mutations[1] as typeof m).entities.map(x => x.entity.metadata.name)).toEqual(['sales', 'sell']);
  });
  it('a batch GitHub gives up on (504, after trying again) is split in two', async () => {
    const slow = () => json(504, {});
    const s = setup([
      () => json(200, tree),
      slow,
      slow,
      slow,
      () => json(200, { data: { repository: { b0: { text: DOMAIN, isTruncated: false } } } }),
      () => json(200, { data: { repository: { b0: { text: PROCESS, isTruncated: false } } } }),
    ]);
    await s.connect();
    expect(await s.p.refresh()).toBe('applied');
    expect(s.calls).toHaveLength(6);
    expect((s.mutations[0] as { entities: Array<{ entity: { metadata: { name: string } } }> }).entities.map(x => x.entity.metadata.name)).toEqual(['sales', 'sell']);
  });
  it('skips the run (no mutation) when GitHub limits the token or answers an error', async () => {
    const limited = setup([() => json(200, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] })]);
    await limited.connect();
    expect(await limited.p.refresh()).toBe('skipped');
    const forbidden = setup([() => json(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794150000' })]);
    await forbidden.connect();
    expect(await forbidden.p.refresh()).toBe('skipped');
    const down = setup([() => json(502, {}), () => json(504, {}), () => json(502, {})]);
    await down.connect();
    expect(await down.p.refresh()).toBe('skipped');
    expect([limited.mutations, forbidden.mutations, down.mutations]).toEqual([[], [], []]);
  });
});
