import type { CheckElement, LineService, MapData, MapProcess } from '../../businessMap';
import {
  chainColumns,
  closeAdvice,
  compareVersions,
  consolePath,
  adoptModelUrl,
  editProcessUrl,
  importModelUrl,
  gapText,
  impactSummary,
  lineProgress,
  mapBlocks,
  mapStats,
  newProcessUrl,
  nextStep,
  resultLabel,
  strictestOf,
  supportOf,
  throughText,
  toMinutes,
} from './businessMapModel';

// made-up data
const proc = (name: string, domain: string, extra: Partial<MapProcess> = {}): MapProcess => ({
  ref: `businessprocess:customer/${name}`,
  name,
  namespace: 'customer',
  title: name,
  domain,
  owner: 'group:default/team',
  criticality: 'standard',
  requirement: { rpo: '24h', rto: '72h', retention: null, from: { rpo: 'default', rto: 'default' } },
  dependsOn: [],
  result: 'meets',
  gaps: [],
  services: [],
  dataProducts: [],
  ...extra,
});

const MAP: MapData = {
  namespace: 'customer',
  namespaces: ['customer'],
  models: [{ ref: 'referencemodel:default/customer', title: 'Own model', source: 'customer', namespace: 'customer' }],
  defaults: {},
  domains: [
    { ref: 'domain:customer/sales', title: 'Sales' },
    { ref: 'domain:customer/orders', title: 'Orders', parent: 'domain:customer/sales' },
    { ref: 'domain:customer/returns', title: 'Returns', parent: 'domain:customer/orders' },
    { ref: 'domain:customer/finance', title: 'Finance' },
  ],
  processes: [
    proc('plan', 'domain:customer/sales'),
    proc('take', 'domain:customer/orders', { criticality: 'critical', result: 'gap', gaps: [{ element: 'component:default/s3-oneke', field: 'rpo', needs: '15m', delivers: '24h' }] }),
    proc('refund', 'domain:customer/returns', { owner: 'group:default/unassigned' }),
    proc('stray', 'domain:customer/nowhere', { owner: undefined }),
  ],
};

describe('mapBlocks', () => {
  it('nests subdomains under their level-1 domain and folds deeper levels into level 2', () => {
    const blocks = mapBlocks(MAP);
    expect(blocks.map(b => [b.domain?.title, b.count])).toEqual([
      ['Sales', 3],
      ['Finance', 0],
      [undefined, 1],
    ]);
    expect(blocks[0].subs.map(s => [s.domain?.title, s.processes.map(p => p.name)])).toEqual([
      [undefined, ['plan']],
      ['Orders', ['take', 'refund']],
    ]);
  });
  it('keeps only the gaps when asked, dropping what is left empty', () => {
    const blocks = mapBlocks(MAP, true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].subs.map(s => s.processes.map(p => p.name))).toEqual([['take']]);
  });
});

describe('mapStats', () => {
  it('counts critical, gaps and processes without owner', () => {
    const s = mapStats(MAP);
    expect([s.processes, s.critical, s.gaps, s.unowned]).toEqual([4, 1, 1, 2]);
    expect(s.model?.title).toBe('Own model');
  });
});

describe('links to the forms of the templates', () => {
  it('opens the console forms: New in a domain, Import and Adopt for a customer, Edit by the ref of the process', () => {
    expect(newProcessUrl()).toBe('/console/business-map/process/new');
    expect(newProcessUrl('domain:customer/orders')).toBe('/console/business-map/process/new?domain=domain%3Acustomer%2Forders');
    expect(importModelUrl()).toBe('/console/business-map/import');
    expect(importModelUrl('occar-a400m')).toBe('/console/business-map/import?ns=occar-a400m');
    expect(adoptModelUrl('occar-a400m')).toBe('/console/business-map/adopt?ns=occar-a400m');
    const p = proc('take', 'domain:customer/orders', { processKey: 'take-order' });
    expect(editProcessUrl(p)).toBe('/console/business-map/process/edit/customer/take');
  });
  it('builds console paths of refs', () => {
    expect(consolePath('businessprocess:customer/take')).toBe('/console/entity/customer/businessprocess/take');
  });
});

describe('texts of the check', () => {
  it('labels a gap by field and number of elements', () => {
    expect(resultLabel({ result: 'meets', gaps: [] })).toEqual({ key: 'bm.meets' });
    expect(resultLabel(MAP.processes[1])).toEqual({ key: 'bm.gap.rpo', vars: { n: 1 } });
    expect(gapText({ field: 'rto', needs: '4h', delivers: '24h' })).toBe('RTO 24h > 4h');
  });
  it('advises per element and ends with accepting the risk', () => {
    const els: CheckElement[] = [
      { ref: 'resource:default/evidence', kind: 'Resource', type: 's3-bucket', delivers: null, result: 'gap', gap: [{ field: 'rpo', needs: '15m', delivers: '24h' }] },
      { ref: 'component:default/s3-oneke', kind: 'Component', type: 'platform-service', delivers: null, result: 'gap', gap: [{ field: 'rpo', needs: '15m', delivers: '24h' }] },
      { ref: 'component:default/shop', kind: 'Component', type: 'business-application', delivers: null, result: 'meets' },
    ];
    expect(closeAdvice(els).map(x => x.key)).toEqual(['bm.fix.block', 'bm.fix.service', 'bm.fix.accept']);
    expect(closeAdvice([])).toEqual([]);
    const cols = chainColumns(els);
    expect([cols.applications.length, cols.blocks.length, cols.platform.length]).toEqual([1, 1, 1]);
  });
});

describe('impact', () => {
  it('sums up the processes above an element', () => {
    const s = impactSummary({
      processes: [
        { ref: 'a', title: 'a', namespace: 'c', criticality: 'important', needs: { rpo: '4h', rto: '24h' }, through: [], result: 'gap' },
        { ref: 'b', title: 'b', namespace: 'c', criticality: 'critical', needs: { rpo: '15m', rto: '4h' }, through: [], result: 'meets' },
      ],
    });
    expect(s).toEqual({ count: 2, strictest: 'critical', needs: { rpo: '15m', rto: '4h' }, gaps: 1 });
    expect(strictestOf([null, '2d', '30m'])).toBe('30m');
    expect(toMinutes('2d')).toBe(2880);
    expect(throughText(['system:default/docs', 'component:default/docs', 'resource:default/docs-records'])).toBe('docs → docs-records');
  });
});

describe('framework lines', () => {
  const today = new Date('2026-11-08T00:00:00Z');
  it('says the support of a line', () => {
    expect(supportOf({ supportedUntil: '2027-04-16', lifecycle: 'deprecated' }, today)).toEqual({ state: 'ending', monthsLeft: 5 });
    expect(supportOf({ supportedUntil: '2026-01-01' }, today).state).toBe('unsupported');
    expect(supportOf({ supportedUntil: '2028-01-01', lifecycle: 'deprecated' }, today).state).toBe('deprecated');
    expect(supportOf({ supportedUntil: 'while it is the latest line' }, today)).toEqual({ state: 'supported' });
    expect(compareVersions('3.10', '3.2')).toBeGreaterThan(0);
  });
  it('gives the next step of each service and how far the migration is', () => {
    const L = 'component:default/fw-2-0';
    const st = (stage: string, version: string, line: string) => ({ stage, instance: `i-${stage}`, line, version });
    const petstore: LineService = { ref: 'system:default/petstore', title: 'petstore', stages: [st('pro', '2.0', L), st('pre', '2.0', L), st('dev', '3.2', 'x')], processes: [] };
    const logistics: LineService = { ref: 'system:default/logistics', title: 'logistics', stages: [st('pro', '2.0', L), st('pre', '3.3', 'y'), st('dev', '3.3', 'y')], processes: [] };
    const fresh: LineService = { ref: 'system:default/fresh', title: 'fresh', stages: [st('pro', '2.0', L)], processes: [] };
    expect(nextStep(petstore, [L])).toEqual({ key: 'bm.line.testThenPromote', vars: { version: '3.2' } });
    expect(nextStep(logistics, [L])).toEqual({ key: 'bm.line.promotePro', vars: { version: '3.3' } });
    expect(nextStep(fresh, [L])).toEqual({ key: 'bm.line.startDev' });
    expect(lineProgress([petstore, logistics, fresh], [L])).toEqual({ inPro: 3, moved: 2 });
  });
});
