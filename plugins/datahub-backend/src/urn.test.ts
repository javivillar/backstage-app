import { assetTypeOf, dataFlowUrn, dataJobUrn, dataProductUrn, datasetUrn, postgresDatasetUrn } from './urn';

describe('urn builders', () => {
  it('builds the same URNs as the sample-data loader', () => {
    expect(postgresDatasetUrn('crm', 'public', 'customers')).toBe(
      'urn:li:dataset:(urn:li:dataPlatform:postgres,crm.public.customers,PROD)',
    );
    expect(datasetUrn('s3', 'refresquito-lake/curated/orders/orders_clean')).toBe(
      'urn:li:dataset:(urn:li:dataPlatform:s3,refresquito-lake/curated/orders/orders_clean,PROD)',
    );
    expect(dataProductUrn('customer-360')).toBe('urn:li:dataProduct:customer-360');
    expect(dataFlowUrn('airflow', 'refresquito_ingest')).toBe('urn:li:dataFlow:(airflow,refresquito_ingest,prod)');
    expect(dataJobUrn(dataFlowUrn('camunda', 'checkout'), 'validar-pedido')).toBe(
      'urn:li:dataJob:(urn:li:dataFlow:(camunda,checkout,prod),validar-pedido)',
    );
  });

  it('is deterministic (idempotent re-runs)', () => {
    expect(postgresDatasetUrn('a', 'b', 'c')).toBe(postgresDatasetUrn('a', 'b', 'c'));
  });

  it('rejects characters that could break a URN', () => {
    expect(() => datasetUrn('postgres', 'a,b')).toThrow();
    expect(() => datasetUrn('post gres', 'a')).toThrow();
    expect(() => dataProductUrn('')).toThrow();
    expect(() => dataFlowUrn('x', 'a)b')).toThrow();
  });
});

describe('assetTypeOf', () => {
  it('accepts the three asset kinds', () => {
    expect(assetTypeOf('urn:li:dataset:(urn:li:dataPlatform:postgres,a.b.c,PROD)')).toBe('dataset');
    expect(assetTypeOf('urn:li:dataProduct:customer-360')).toBe('dataProduct');
    expect(assetTypeOf('urn:li:dataFlow:(airflow,x,prod)')).toBe('dataFlow');
  });

  it('rejects everything else', () => {
    expect(assetTypeOf('urn:li:corpuser:someone')).toBeUndefined();
    expect(assetTypeOf('urn:li:dataset:(a b)')).toBeUndefined();
    expect(assetTypeOf('urn:li:dataset:x"){ me }')).toBeUndefined();
    expect(assetTypeOf(`urn:li:dataset:${'x'.repeat(600)}`)).toBeUndefined();
    expect(assetTypeOf('')).toBeUndefined();
    expect(assetTypeOf(undefined as unknown as string)).toBeUndefined();
  });
});
