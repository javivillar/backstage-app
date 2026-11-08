import { ContinuityGraph, type MapEntity, readDefaults } from './continuityModel';
import { buildMap, combine, compareIds, engineLinks, impactOf, normRef, pathTo } from './mapModel';

const DEFAULTS = readDefaults({
  critical: { rpo: '15m', rto: '4h', ha: true },
  important: { rpo: '4h', rto: '24h', ha: true },
  standard: { rpo: '24h', rto: '72h', ha: false },
});

const rel = (type: string, targetRef: string) => ({ type, targetRef });
const sla = (rpo: string, rto: string, tier = 'gold') => ({ 'refresquito.io/sla-rpo': rpo, 'refresquito.io/sla-rto': rto, 'refresquito.io/sla-tier': tier });

// made-up: a customer with a domain and a subdomain, two processes on one business service, its application with a pro
// instance on line 2.0 and a dev instance on 3.2, a block on a silver platform service; and an APQC model elsewhere
const ENTITIES: MapEntity[] = [
  { kind: 'ReferenceModel', metadata: { name: 'apqc-x', title: 'APQC X' }, spec: { source: 'apqc', namespace: 'apqc-x', version: '7.4' } },
  { kind: 'ReferenceModel', metadata: { name: 'customer', title: 'Customer model' }, spec: { source: 'customer', namespace: 'customer' } },
  { kind: 'Domain', metadata: { name: 'ops', namespace: 'apqc-x', title: 'Operations' }, spec: { type: 'business-area' } },
  { kind: 'Domain', metadata: { name: 'after-sales', namespace: 'customer', title: 'After sales', annotations: { 'apqc.org/pcf-id': '6.0' } }, spec: { type: 'business-area' } },
  {
    kind: 'Domain',
    metadata: { name: 'repairs', namespace: 'customer', title: 'Repairs', annotations: { 'apqc.org/pcf-id': '6.3' } },
    spec: { type: 'business-area', subdomainOf: 'after-sales' },
  },
  { kind: 'Domain', metadata: { name: 'stack', namespace: 'customer' }, spec: { type: 'stack' } },
  {
    kind: 'BusinessProcess',
    metadata: { name: 'repair', namespace: 'customer', title: 'Repair', annotations: { 'apqc.org/pcf-id': '6.3.10', 'refresquito.io/process-key': 'repair-event' } },
    spec: { criticality: 'critical', domain: 'repairs', owner: 'a-team', retention: '30y', classification: 'restricted' },
    relations: [rel('dependsOn', 'system:default/shop'), rel('partOf', 'domain:customer/repairs')],
  },
  {
    kind: 'BusinessProcess',
    metadata: { name: 'invoice', namespace: 'customer', title: 'Invoice', annotations: { 'apqc.org/pcf-id': '6.3.2' } },
    spec: { criticality: 'standard', rto: '8h', domain: 'domain:customer/repairs' },
    relations: [rel('dependsOn', 'system:default/shop'), rel('dependsOn', 'system:default/gone')],
  },
  { kind: 'System', metadata: { name: 'shop', title: 'Shop' }, spec: { type: 'business-service', owner: 'shop-team' }, relations: [rel('hasPart', 'component:default/shop')] },
  {
    kind: 'Component',
    metadata: { name: 'shop' },
    spec: { type: 'business-application' },
    relations: [rel('partOf', 'system:default/shop'), rel('hasPart', 'component:default/shop-oneke'), rel('hasPart', 'component:default/shop-dev-oneke')],
  },
  {
    kind: 'Component',
    metadata: { name: 'shop-oneke', annotations: { 'refresquito.io/stage': 'pro', 'refresquito.io/data-product': 'urn:li:dataProduct:shop', ...sla('15 min', '1 h') } },
    spec: { type: 'application-instance' },
    relations: [rel('dependsOn', 'resource:default/shop-db'), rel('dependsOn', 'component:default/fw-2-0')],
  },
  {
    kind: 'Component',
    metadata: { name: 'shop-dev-oneke', annotations: { 'refresquito.io/stage': 'dev' } },
    spec: { type: 'application-instance' },
    relations: [rel('dependsOn', 'component:default/fw-3-2')],
  },
  {
    kind: 'Component',
    metadata: { name: 'fw-2-0', title: 'Framework 2.0', annotations: { 'refresquito.io/framework-line': '2.0', 'refresquito.io/supported-until': '2027-04-16' } },
    spec: { type: 'framework-line', lifecycle: 'deprecated' },
    relations: [rel('partOf', 'component:default/fw'), rel('dependencyOf', 'component:default/shop-oneke')],
  },
  {
    kind: 'Component',
    metadata: { name: 'fw-3-2', title: 'Framework 3.2', annotations: { 'refresquito.io/framework-line': '3.2' } },
    spec: { type: 'framework-line', lifecycle: 'production' },
    relations: [rel('partOf', 'component:default/fw')],
  },
  { kind: 'Component', metadata: { name: 'fw', title: 'Framework' }, spec: { type: 'development-service', lifecycle: 'production' } },
  { kind: 'Resource', metadata: { name: 'shop-db' }, spec: { type: 'database' } },
  {
    kind: 'Component',
    metadata: { name: 'postgres-oneke', annotations: sla('24 h', '4 h', 'silver') },
    spec: { type: 'platform-service' },
    relations: [rel('dependencyOf', 'resource:default/shop-db')],
  },
];

const graph = () => new ContinuityGraph(ENTITIES, DEFAULTS);

describe('helpers', () => {
  it('fills kind and namespace of a ref', () => {
    expect(normRef('repairs', 'domain', 'customer')).toBe('domain:customer/repairs');
    expect(normRef('group:default/A-Team', 'group', 'x')).toBe('group:default/a-team');
    expect(normRef('other/x', 'domain', 'customer')).toBe('domain:other/x');
  });
  it('orders ids as numbers', () => {
    expect(['6.10', '6.3.2', '6.3', '10.1', undefined].sort(compareIds)).toEqual(['6.3', '6.3.2', '6.10', '10.1', undefined]);
  });
  it('sums up results', () => {
    expect(combine(['meets', 'unknown'])).toBe('meets');
    expect(combine(['meets', 'gap'])).toBe('gap');
    expect(combine([])).toBe('unknown');
  });
});

describe('buildMap', () => {
  const map = buildMap(graph(), DEFAULTS);
  it('lists the customers before the namespaces of the reference models, and picks the first', () => {
    expect(map.namespaces).toEqual(['customer', 'apqc-x']);
    expect(map.namespace).toBe('customer');
    expect(map.models.map(m => m.ref)).toEqual(['referencemodel:default/apqc-x', 'referencemodel:default/customer']);
    expect(buildMap(graph(), DEFAULTS, 'apqc-x').domains.map(d => d.ref)).toEqual(['domain:apqc-x/ops']);
  });
  it('gives the business-area domains, the subdomain with its parent, not the stack', () => {
    expect(map.domains).toEqual([
      { ref: 'domain:customer/after-sales', title: 'After sales', pcfId: '6.0' },
      { ref: 'domain:customer/repairs', title: 'Repairs', pcfId: '6.3', parent: 'domain:customer/after-sales' },
    ]);
  });
  it('checks each process and says where its requirement comes from', () => {
    expect(map.processes.map(p => p.name)).toEqual(['invoice', 'repair']);
    const repair = map.processes.find(p => p.name === 'repair')!;
    expect(repair.domain).toBe('domain:customer/repairs');
    expect(repair.owner).toBe('group:default/a-team');
    expect(repair.processKey).toBe('repair-event');
    expect(repair.requirement).toEqual({ rpo: '15m', rto: '4h', retention: '30y', ha: true, from: { rpo: 'default', rto: 'default' } });
    expect(repair.result).toBe('gap');
    expect(repair.gaps).toEqual([{ element: 'component:default/postgres-oneke', field: 'rpo', needs: '15m', delivers: '24h' }]);
    expect(repair.services).toHaveLength(1);
    expect(repair.services[0]).toEqual({
      ref: 'system:default/shop',
      title: 'Shop',
      type: 'business-service',
      delivers: null,
      result: 'gap',
      gaps: [{ element: 'component:default/postgres-oneke', field: 'rpo', needs: '15m', delivers: '24h' }],
    });
    expect(repair.dataProducts).toEqual(['urn:li:dataProduct:shop']);
  });
  it('a process override, and a dependency missing from the catalog', () => {
    const invoice = map.processes.find(p => p.name === 'invoice')!;
    expect(invoice.requirement.from).toEqual({ rpo: 'default', rto: 'override' });
    expect(invoice.requirement.rto).toBe('8h');
    expect(invoice.result).toBe('meets');
    expect(invoice.services.find(s => s.ref === 'system:default/gone')!.result).toBe('unknown');
  });
});

describe('impactOf', () => {
  it('lists the processes above a platform service, strictest first, with the way down and the check', () => {
    const a = impactOf(graph(), 'component:default/postgres-oneke');
    expect(a.role).toBe('run-time');
    expect(a.delivers).toEqual({ rpo: '24h', rto: '4h' });
    expect(a.processes.map(p => [p.ref, p.result])).toEqual([
      ['businessprocess:customer/repair', 'gap'],
      ['businessprocess:customer/invoice', 'meets'],
    ]);
    expect(a.processes[0].through).toEqual(['system:default/shop', 'component:default/shop', 'component:default/shop-oneke', 'resource:default/shop-db']);
    expect(a.processes[0].gap).toEqual([{ field: 'rpo', needs: '15m', delivers: '24h' }]);
  });
  it('a business service is reached directly; a dev instance has no process', () => {
    expect(impactOf(graph(), 'system:default/shop').processes[0].through).toEqual([]);
    expect(impactOf(graph(), 'component:default/shop-dev-oneke').processes).toEqual([]);
  });
  it('a framework line: who runs on it, the line of each stage, the processes above and its support', () => {
    const a = impactOf(graph(), 'component:default/fw-2-0');
    expect(a.role).toBe('framework-line');
    expect(a.support).toEqual({
      lifecycle: 'deprecated',
      supportedUntil: '2027-04-16',
      version: '2.0',
      lines: [{ ref: 'component:default/fw-2-0', title: 'Framework 2.0', version: '2.0', lifecycle: 'deprecated', supportedUntil: '2027-04-16' }],
    });
    expect(a.services).toHaveLength(1);
    const s = a.services![0];
    expect(s.ref).toBe('system:default/shop');
    expect(s.owner).toBe('group:default/shop-team');
    expect(s.stages.map(x => [x.stage, x.version])).toEqual([
      ['pro', '2.0'],
      ['dev', '3.2'],
    ]);
    expect(s.processes.sort()).toEqual(['businessprocess:customer/invoice', 'businessprocess:customer/repair']);
    expect(a.processes.map(p => p.ref)).toEqual(['businessprocess:customer/repair', 'businessprocess:customer/invoice']);
    expect(a.processes[0].through).toEqual(['system:default/shop']);
  });
  it('a development service: every line under it', () => {
    const a = impactOf(graph(), 'component:default/fw');
    expect(a.role).toBe('development-service');
    expect(a.support!.lines.map(l => l.version).sort()).toEqual(['2.0', '3.2']);
    expect(a.services).toHaveLength(1);
  });
});

describe('pathTo', () => {
  it('is empty when there is no way down', () => {
    expect(pathTo(graph(), 'businessprocess:customer/repair', 'component:default/fw')).toEqual([]);
  });
});

describe('engineLinks', () => {
  it('links into Operaton, the definition when known', () => {
    expect(engineLinks(undefined)).toEqual({});
    expect(engineLinks('https://operaton.example.org/', 'repair:3:abc')).toEqual({
      baseUrl: 'https://operaton.example.org',
      cockpitUrl: 'https://operaton.example.org/operaton/app/cockpit/default/#/processes',
      tasklistUrl: 'https://operaton.example.org/operaton/app/tasklist/default/',
      definitionUrl: 'https://operaton.example.org/operaton/app/cockpit/default/#/process-definition/repair:3:abc',
    });
    expect(engineLinks('https://x', 'a/b').definitionUrl).toBeUndefined();
  });
});
