import { parse } from 'yaml';
import { DataBrief } from './brief';
import { buildCatalogInfo, entityName } from './catalogInfo';

const brief: DataBrief = {
  slug: 'pedidos-web',
  name: 'Pedidos web',
  description: 'Orders: "web" shop.',
  domain: 'sales',
  businessOwner: 'sales-analytics',
  technicalOwner: '',
  stores: [
    { kind: 'postgres', database: 'pedidos_web', schema: 'public', table: 'pedidos', description: 'orders', classification: 'Internal', retentionDays: 365 },
    { kind: 'alfresco-site', name: 'pedidos-web-docs', classification: 'Internal', retentionDays: 365 },
  ],
  processes: [{ engine: 'camunda', id: 'checkout', name: 'Checkout', tasks: [{ id: 'validar', name: 'Validate' }] }],
};
const opts = { ownerRef: 'user:default/ana', publicUrl: 'http://datahub.example.com/' };

describe('entityName', () => {
  it('makes valid, bounded Backstage names', () => {
    expect(entityName('Pedidos Web / Docs')).toBe('pedidos-web-docs');
    expect(entityName('---')).toBe('x');
    expect(entityName('a'.repeat(100))).toHaveLength(63);
  });
});

describe('buildCatalogInfo', () => {
  const c = buildCatalogInfo(brief, opts);

  it('creates a System, a Resource per store and a Component per process', () => {
    expect(c.entities).toEqual([
      { kind: 'System', name: 'pedidos-web' },
      { kind: 'Resource', name: 'pedidos-web-pedidos' },
      { kind: 'Resource', name: 'pedidos-web-pedidos-web-docs' },
      { kind: 'Component', name: 'pedidos-web-checkout' },
    ]);
    expect(c.yaml.split('\n---\n')).toHaveLength(4);
  });

  it('annotates each entity with the DataHub URN it mirrors (what makes the card and the tab appear)', () => {
    expect(c.yaml).toContain('datahub.io/data-product: "urn:li:dataProduct:pedidos-web"');
    expect(c.yaml).toContain('datahub.io/dataset: "urn:li:dataset:(urn:li:dataPlatform:postgres,pedidos_web.public.pedidos,PROD)"');
    expect(c.yaml).toContain('datahub.io/dataset: "urn:li:dataset:(urn:li:dataPlatform:alfresco,site/pedidos-web-docs,PROD)"');
    expect(c.yaml).toContain('datahub.io/flow: "urn:li:dataFlow:(camunda,checkout,prod)"');
  });

  it('puts a DataHub link on the Links card of every entity', () => {
    const links = c.yaml.match(/title: "DataHub"/g) ?? [];
    expect(links).toHaveLength(4);
    expect(c.yaml).toContain('url: "http://datahub.example.com/dataProduct/urn%3Ali%3AdataProduct%3Apedidos-web"');
    expect(c.yaml).toContain('/pipelines/');
  });

  it('is valid YAML with proper escaping, owner and system relations', () => {
    const docs = c.yaml.split('\n---\n').map((d: string) => parse(d));
    expect(docs.map((d: { kind: string }) => d.kind)).toEqual(['System', 'Resource', 'Resource', 'Component']);
    expect(docs[0].metadata.description).toBe('Orders: "web" shop.');
    expect(docs[1].spec).toEqual({ type: 'database', owner: 'user:default/ana', system: 'pedidos-web' });
    expect(docs[3].spec.type).toBe('process');
    expect(docs[2].spec.type).toBe('document-site');
  });

  it('keeps names unique when two stores collapse to the same name', () => {
    const b = { ...brief, stores: [brief.stores[0], { ...brief.stores[0], schema: 'other' }], processes: [] };
    const names = buildCatalogInfo(b, opts).entities.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('accepts the short ids a form sends', () => {
    expect(() => buildCatalogInfo({ ...brief, domain: 'sales', businessOwner: 'sales-analytics' }, opts)).not.toThrow();
    expect(c.readme).toContain('# Pedidos web');
    expect(c.readme).toContain('http://datahub.example.com/dataProduct/');
  });
});
