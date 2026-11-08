import type { Entity } from '@backstage/catalog-model';
import { BUSINESS_LAYERS, stackLayout } from '../depsModel';
import { CATALOG, MAP, NOW } from './fixture';
import {
  affectedBy,
  blastOf,
  businessGraph,
  checkOf,
  continuityOf,
  criticalityOf,
  formatMinutes,
  frameworkOf,
  healthOfNode,
  litOf,
  minutesOf,
  processCheck,
  radiusOf,
  supportOf,
} from './glassModel';

const health = (e: Entity) => (e.metadata.name === 'seaweedfs-oneke' ? { tone: 'warn' as const, label: 'Progressing' } : { tone: 'ok' as const, label: 'Healthy' });
const g = businessGraph(MAP, CATALOG, health);
const proc = (n: string) => `businessprocess:occar/${n}`;
const comp = (n: string) => `component:default/${n}`;

describe('glassModel', () => {
  it('reads durations as the backend does', () => {
    expect(minutesOf('15m')).toBe(15);
    expect(minutesOf('1 h')).toBe(60);
    expect(minutesOf('15 min')).toBe(15);
    expect(minutesOf('30y')).toBe(30 * 525600);
    expect(minutesOf('soon')).toBeUndefined();
    expect(formatMinutes(240)).toBe('4h');
    expect(formatMinutes(-180)).toBe('-3h');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(15)).toBe('15m');
  });

  it('puts domains and processes on top and keeps only production in the chains', () => {
    const layer = (id: string) => g.byId.get(id)?.layer;
    expect(layer('domain:occar/service-after-sales')).toBe('dom');
    expect(layer(proc('repair'))).toBe('proc');
    expect(layer('system:default/maintenance')).toBe('biz');
    expect(g.byId.has(comp('maintenance-dev-oneke'))).toBe(false);
    expect([...g.below.get(proc('repair'))!].sort()).toEqual(
      [comp('maintenance'), comp('maintenance-oneke'), comp('python-framework-3-2'), comp('seaweedfs-oneke'), 'resource:default/maintenance-bucket', 'system:default/maintenance'].sort(),
    );
    expect(g.links.some(l => l.source === 'domain:occar/service-after-sales' && l.target === 'domain:occar/maintenance')).toBe(true);
  });

  it('inherits the criticality down and takes the strictest', () => {
    expect(criticalityOf(g, comp('seaweedfs-oneke'))).toBe('critical');
    expect(criticalityOf(g, comp('iam-oneke'))).toBe('critical');
    expect(criticalityOf(g, comp('logistics-oneke'))).toBe('important');
    expect(criticalityOf(g, 'domain:occar/it')).toBe('critical');
  });

  it('checks RPO first, then RTO, and lets a gap flow up', () => {
    expect(checkOf({ rpo: 15, rto: 240 }, { rpo: 1440, rto: 600 })).toBe('rpo');
    expect(checkOf({ rpo: 15, rto: 240 }, { rpo: 15, rto: 600 })).toBe('rto');
    expect(checkOf({ rpo: 15, rto: 240 }, { rpo: 15 })).toBe('unknown');
    expect(processCheck(g, proc('repair'))).toBe('rpo');
    expect(processCheck(g, proc('spares'))).toBe('meets');
    expect(processCheck(g, proc('onboard'))).toBe('unknown');
    expect(continuityOf(g, comp('seaweedfs-oneke'))).toBe('rpo');
    expect(continuityOf(g, 'system:default/maintenance')).toBe('rpo');
    expect(continuityOf(g, 'domain:occar/service-after-sales')).toBe('rpo');
    expect(continuityOf(g, comp('python-framework-3-2'))).toBe('na');
  });

  it('says the support of the framework lines', () => {
    expect(supportOf(CATALOG.find(e => e.metadata.name === 'python-framework-3-2')!, NOW).support).toBe('ending');
    expect(supportOf(CATALOG.find(e => e.metadata.name === 'python-framework-3-3')!, NOW).support).toBe('supported');
    expect(supportOf(CATALOG.find(e => e.metadata.name === 'python-framework-2-0')!, NOW).support).toBe('deprecated');
    expect(supportOf(CATALOG.find(e => e.metadata.name === 'python-framework-2-0')!, Date.parse('2027-05-01')).support).toBe('unsupported');
    expect(frameworkOf(g, proc('repair'), NOW)).toBe('ending');
    expect(frameworkOf(g, proc('spares'), NOW)).toBe('deprecated');
    expect(frameworkOf(g, 'domain:occar/service-after-sales', NOW)).toBe('deprecated');
    expect(frameworkOf(g, comp('iam-oneke'), NOW)).toBe('na');
    expect(frameworkOf(g, proc('onboard'), NOW)).toBe('none');
  });

  it('lets the health of the elements flow up to the business', () => {
    expect(healthOfNode(g, comp('seaweedfs-oneke'))).toBe('warn');
    expect(healthOfNode(g, proc('repair'))).toBe('warn');
    expect(healthOfNode(g, proc('access'))).toBe('ok');
    expect(healthOfNode(g, proc('onboard'))).toBe('off');
  });

  it('sizes a service by its blast radius and lists what stops, strictest first', () => {
    expect(blastOf(g, comp('iam-oneke'))).toEqual({ processes: 2, critical: 1, weight: 3 });
    expect(radiusOf(g, comp('iam-oneke'))).toBeGreaterThan(radiusOf(g, comp('seaweedfs-oneke')));
    expect(affectedBy(g, comp('iam-oneke')).map(p => p.title)).toEqual(['Grant access', 'Manage spare parts']);
    expect(affectedBy(g, 'domain:occar/it').map(p => p.title)).toEqual(['Grant access', 'Onboard staff']);
  });

  it('lights the chain of a node up and down, not its siblings', () => {
    const lit = litOf(g, comp('seaweedfs-oneke'));
    expect(lit.has(proc('repair'))).toBe(true);
    expect(lit.has('domain:occar/service-after-sales')).toBe(true);
    expect(lit.has(comp('iam-oneke'))).toBe(false);
    expect(lit.has(proc('spares'))).toBe(false);
  });

  it('lays the business glass out with two more bands on top', () => {
    const pos = stackLayout(g.nodes, g.links, BUSINESS_LAYERS);
    expect(pos.get('domain:occar/it')!.y).toBeLessThan(pos.get(proc('access'))!.y);
    expect(pos.get(proc('access'))!.y).toBeLessThan(pos.get('system:default/personnel')!.y);
    expect(pos.size).toBe(g.nodes.length);
  });
});
