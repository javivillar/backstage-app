import { checkProcess, ContinuityGraph, continuityOf, formatDuration, type MapEntity, parseDuration, readDefaults } from './continuityModel';

const DEFAULTS = readDefaults({
  critical: { rpo: '15m', rto: '4h', ha: true },
  important: { rpo: '4h', rto: '24h', ha: true },
  standard: { rpo: '24h', rto: '72h', ha: false },
});

const rel = (type: string, targetRef: string) => ({ type, targetRef });
const sla = (rpo: string, rto: string, tier = 'gold') => ({ 'refresquito.io/sla-rpo': rpo, 'refresquito.io/sla-rto': rto, 'refresquito.io/sla-tier': tier });

// a made-up chain: two processes on one business service, its application, three instances, a block, a platform service
const ENTITIES: MapEntity[] = [
  {
    kind: 'BusinessProcess',
    metadata: { name: 'repair', namespace: 'customer' },
    spec: { criticality: 'critical', domain: 'after-sales' },
    relations: [rel('dependsOn', 'system:default/shop')],
  },
  {
    kind: 'BusinessProcess',
    metadata: { name: 'invoice', namespace: 'customer' },
    spec: { criticality: 'standard', rto: '8h' },
    relations: [rel('dependsOn', 'system:default/shop')],
  },
  { kind: 'System', metadata: { name: 'shop' }, spec: { type: 'business-service' }, relations: [rel('hasPart', 'component:default/shop')] },
  {
    kind: 'Component',
    metadata: { name: 'shop' },
    spec: { type: 'business-application', system: 'shop' },
    relations: [rel('partOf', 'system:default/shop'), rel('hasPart', 'component:default/shop-oneke'), rel('hasPart', 'component:default/shop-dev-oneke')],
  },
  {
    kind: 'Component',
    metadata: { name: 'shop-oneke', annotations: { 'refresquito.io/stage': 'pro', ...sla('15 min', '1 h') } },
    spec: { type: 'application-instance' },
    relations: [rel('dependsOn', 'resource:default/shop-db'), rel('dependsOn', 'component:default/python-framework-3-2')],
  },
  {
    kind: 'Component',
    metadata: { name: 'shop-dev-oneke', annotations: { 'refresquito.io/stage': 'dev', ...sla('24 h', '24 h', 'bronze') } },
    spec: { type: 'application-instance' },
    relations: [rel('dependsOn', 'component:default/cache-oneke')],
  },
  { kind: 'Component', metadata: { name: 'python-framework-3-2' }, spec: { type: 'framework-line' } },
  { kind: 'Component', metadata: { name: 'cache-oneke', annotations: sla('24 h', '24 h', 'bronze') }, spec: { type: 'platform-service' } },
  { kind: 'Resource', metadata: { name: 'shop-db' }, spec: { type: 'database' } },
  // the platform service is reached from the block only through its inverse relation
  {
    kind: 'Component',
    metadata: { name: 'postgres-oneke', annotations: sla('24 h', '4 h', 'silver') },
    spec: { type: 'platform-service' },
    relations: [rel('dependencyOf', 'resource:default/shop-db')],
  },
];

const graph = () => new ContinuityGraph(ENTITIES, DEFAULTS);

describe('durations', () => {
  it('reads the catalog forms and the short forms', () => {
    expect(parseDuration('15 min')).toBe(15);
    expect(parseDuration('1 h')).toBe(60);
    expect(parseDuration('24 h')).toBe(1440);
    expect(parseDuration('15m')).toBe(15);
    expect(parseDuration('4h')).toBe(240);
    expect(parseDuration('30y')).toBe(30 * 525600);
    expect(parseDuration('2 days')).toBe(2880);
    expect(parseDuration('pending')).toBeUndefined();
    expect(parseDuration(undefined)).toBeUndefined();
  });
  it('writes the short form', () => {
    expect(formatDuration(15)).toBe('15m');
    expect(formatDuration(1440)).toBe('24h');
    expect(formatDuration(30 * 525600)).toBe('30y');
  });
});

describe('the chain of a process', () => {
  it('goes down to the production instance, its blocks and platform services, not dev nor framework lines', () => {
    expect(graph().chain('businessprocess:customer/repair')).toEqual([
      'system:default/shop',
      'component:default/shop',
      'component:default/shop-oneke',
      'resource:default/shop-db',
      'component:default/postgres-oneke',
    ]);
  });
});

describe('continuityOf', () => {
  it('inherits the strictest requirement and finds the gaps per process', () => {
    const a = continuityOf(graph(), 'component:default/postgres-oneke');
    expect(a.requirement).toEqual({ criticality: 'critical', rpo: '15m', rto: '4h', from: ['businessprocess:customer/repair', 'businessprocess:customer/invoice'] });
    expect(a.delivers).toEqual({ rpo: '24h', rto: '4h' });
    expect(a.result).toBe('gap');
    expect(a.gaps).toEqual([{ process: 'businessprocess:customer/repair', field: 'rpo', needs: '15m', delivers: '24h' }]);
  });
  it('meets when the element delivers enough', () => {
    const a = continuityOf(graph(), 'Component:default/shop-oneke');
    expect(a.result).toBe('meets');
    expect(a.gaps).toEqual([]);
  });
  it('is unknown without annotations, and for what no process depends on', () => {
    expect(continuityOf(graph(), 'resource:default/shop-db').result).toBe('unknown');
    const dev = continuityOf(graph(), 'component:default/shop-dev-oneke');
    expect(dev.requirement).toEqual(null);
    expect(continuityOf(graph(), 'component:default/cache-oneke').result).toBe('unknown');
  });
  it('a process override wins over its criticality', () => {
    const a = continuityOf(graph(), 'businessprocess:customer/invoice');
    expect(a.requirement).toEqual({ criticality: 'standard', rpo: '24h', rto: '8h', from: ['businessprocess:customer/invoice'] });
  });
});

describe('checkProcess', () => {
  it('checks every element of the chain', () => {
    const c = checkProcess(graph(), 'businessprocess:customer/repair')!;
    expect(c.requirement.rpo).toBe('15m');
    const pg = c.elements.find(e => e.ref === 'component:default/postgres-oneke')!;
    expect(pg.tier).toBe('silver');
    expect(pg.result).toBe('gap');
    expect(pg.gap).toEqual([{ field: 'rpo', needs: '15m', delivers: '24h' }]);
    expect(c.elements.find(e => e.ref === 'component:default/shop-oneke')!.result).toBe('meets');
  });
  it('is undefined for an unknown process', () => {
    expect(checkProcess(graph(), 'businessprocess:customer/nothing')).toBeUndefined();
  });
});

describe('sub-processes', () => {
  // repair → plan (says nothing of its own) → plan-fast (its own RPO); plan-alone has its own dependency
  const subs: MapEntity[] = [
    ...ENTITIES,
    {
      kind: 'BusinessProcess',
      metadata: { name: 'plan', namespace: 'customer' },
      spec: { domain: 'after-sales', parentProcess: 'repair' },
      relations: [rel('partOf', 'businessprocess:customer/repair')],
    },
    {
      kind: 'BusinessProcess',
      metadata: { name: 'plan-fast', namespace: 'customer' },
      spec: { domain: 'after-sales', parentProcess: 'businessprocess:customer/plan', rpo: '5m' },
      relations: [rel('partOf', 'businessprocess:customer/plan')],
    },
  ];
  // the parent's side of the relation, as the catalog writes it
  subs[0] = { ...subs[0], relations: [...(subs[0].relations ?? []), rel('hasPart', 'businessprocess:customer/plan')] };
  const g = () => new ContinuityGraph(subs, DEFAULTS);
  it('inherit criticality, RPO/RTO and dependencies from their parents', () => {
    expect(g().lineage('businessprocess:customer/plan-fast')).toEqual(['businessprocess:customer/plan-fast', 'businessprocess:customer/plan', 'businessprocess:customer/repair']);
    expect(g().need('businessprocess:customer/plan')).toEqual({ criticality: 'critical', rpo: 15, rto: 240 });
    expect(g().need('businessprocess:customer/plan-fast')).toEqual({ criticality: 'critical', rpo: 5, rto: 240 });
    expect(g().chain('businessprocess:customer/plan')).toEqual(g().chain('businessprocess:customer/repair'));
    expect(g().subprocesses('businessprocess:customer/repair')).toEqual(['businessprocess:customer/plan']);
  });
  it('the parent chain does not take its sub-processes as dependencies', () => {
    expect(g().dependencies('businessprocess:customer/repair')).toEqual(['system:default/shop']);
  });
  it('are checked down their inherited chain', () => {
    const c = checkProcess(g(), 'businessprocess:customer/plan-fast')!;
    expect(c.requirement).toEqual({ criticality: 'critical', rpo: '5m', rto: '4h', from: ['businessprocess:customer/plan-fast'] });
    expect(c.elements.find(e => e.ref === 'component:default/shop-oneke')!.gap).toEqual([{ field: 'rpo', needs: '5m', delivers: '15m' }]);
  });
  it('the processes above an element: the top ones and the sub-processes that say something of their own', () => {
    expect(g().listedProcesses().sort()).toEqual(['businessprocess:customer/invoice', 'businessprocess:customer/plan-fast', 'businessprocess:customer/repair']);
    expect(continuityOf(g(), 'component:default/shop-oneke').requirement!.rpo).toBe('5m');
  });
});

describe('the business impact analysis in the check', () => {
  const bia = (spec: Record<string, unknown>): MapEntity[] =>
    ENTITIES.map(e => (e.metadata.name === 'repair' && e.kind === 'BusinessProcess' ? { ...e, spec: { ...e.spec, ...spec } } : e));
  it('says when the RTO is above the MTPD', () => {
    const c = checkProcess(new ContinuityGraph(bia({ mtpd: '2h' }), DEFAULTS), 'businessprocess:customer/repair')!;
    expect(c.issues).toEqual([{ key: 'rto-above-mtpd', rto: '4h', mtpd: '2h' }]);
    expect(checkProcess(new ContinuityGraph(bia({ mtpd: '8h' }), DEFAULTS), 'businessprocess:customer/repair')!.issues).toBeUndefined();
    expect(checkProcess(graph(), 'businessprocess:customer/repair')!.issues).toBeUndefined();
  });
});

