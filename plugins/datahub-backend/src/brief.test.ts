import { DataBrief, Vocabulary, normalizeBrief, storeUrn, validateBrief } from './brief';
import { buildPlan, undoOrder } from './plan';

const vocab: Vocabulary = {
  domains: [{ urn: 'urn:li:domain:sales' }],
  glossaryTerms: [{ urn: 'urn:li:glossaryTerm:personal-data' }, { urn: 'urn:li:glossaryTerm:customer' }],
  tags: [{ urn: 'urn:li:tag:pii' }, { urn: 'urn:li:tag:gdpr' }, { urn: 'urn:li:tag:gold' }],
  structuredProperties: [
    { qualifiedName: 'refresquito.data_classification', allowedValues: ['Public', 'Internal', 'Confidential', 'Restricted'] },
    { qualifiedName: 'refresquito.lawful_basis', allowedValues: ['Consent', 'Contract', 'Legitimate interest'] },
  ],
};

const brief = (over: Partial<DataBrief> = {}): DataBrief => ({
  slug: 'pedidos-web',
  name: 'Pedidos web',
  description: 'Orders placed through the web shop.',
  domain: 'urn:li:domain:sales',
  businessOwner: 'urn:li:corpGroup:sales-analytics',
  technicalOwner: 'urn:li:corpuser:carlos.ruiz@refresquito.com',
  stores: [
    {
      kind: 'postgres',
      database: 'pedidos_web',
      schema: 'public',
      table: 'pedidos',
      classification: 'Internal',
      retentionDays: 365,
      columns: [{ name: 'id', type: 'int', description: 'pk' }],
    },
  ],
  backstageEntity: 'system:default/pedidos-web',
  ...over,
});

const ctx = { runId: 'run-1', requestedBy: 'test-b@refresquito.com' };

describe('validateBrief', () => {
  it('accepts a minimal valid brief', () => {
    const v = validateBrief(brief(), vocab);
    expect(v.errors).toEqual([]);
    expect(v.personalData).toBe(false);
  });

  it('never invents vocabulary: unknown domain, term and tag are errors', () => {
    const v = validateBrief(brief({ domain: 'urn:li:domain:nope', terms: ['urn:li:glossaryTerm:nope'], tags: ['urn:li:tag:nope'] }), vocab);
    expect(v.errors).toHaveLength(3);
    expect(v.errors.join(' ')).toMatch(/domain .* does not exist/);
  });

  it('personal-data columns force lawful basis and classification >= Confidential', () => {
    const b = brief();
    b.stores[0].columns = [{ name: 'email', type: 'text', personal: true }];
    const v = validateBrief(b, vocab);
    expect(v.personalData).toBe(true);
    expect(v.errors.join(' ')).toMatch(/lawfulBasis \(GDPR\) is required/);
    expect(v.errors.join(' ')).toMatch(/Confidential or Restricted/);
    b.stores[0].classification = 'Confidential';
    b.stores[0].lawfulBasis = 'Consent';
    b.steward = 'urn:li:corpGroup:datahub-admin';
    expect(validateBrief(b, vocab).errors).toEqual([]);
  });

  it('requires a steward from Confidential up', () => {
    const b = brief();
    b.stores[0].classification = 'Confidential';
    expect(validateBrief(b, vocab).errors.join(' ')).toMatch(/steward is required/);
  });

  it('rejects values outside the allowed set and bad numbers', () => {
    const b = brief();
    b.stores[0].classification = 'TopSecret' as never;
    b.stores[0].retentionDays = 0;
    const e = validateBrief(b, vocab).errors.join(' ');
    expect(e).toMatch(/classification must be one of/);
    expect(e).toMatch(/retentionDays must be a number > 0/);
  });

  it('rejects bad slugs, duplicate stores and characters that would break a URN', () => {
    expect(validateBrief(brief({ slug: 'Pedidos Web' }), vocab).errors.join(' ')).toMatch(/slug/);
    const dup = brief();
    dup.stores.push({ ...dup.stores[0] });
    expect(validateBrief(dup, vocab).errors.join(' ')).toMatch(/declared twice/);
    const bad = brief();
    bad.stores[0].table = 'a,b';
    expect(validateBrief(bad, vocab).errors.join(' ')).toMatch(/Invalid table/);
  });

  it('checks process endpoints and warns about writing to datasets it does not own', () => {
    const b = brief({
      processes: [
        {
          engine: 'camunda',
          id: 'checkout',
          name: 'Checkout',
          tasks: [
            { id: 'validar', name: 'Validate', reads: ['postgres:pedidos_web.public.pedidos'], writes: ['urn:li:dataset:(urn:li:dataPlatform:postgres,crm.public.customers,PROD)'] },
            { id: 'roto', name: 'Broken', reads: ['postgres:nope.nope.nope'] },
          ],
        },
      ],
    });
    const v = validateBrief(b, vocab);
    expect(v.errors.join(' ')).toMatch(/"postgres:nope.nope.nope" is neither a store/);
    expect(v.warnings.join(' ')).toMatch(/does not own/);
  });
});

describe('buildPlan', () => {
  const withProcess = () =>
    brief({
      tags: ['urn:li:tag:gold'],
      processes: [
        { engine: 'camunda', id: 'checkout', name: 'Checkout', tasks: [{ id: 'validar', name: 'Validate', reads: [], writes: ['postgres:pedidos_web.public.pedidos'] }] },
      ],
    });

  it('refuses an invalid brief', () => {
    const b = brief({ domain: 'urn:li:domain:nope' });
    expect(() => buildPlan(b, validateBrief(b, vocab), ctx)).toThrow(/Refusing to plan/);
  });

  it('orders datasets, then flow + jobs, then the product last; undo is the reverse', () => {
    const b = withProcess();
    const plan = buildPlan(b, validateBrief(b, vocab), ctx);
    expect(plan.map(p => p.entityType)).toEqual(['dataset', 'dataFlow', 'dataJob', 'dataProduct']);
    expect(undoOrder(plan)[0]).toBe('urn:li:dataProduct:pedidos-web');
    expect(undoOrder(plan)).toHaveLength(4);
  });

  it('is deterministic (idempotent re-run) and uses the same URNs as the builders', () => {
    const b = withProcess();
    const v = validateBrief(b, vocab);
    expect(buildPlan(b, v, ctx)).toEqual(buildPlan(b, v, ctx));
    expect(buildPlan(b, v, ctx)[0].urn).toBe(storeUrn(b.stores[0]));
  });

  it('stamps the management marker on every created asset', () => {
    const b = withProcess();
    for (const p of buildPlan(b, validateBrief(b, vocab), ctx)) {
      const props = (Object.values(p.aspects) as Array<{ customProperties?: Record<string, string> }>).find(a => a.customProperties)!;
      expect(props.customProperties).toMatchObject({ managedBy: 'backstage', runId: 'run-1', requestedBy: 'test-b@refresquito.com', backstageEntity: 'system:default/pedidos-web' });
    }
  });

  it('puts PII column tags/descriptions in the EDITABLE schema aspect and adds the personal-data term', () => {
    const b = brief();
    b.stores[0].classification = 'Confidential';
    b.stores[0].lawfulBasis = 'Consent';
    b.steward = 'urn:li:corpGroup:datahub-admin';
    b.stores[0].columns = [{ name: 'email', type: 'text', personal: true, description: 'contact' }, { name: 'id', type: 'int' }];
    const [ds] = buildPlan(b, validateBrief(b, vocab), ctx);
    const editable = ds.aspects.editableSchemaMetadata as { editableSchemaFieldInfo: Array<{ fieldPath: string; globalTags?: unknown }> };
    expect(editable.editableSchemaFieldInfo.map(f => f.fieldPath)).toEqual(['email']);
    expect(editable.editableSchemaFieldInfo[0].globalTags).toBeDefined();
    expect(JSON.stringify(ds.aspects.glossaryTerms)).toContain('personal-data');
    expect(JSON.stringify(ds.aspects.structuredProperties)).toContain('lawful_basis');
  });

  it('turns task reads/writes into the planned lineage and lists assets in the product', () => {
    const b = withProcess();
    const plan = buildPlan(b, validateBrief(b, vocab), ctx);
    const job = plan.find(p => p.entityType === 'dataJob')!;
    expect(job.aspects.dataJobInputOutput).toEqual({ inputDatasets: [], outputDatasets: [storeUrn(b.stores[0])] });
    const product = plan[plan.length - 1];
    const assets = (product.aspects.dataProductProperties as { assets: Array<{ destinationUrn: string }> }).assets.map(a => a.destinationUrn);
    expect(assets).toEqual([storeUrn(b.stores[0]), 'urn:li:dataFlow:(camunda,checkout,prod)']);
  });
});

describe('normalizeBrief', () => {
  it('maps the short ids a form collects to DataHub URNs', () => {
    const n = normalizeBrief(
      brief({ domain: 'sales', businessOwner: 'sales-analytics', technicalOwner: 'carlos@x.com', steward: 'datahub-admin', terms: ['personal-data'], tags: ['gold', ''] }),
    );
    expect(n.domain).toBe('urn:li:domain:sales');
    expect(n.businessOwner).toBe('urn:li:corpGroup:sales-analytics');
    expect(n.technicalOwner).toBe('urn:li:corpuser:carlos@x.com');
    expect(n.steward).toBe('urn:li:corpGroup:datahub-admin');
    expect(n.terms).toEqual(['urn:li:glossaryTerm:personal-data']);
    expect(n.tags).toEqual(['urn:li:tag:gold']);
  });

  it('leaves URNs alone and treats empty strings as not given', () => {
    const n = normalizeBrief(brief({ domain: 'urn:li:domain:sales', technicalOwner: '  ', steward: '' }));
    expect(n.domain).toBe('urn:li:domain:sales');
    expect(n.technicalOwner).toBe('');
    expect(n.steward).toBeUndefined();
    expect(validateBrief({ ...n, technicalOwner: 'urn:li:corpuser:a@x.com' }, vocab).errors).toEqual([]);
  });
});
