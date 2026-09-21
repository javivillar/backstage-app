import { DataBrief } from './brief';
import { canWrite } from './datahubAuthz';
import { DatahubSettings } from './datahubClient';
import { BriefError, ConflictError, applyDefaults, deprecateAsset, extendProduct, registerBrief } from './register';

const settings: DatahubSettings = {
  baseUrl: 'http://gms',
  token: 't',
  publicUrl: 'http://dh',
  governedThreshold: 80,
  accessGroups: ['datahub-admin', 'datahub-editor', 'datahub-viewer'],
  writesEnabled: true,
  writeGroups: ['datahub-admin', 'datahub-editor'],
  stewardGroups: ['datahub-admin'],
  defaultSteward: 'urn:li:corpGroup:datahub-admin',
};

const DS = 'urn:li:dataset:(urn:li:dataPlatform:postgres,pedidos_web.public.pedidos,PROD)';
const PRODUCT = 'urn:li:dataProduct:pedidos-web';

const brief = (over: Partial<DataBrief> = {}): DataBrief => ({
  slug: 'pedidos-web',
  name: 'Pedidos web',
  description: 'Orders.',
  domain: 'urn:li:domain:sales',
  businessOwner: 'urn:li:corpGroup:sales-analytics',
  technicalOwner: '',
  stores: [{ kind: 'postgres', database: 'pedidos_web', schema: 'public', table: 'pedidos', classification: 'Internal', retentionDays: 365 }],
  ...over,
});

interface World {
  existing: Record<string, Array<{ key: string; value: string }>>; // urn -> customProperties (absent = does not exist)
  writes: Array<{ type: string; urn: string; aspects: string[] }>;
  deletes: string[];
  failOn?: string; // urn whose write returns 500
  productOwners?: string[];
  productAssets?: string[];
}

function mockDatahub(w: World) {
  const asJson = (status: number, body: unknown) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.endsWith('/api/graphql')) {
      const { query, variables } = JSON.parse(String(init?.body));
      if (query.includes('types: [DOMAIN]')) return asJson(200, { data: { searchAcrossEntities: { searchResults: [{ entity: { urn: 'urn:li:domain:sales', properties: { name: 'Sales' } } }] } } });
      if (query.includes('types: [GLOSSARY_TERM]')) return asJson(200, { data: { searchAcrossEntities: { searchResults: [] } } });
      if (query.includes('types: [TAG]')) return asJson(200, { data: { searchAcrossEntities: { searchResults: [] } } });
      if (query.includes('types: [STRUCTURED_PROPERTY]')) {
        return asJson(200, {
          data: {
            searchAcrossEntities: {
              searchResults: [
                { entity: { urn: 'x', definition: { qualifiedName: 'refresquito.data_classification', allowedValues: ['Public', 'Internal', 'Confidential', 'Restricted'].map(v => ({ value: { stringValue: v } })) } } },
                { entity: { urn: 'y', definition: { qualifiedName: 'refresquito.lawful_basis', allowedValues: [{ value: { stringValue: 'Consent' } }] } } },
              ],
            },
          },
        });
      }
      if (query.includes('dataProduct(urn: $urn) {') && query.includes('ownership')) {
        const exists = w.existing[PRODUCT] !== undefined;
        return asJson(200, {
          data: {
            dataProduct: exists
              ? {
                  exists: true,
                  properties: { name: 'Pedidos web', description: 'Orders.', customProperties: w.existing[PRODUCT] },
                  domain: { domain: { urn: 'urn:li:domain:sales' } },
                  ownership: { owners: (w.productOwners ?? []).map((o, i) => ({ ownershipType: { urn: i === 0 ? 'urn:li:ownershipType:__system__business_owner' : 'urn:li:ownershipType:__system__technical_owner' }, owner: { urn: o } })) },
                }
              : null,
          },
        });
      }
      const field = /\{\s*(\w+)\(urn: \$urn\)/.exec(query)![1];
      const props = w.existing[variables.urn];
      return asJson(200, { data: { [field]: props ? { exists: true, properties: { customProperties: props } } : { exists: false, properties: null } } });
    }
    const m = /\/openapi\/v3\/entity\/(\w+)(?:\/(.+?))?(?:\?|$)/.exec(u)!;
    if (method === 'POST') {
      const [ent] = JSON.parse(String(init?.body));
      if (w.failOn === ent.urn) return asJson(500, 'boom');
      w.writes.push({ type: m[1], urn: ent.urn, aspects: Object.keys(ent).filter(k => k !== 'urn') });
      return asJson(200, '[]');
    }
    if (method === 'DELETE') {
      w.deletes.push(decodeURIComponent(m[2]));
      return asJson(200, '');
    }
    if (method === 'GET') return asJson(200, { urn: PRODUCT, dataProductProperties: { value: { name: 'Pedidos web', assets: (w.productAssets ?? []).map(a => ({ destinationUrn: a })) } } });
    return asJson(500, 'unexpected');
  }) as unknown as typeof fetch;
}

const fresh = (): World => ({ existing: {}, writes: [], deletes: [] });
const opts = (over = {}) => ({ ctx: { runId: 'r1', requestedBy: 'user:default/test-b' }, callerEmail: 'b@x.com', authorize: async () => {}, ...over });

describe('registerBrief', () => {
  it('validates first: an invalid brief writes nothing', async () => {
    const w = fresh();
    mockDatahub(w);
    await expect(registerBrief(settings, brief({ domain: 'urn:li:domain:nope' }), opts())).rejects.toBeInstanceOf(BriefError);
    expect(w.writes).toEqual([]);
  });

  it('dry run reports what would be created and writes nothing', async () => {
    const w = fresh();
    mockDatahub(w);
    const r = await registerBrief(settings, brief(), opts({ dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(r.created).toEqual([DS, PRODUCT]);
    expect(w.writes).toEqual([]);
  });

  it('writes datasets before the product and defaults the technical owner to the launcher', async () => {
    const w = fresh();
    mockDatahub(w);
    const r = await registerBrief(settings, brief(), opts());
    expect(w.writes.map(x => x.urn)).toEqual([DS, PRODUCT]);
    expect(r.created).toEqual([DS, PRODUCT]);
    expect(w.writes[0].aspects).toEqual(expect.arrayContaining(['datasetProperties', 'ownership', 'structuredProperties', 'domains']));
  });

  it('is idempotent: re-running over assets Backstage manages updates them, creates nothing', async () => {
    const w = fresh();
    w.existing[DS] = [{ key: 'managedBy', value: 'backstage' }];
    w.existing[PRODUCT] = [{ key: 'managedBy', value: 'backstage' }];
    mockDatahub(w);
    const r = await registerBrief(settings, brief(), opts());
    expect(r.created).toEqual([]);
    expect(r.updated).toEqual([DS, PRODUCT]);
  });

  it('refuses to touch an asset it did not create', async () => {
    const w = fresh();
    w.existing[DS] = []; // exists, no managedBy marker (ingested / somebody else's)
    mockDatahub(w);
    await expect(registerBrief(settings, brief(), opts())).rejects.toBeInstanceOf(ConflictError);
    expect(w.writes).toEqual([]);
  });

  it('a failure half way removes only what THIS run created, most-dependent first', async () => {
    const w = fresh();
    w.failOn = PRODUCT;
    mockDatahub(w);
    await expect(registerBrief(settings, brief(), opts())).rejects.toThrow(/Everything this run created was removed/);
    expect(w.deletes).toEqual([DS]);
  });

  it('does not delete pre-existing managed assets when it rolls back', async () => {
    const w = fresh();
    w.existing[DS] = [{ key: 'managedBy', value: 'backstage' }];
    w.failOn = PRODUCT;
    mockDatahub(w);
    await expect(registerBrief(settings, brief(), opts())).rejects.toThrow();
    expect(w.deletes).toEqual([]);
  });

  it('asks authorize() with the existing owners (undefined for a new product) BEFORE writing', async () => {
    const w = fresh();
    w.existing[PRODUCT] = [{ key: 'managedBy', value: 'backstage' }];
    w.productOwners = ['urn:li:corpGroup:sales-analytics'];
    mockDatahub(w);
    const seen: Array<string[] | undefined> = [];
    await expect(
      registerBrief(settings, brief(), opts({ authorize: async (o: string[] | undefined) => { seen.push(o); throw new Error('Forbidden'); } })),
    ).rejects.toThrow('Forbidden');
    expect(seen).toEqual([['urn:li:corpGroup:sales-analytics']]);
    expect(w.writes).toEqual([]);
  });
});

describe('extendProduct', () => {
  it('merges the new assets into the product asset list without dropping existing ones', async () => {
    const w = fresh();
    w.existing[PRODUCT] = [{ key: 'managedBy', value: 'backstage' }];
    w.productOwners = ['urn:li:corpGroup:sales-analytics', 'urn:li:corpuser:b@x.com'];
    w.productAssets = ['urn:li:dataset:(urn:li:dataPlatform:kafka,old-topic,PROD)'];
    mockDatahub(w);
    const r = await extendProduct(settings, 'pedidos-web', { stores: brief().stores }, opts());
    expect(r.created).toEqual([DS]);
    const productWrite = w.writes.find(x => x.type === 'dataProduct')!;
    expect(productWrite.aspects).toEqual(['dataProductProperties']); // nothing else of the product is rewritten
    expect(w.writes[0].urn).toBe(DS);
  });

  it('refuses a product Backstage did not create', async () => {
    const w = fresh();
    w.existing[PRODUCT] = [];
    mockDatahub(w);
    await expect(extendProduct(settings, 'pedidos-web', { stores: brief().stores }, opts())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('deprecateAsset', () => {
  it('only touches assets Backstage manages', async () => {
    const w = fresh();
    w.existing[DS] = [];
    mockDatahub(w);
    await expect(deprecateAsset(settings, DS, 'old', { actorEmail: 'b@x.com', authorize: async () => {} })).rejects.toBeInstanceOf(ConflictError);
    w.existing[DS] = [{ key: 'managedBy', value: 'backstage' }];
    await deprecateAsset(settings, DS, 'old', { actorEmail: 'b@x.com', authorize: async () => {} });
    expect(w.writes[0].aspects).toEqual(['deprecation']);
  });
});

describe('applyDefaults', () => {
  it('fills the launcher as technical owner and the default steward from Confidential up', () => {
    const b = brief();
    b.stores[0].classification = 'Confidential';
    const d = applyDefaults(b, settings, 'b@x.com');
    expect(d.technicalOwner).toBe('urn:li:corpuser:b@x.com');
    expect(d.steward).toBe('urn:li:corpGroup:datahub-admin');
    expect(applyDefaults(brief(), settings, 'b@x.com').steward).toBeUndefined();
  });
});

describe('canWrite', () => {
  const s = { writeGroups: ['datahub-admin', 'datahub-editor'], stewardGroups: ['datahub-admin'] };
  const owners = ['urn:li:corpGroup:sales-analytics', 'urn:li:corpuser:b@x.com'];
  it('viewers are read-only', () => expect(canWrite({ isAdmin: false }, 'b@x.com', ['datahub-viewer'], s, undefined)).toBe(false));
  it('an editor may create a new product', () => expect(canWrite({ isAdmin: false }, 'b@x.com', ['datahub-editor'], s, undefined)).toBe(true));
  it('an editor may edit a product they own (by email or by group)', () => {
    expect(canWrite({ isAdmin: false }, 'b@x.com', ['datahub-editor'], s, owners)).toBe(true);
    expect(canWrite({ isAdmin: false }, 'c@x.com', ['datahub-editor', 'sales-analytics'], s, owners)).toBe(true);
  });
  it('an editor may NOT edit somebody else\'s product', () => expect(canWrite({ isAdmin: false }, 'c@x.com', ['datahub-editor'], s, owners)).toBe(false));
  it('stewards and backstage-admin may edit any', () => {
    expect(canWrite({ isAdmin: false }, 'c@x.com', ['datahub-admin'], s, owners)).toBe(true);
    expect(canWrite({ isAdmin: true }, 'c@x.com', [], s, owners)).toBe(true);
  });
  it('a user in no group can do nothing', () => expect(canWrite({ isAdmin: false }, 'b@x.com', [], s, undefined)).toBe(false));
});
