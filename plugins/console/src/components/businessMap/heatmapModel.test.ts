import type { Entity } from '@backstage/catalog-model';
import { CATALOG, MAP, NOW } from './fixture';
import { businessGraph } from './glassModel';
import { criticalOf, type HeatSources, heatTree, imagesOf, incidentsOf, tileOf, worstTile } from './heatmapModel';

const health = (e: Entity) => (e.metadata.name === 'seaweedfs-oneke' ? { tone: 'warn' as const, label: 'Progressing' } : { tone: 'ok' as const, label: 'Healthy' });
const g = businessGraph(MAP, CATALOG, health);
const P = (n: string) => `businessprocess:occar/${n}`;
const sources: HeatSources = {
  health: true,
  incidents: new Map([
    ['component:default/maintenance-oneke', 4],
    ['system:default/maintenance', 3],
  ]),
  critical: new Map([
    ['img/m:1', 2],
    ['img/m-web:1', 0],
  ]),
  cost: new Map([['ns-maintenance-oneke', 1840]]),
  namespaceOf: e => `ns-${e.metadata.name}`,
  now: NOW,
};
const none: HeatSources = { health: false, namespaceOf: () => undefined, now: NOW };

describe('heatmapModel', () => {
  it('groups processes by top domain and subdomain', () => {
    const tree = heatTree(MAP);
    expect(tree.map(d => d.title)).toEqual(['Service after sales', 'Information technology']);
    expect(tree[0].groups.map(x => [x.title, x.processes.length])).toEqual([
      ['Service after sales', 1],
      ['Maintenance and repair', 1],
    ]);
    expect(tree[1].processes).toEqual([P('access'), P('onboard')]);
  });

  it('colours continuity by the worst gap and names the element', () => {
    expect(tileOf('continuity', g, P('repair'), sources)).toEqual({ level: 3, key: 'bmd.v.rpoGap', vars: { through: 'seaweedfs-oneke' } });
    expect(tileOf('continuity', g, P('spares'), sources).level).toBe(0);
    expect(tileOf('continuity', g, P('onboard'), sources)).toEqual({ level: 'none', key: 'bmd.v.noCheck' });
  });

  it('reads health, incidents, vulnerabilities and cost from their sources', () => {
    expect(tileOf('health', g, P('repair'), sources).level).toBe(1);
    expect(tileOf('incidents', g, P('repair'), sources)).toEqual({ level: 3, key: 'bmd.v.incidents', vars: { n: 7 } });
    expect(tileOf('incidents', g, P('access'), sources)).toEqual({ level: 0, key: 'bmd.v.incidents', vars: { n: 0 } });
    expect(imagesOf(g, P('repair'))).toEqual(['img/m:1', 'img/m-web:1']);
    expect(tileOf('vulns', g, P('repair'), sources)).toEqual({ level: 2, key: 'bmd.v.critical', vars: { n: 2 } });
    expect(tileOf('vulns', g, P('spares'), sources).key).toBe('bmd.v.noData');
    expect(tileOf('cost', g, P('repair'), sources)).toEqual({ level: 3, key: 'bmd.v.cost', vars: { total: 1840 } });
  });

  it('shows no data, never fails, when a source cannot be read', () => {
    for (const lens of ['health', 'incidents', 'vulns', 'cost'] as const) expect(tileOf(lens, g, P('repair'), none)).toEqual({ level: 'none', key: 'bmd.v.noData' });
    expect(tileOf('health', g, P('onboard'), none).key).toBe('bmd.v.noApp');
    expect(tileOf('continuity', g, P('repair'), none).level).toBe(3);
  });

  it('scores readiness on owner, applications and BPMN', () => {
    expect(tileOf('readiness', g, P('repair'), sources)).toEqual({ level: 0, key: 'bmd.v.ready', vars: { pct: 100 }, parts: [] });
    expect(tileOf('readiness', g, P('spares'), sources)).toEqual({ level: 2, key: 'bmd.v.readyMissing', vars: { pct: 67 }, parts: ['bmd.ready.bpmn'] });
    expect(tileOf('readiness', g, P('onboard'), sources).level).toBe(3);
  });

  it('says the framework support of the pro instances', () => {
    expect(tileOf('framework', g, P('repair'), sources)).toEqual({ level: 2, key: 'bmd.v.fw.ending', vars: { line: 'python-framework-3-2', until: '2027-04-28' } });
    expect(tileOf('framework', g, P('spares'), sources).level).toBe(3);
    expect(tileOf('framework', g, P('access'), sources).level).toBe(0);
    expect(tileOf('framework', g, P('onboard'), sources).key).toBe('bmd.v.noApp');
  });

  it('gives a domain its worst tile', () => {
    expect(worstTile([{ level: 'none', key: 'a' }, { level: 1, key: 'b' }, { level: 3, key: 'c' }, { level: 0, key: 'd' }]).key).toBe('c');
    expect(worstTile([{ level: 'none', key: 'a' }]).key).toBe('a');
  });

  it('parses the support and sbom answers', () => {
    expect(incidentsOf({ elements: [{ ref: 'Component:default/A', priority: 'P1', count: 2 }, { ref: 'component:default/a', priority: 'P3', count: 1 }, { nope: 1 }] }).get('component:default/a')).toBe(3);
    expect(incidentsOf(null).size).toBe(0);
    expect(criticalOf({ scan: { vulns: [{ sev: 'CRITICAL' }, { sev: 'CRITICAL', not_applicable: 'kernel' }, { sev: 'HIGH' }] } })).toBe(1);
    expect(criticalOf({ scan: { counts: { CRITICAL: 4 } } })).toBe(4);
    expect(criticalOf({ scan: null })).toBeUndefined();
  });
});
