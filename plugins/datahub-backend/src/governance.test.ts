import { assetUrl, summarize, RawEntity } from './governance';
import { hasAccess } from './datahubAuthz';
import { datahubQuery } from './datahubClient';

const base = (over: Partial<RawEntity> = {}): RawEntity => ({
  urn: 'urn:li:dataset:(urn:li:dataPlatform:postgres,crm.public.customers,PROD)',
  name: 'customers',
  platform: { name: 'postgres' },
  properties: { name: 'customers', description: 'Customer master record.' },
  ownership: {
    owners: [
      { ownershipType: { urn: 'urn:li:ownershipType:__system__business_owner' }, owner: { urn: 'urn:li:corpGroup:sales', name: 'sales' } },
    ],
  },
  domain: { domain: { urn: 'urn:li:domain:customer', properties: { name: 'Customer' } } },
  tags: { tags: [{ tag: { urn: 'urn:li:tag:bronze', properties: { name: 'Bronze' } } }] },
  structuredProperties: {
    properties: [
      { structuredProperty: { definition: { qualifiedName: 'refresquito.data_classification' } }, values: [{ stringValue: 'Internal' }] },
      { structuredProperty: { definition: { qualifiedName: 'refresquito.retention_days' } }, values: [{ numberValue: 365 }] },
    ],
  },
  schemaMetadata: { fields: [{ fieldPath: 'id', description: 'pk' }, { fieldPath: 'email' }] },
  ...over,
});

const pub = 'http://datahub.example.com/';

describe('summarize / score', () => {
  it('scores a fully governed non-personal dataset at 100', () => {
    const s = summarize('dataset', base(), pub, 80);
    expect(s.score.score).toBe(100);
    expect(s.score.governed).toBe(true);
    expect(s.score.checks.find(c => c.id === 'lawful-basis')!.applicable).toBe(false);
    expect(s.classification).toBe('Internal');
    expect(s.retentionDays).toBe(365);
  });

  it('requires a lawful basis once the dataset is personal data', () => {
    const raw = base({ tags: { tags: [{ tag: { urn: 'urn:li:tag:pii', properties: { name: 'PII' } } }] } });
    const s = summarize('dataset', raw, pub, 80);
    const lb = s.score.checks.find(c => c.id === 'lawful-basis')!;
    expect(s.personalData).toBe(true);
    expect(lb.applicable).toBe(true);
    expect(lb.ok).toBe(false);
    expect(s.score.score).toBeLessThan(100);
  });

  it('counts an editable column description (survives re-ingestion, design §5.1)', () => {
    const raw = base({
      schemaMetadata: { fields: [{ fieldPath: 'id' }, { fieldPath: 'email' }] },
      editableSchemaMetadata: { editableSchemaFieldInfo: [{ fieldPath: 'email', description: 'contact' }] },
    });
    const s = summarize('dataset', raw, pub, 80);
    expect(s.columns).toEqual({ total: 2, described: 1 });
    expect(s.score.checks.find(c => c.id === 'columns')!.ok).toBe(true);
  });

  it('flags gaps and marks the asset ungoverned below the threshold', () => {
    const s = summarize('dataset', base({ properties: { name: 'x' }, domain: null, ownership: null, structuredProperties: null }), pub, 80);
    expect(s.score.governed).toBe(false);
    const failing = s.score.checks.filter(c => c.applicable && !c.ok).map(c => c.id);
    expect(failing).toEqual(expect.arrayContaining(['description', 'domain', 'owner', 'business-owner', 'classification', 'retention']));
  });

  it('uses the lighter check set for flows and products', () => {
    const flow = summarize('dataFlow', { urn: 'urn:li:dataFlow:(airflow,x,prod)', properties: { name: 'x', description: 'd' } }, pub, 80);
    expect(flow.score.checks.map(c => c.id)).toEqual(['description', 'domain', 'owner']);
    const product = summarize('dataProduct', { urn: 'urn:li:dataProduct:p', properties: { name: 'p' } }, pub, 80);
    expect(product.score.checks.map(c => c.id)).toEqual(['description', 'domain', 'owner', 'business-owner', 'vocabulary']);
  });

  it('reads managedBy and deprecation', () => {
    const s = summarize(
      'dataset',
      base({ properties: { name: 'x', customProperties: [{ key: 'managedBy', value: 'backstage' }] }, deprecation: { deprecated: true, note: 'old' } }),
      pub,
      80,
    );
    expect(s.managedBy).toBe('backstage');
    expect(s.deprecated).toBe(true);
  });
});

describe('assetUrl', () => {
  it('links to the DataHub UI page of each type', () => {
    expect(assetUrl(pub, 'dataset', 'urn:li:dataset:(a,b,PROD)')).toBe('http://datahub.example.com/dataset/urn%3Ali%3Adataset%3A(a%2Cb%2CPROD)');
    expect(assetUrl(pub, 'dataFlow', 'urn:li:dataFlow:(a,b,c)')).toContain('/pipelines/');
    expect(assetUrl(pub, 'dataProduct', 'urn:li:dataProduct:p')).toContain('/dataProduct/');
  });
});

describe('access gate', () => {
  const groups = ['datahub-admin', 'datahub-editor', 'datahub-viewer'];
  it('lets a datahub-* group member in and keeps everybody else out', () => {
    expect(hasAccess({ isAdmin: false }, ['datahub-viewer'], groups)).toBe(true);
    expect(hasAccess({ isAdmin: false }, ['activepieces-user'], groups)).toBe(false);
    expect(hasAccess({ isAdmin: false }, [], groups)).toBe(false);
  });
  it('lets backstage-admin in regardless', () => {
    expect(hasAccess({ isAdmin: true }, [], groups)).toBe(true);
  });
});

describe('read-only client', () => {
  it('refuses mutations and subscriptions before any network call', async () => {
    const s = { baseUrl: 'http://127.0.0.1:1', token: 't' };
    await expect(datahubQuery(s, 'mutation { batchAssignRole(input:{}) }')).rejects.toThrow(/read-only/);
    await expect(datahubQuery(s, '  Mutation X { a }')).rejects.toThrow(/read-only/);
    await expect(datahubQuery(s, 'subscription { a }')).rejects.toThrow(/read-only/);
  });
});
