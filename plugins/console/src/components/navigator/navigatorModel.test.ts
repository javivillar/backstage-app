import type { Entity } from '@backstage/catalog-model';
import type { MapData, MapProcess, MapService } from '../../businessMap';
import type { App, Plan } from '../../protection';
import { copiesLight, cronMinutes, foldId, FOLD, instancesOf, layout, lightOf, lossOf, navigator, pick, planMinutes, processesOf, threadOf, tourOf, visibleOf } from './navigatorModel';

// made-up customer: two domains (one with a subdomain), three processes (one with a sub-process), two applications
const service = (name: string, result: MapService['result'] = 'meets'): MapService => ({ ref: `system:default/${name}`, title: name, delivers: null, result, gaps: [] });
const proc = (name: string, domain: string, criticality: MapProcess['criticality'], rpo: string, services: MapService[], extra: Partial<MapProcess> = {}): MapProcess => ({
  ref: `businessprocess:acme/${name}`,
  name,
  namespace: 'acme',
  title: name,
  domain: `domain:acme/${domain}`,
  criticality,
  requirement: { rpo, rto: '4h', retention: '10y', from: { rpo: 'default', rto: 'default' } },
  dependsOn: services.map(s => s.ref),
  result: services.some(s => s.result === 'gap') ? 'gap' : 'meets',
  gaps: [],
  services,
  dataProducts: [],
  ...extra,
});
const MAP: Pick<MapData, 'domains' | 'processes'> = {
  domains: [
    { ref: 'domain:acme/maintenance', title: 'Maintenance' },
    { ref: 'domain:acme/line', title: 'Line', parent: 'domain:acme/maintenance' },
    { ref: 'domain:acme/stores', title: 'Stores' },
  ],
  processes: [
    proc('fix-defects', 'line', 'critical', '15m', [service('techlog')]),
    proc('raise-report', 'line', 'critical', '15m', [service('techlog')], { parent: 'businessprocess:acme/fix-defects' }),
    proc('plan-checks', 'maintenance', 'standard', '24h', [service('techlog'), service('planner', 'gap')]),
    proc('ship-parts', 'stores', 'important', '4h', [service('planner')]),
  ],
};
const app = (name: string, plan: string, state: App['state'], volumes: string[]): App => ({
  app: `${name}-oneke`, namespace: `acme-${name}-oneke`, plan, holdsStore: false, state,
  volumes: volumes.map(v => ({ name: v, bytes: 2 ** 30, snapshots: 1, snapshotBytes: 0 })),
  volumeBytes: volumes.length * 2 ** 30, snapshotBytes: 0, snapshotTimes: [], backupBytes: 0, backups: [],
});
const PLANS: Record<string, Plan> = { critical: { snapshot: { cron: '0 */6 * * *', retain: 8 }, backup: { cron: '0 2 * * *', ttl: '336h' } }, standard: { backup: { cron: '30 2 * * *', ttl: '168h' } } };
const PROTECTION = { apps: [app('techlog', 'critical', 'ok', ['postgres-data', 'uploads'])], plans: PLANS };
const instance = (name: string, system: string, stage?: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', annotations: { 'backstage.io/kubernetes-namespace': `acme-${name}`, 'refresquito.io/framework-line': '3.3', ...(stage ? { 'refresquito.io/stage': stage } : {}) } },
  spec: { type: 'application-instance', system },
});
const INSTANCES = instancesOf([instance('techlog-oneke', 'techlog'), instance('techlog-dev-oneke', 'techlog', 'dev')]);
const nav = () => navigator({ map: MAP, protection: PROTECTION, instances: INSTANCES });
const pid = (name: string) => `businessprocess:acme/${name}`;
const aid = (name: string) => `app:system:default/${name}`;

describe('continuity navigator model', () => {
  it('reads how far apart the copies of a plan are', () => {
    expect(cronMinutes('0 */6 * * *')).toBe(360);
    expect(cronMinutes('0 2 * * *')).toBe(1440);
    expect(cronMinutes('0 4 * * 0')).toBe(10080);
    expect(cronMinutes('*/15 * * * *')).toBe(15);
    expect(cronMinutes('0 0,12 * * *')).toBe(720);
    expect(cronMinutes('0 2 1 * *')).toBeUndefined();
    expect(cronMinutes(undefined)).toBeUndefined();
    expect(planMinutes(PLANS.critical)).toBe(360);
    expect(planMinutes(PLANS.standard)).toBe(1440);
    expect(planMinutes(undefined)).toBeUndefined();
  });

  it('finds the pro instance of a service: its namespace and its framework line', () => {
    expect(INSTANCES.get('system:default/techlog')).toEqual({ namespace: 'acme-techlog-oneke', line: '3.3' });
    expect(INSTANCES.get('component:default/techlog-dev-oneke')?.namespace).toBe('acme-techlog-dev-oneke');
  });

  it('puts every level in its column and links them from the domain to the data', () => {
    const n = nav();
    expect(n.columns.map(c => c.length)).toEqual([2, 1, 3, 1, 2, 2, 2]);
    expect(n.nodes.get('domain:acme/line')?.kind).toBe('sub');
    expect(n.nodes.get(pid('raise-report'))?.kind).toBe('subp');
    const techlog = n.nodes.get(aid('techlog'))!;
    expect(techlog.app?.namespace).toBe('acme-techlog-oneke');
    expect(techlog.line).toBe('3.3');
    expect(techlog.every).toBe(360);
    // the data of an application, then its digital continuity; an application without volumes goes straight to it
    expect(techlog.down).toEqual([`data:${aid('techlog')}/postgres-data`, `data:${aid('techlog')}/uploads`]);
    expect(n.nodes.get(aid('planner'))!.down).toEqual([`dig:${aid('planner')}`]);
    expect(n.nodes.get('domain:acme/maintenance')).toMatchObject({ processes: 2, critical: 1 });
  });

  it('lights a gap when the copies are further apart than the business accepts', () => {
    expect(copiesLight(PROTECTION.apps[0], 360, 15)).toBe('bad');
    expect(copiesLight(PROTECTION.apps[0], 360, 1440)).toBe('ok');
    expect(copiesLight(app('x', 'none', 'noplan', []), undefined, 1440)).toBe('bad');
    expect(copiesLight(app('x', 'critical', 'late', []), 360, 1440)).toBe('warn');
    expect(copiesLight(undefined, undefined, 15)).toBe('na');
    const n = nav();
    // 6 h between copies: a gap for the process that accepts 15 min, enough for the one that accepts 24 h
    expect(n.nodes.get(pid('fix-defects'))).toMatchObject({ check: 'ok', data: 'bad' });
    expect(n.nodes.get(pid('plan-checks'))).toMatchObject({ check: 'bad', data: 'ok' });
    // nothing is known of the copies of planner: not checked
    expect(n.nodes.get(pid('ship-parts'))).toMatchObject({ check: 'ok', data: 'na' });
    // an application answers to the tightest process above it, a domain to its worst process
    expect(n.nodes.get(aid('techlog'))).toMatchObject({ data: 'bad', rpo: 15 });
    expect(n.nodes.get('domain:acme/maintenance')).toMatchObject({ check: 'bad', data: 'bad' });
    expect(n.nodes.get('domain:acme/stores')).toMatchObject({ check: 'ok', data: 'na' });
    expect(lightOf(n.nodes.get(pid('plan-checks'))!, 'data')).toBe('ok');
    expect(lightOf(n.nodes.get(pid('plan-checks'))!, 'both')).toBe('bad');
  });

  it('leaves the data continuity unchecked when the cluster does not give it', () => {
    const n = navigator({ map: MAP });
    expect(n.dataKnown).toBe(false);
    expect(n.columns[5]).toEqual([]);
    expect(n.nodes.get(pid('fix-defects'))?.data).toBe('na');
  });

  it('keeps the thread of what is selected and narrows it step by step', () => {
    const n = nav();
    expect(threadOf(n, aid('planner'))).toEqual(new Set([aid('planner'), `dig:${aid('planner')}`, pid('plan-checks'), pid('ship-parts'), 'domain:acme/maintenance', 'domain:acme/stores']));
    let trail = pick(n, [], 'domain:acme/maintenance');
    trail = pick(n, trail, pid('plan-checks'));
    trail = pick(n, trail, aid('planner'));
    expect(trail).toEqual(['domain:acme/maintenance', pid('plan-checks'), aid('planner')]);
    // only the way through that process, not everything the application serves
    expect([...visibleOf(n, trail)].sort()).toEqual([aid('planner'), `dig:${aid('planner')}`, pid('plan-checks'), 'domain:acme/maintenance'].sort());
    // one of the trail goes back to it, the last one again goes back a step, anything else starts again
    expect(pick(n, trail, pid('plan-checks'))).toEqual(['domain:acme/maintenance', pid('plan-checks')]);
    expect(pick(n, trail, aid('planner'))).toEqual(['domain:acme/maintenance', pid('plan-checks')]);
    expect(pick(n, trail, 'domain:acme/stores')).toEqual(['domain:acme/stores']);
    expect(visibleOf(n, []).size).toBe(n.nodes.size);
  });

  it('places every box in its column and draws the links between columns', () => {
    const n = nav();
    const all = layout(n, visibleOf(n, []), 'both', 1400);
    expect(all.width).toBe(1400);
    expect(all.boxes).toHaveLength(n.nodes.size);
    expect(all.columns.map(c => c.count)).toEqual([2, 1, 3, 1, 2, 2, 2]);
    const x = (id: string) => all.boxes.find(b => b.id === id)!.x;
    expect(x('domain:acme/line')).toBeGreaterThan(x('domain:acme/maintenance'));
    expect(x(aid('techlog'))).toBeGreaterThan(x(pid('raise-report')));
    // from the process to the application, as that application is for that process
    expect(all.links.find(l => l.from === pid('plan-checks') && l.to === aid('planner'))?.light).toBe('bad');
    expect(all.links.find(l => l.from === pid('plan-checks') && l.to === aid('techlog'))?.light).toBe('ok');
    expect(all.links.find(l => l.from === pid('fix-defects') && l.to === aid('techlog'))?.light).toBe('bad');
    expect(layout(n, visibleOf(n, []), 'both', 300).width).toBe(1120);
  });

  it('folds a crowded column into one box and keeps the links through it', () => {
    const many = Array.from({ length: FOLD + 1 }, (_, i) => proc(`p${i}`, 'stores', 'standard', '24h', [service('planner')]));
    const n = navigator({ map: { domains: MAP.domains, processes: many } });
    const l = layout(n, visibleOf(n, []), 'both', 1400);
    expect(l.columns[2]).toMatchObject({ count: FOLD + 1, folded: true });
    expect(l.boxes.filter(b => b.col === 2)).toEqual([expect.objectContaining({ id: foldId(2), fold: { count: FOLD + 1, gaps: 0 } })]);
    expect(l.links.map(k => k.key)).toEqual(expect.arrayContaining([`domain:acme/stores>${foldId(2)}`, `${foldId(2)}>${aid('planner')}`]));
    // selecting one of them opens the column
    expect(layout(n, visibleOf(n, [pid('p3')]), 'both', 1400).columns[2]).toMatchObject({ count: 1, folded: false });
  });

  it('says what a loss reaches', () => {
    const n = nav();
    const loss = lossOf(n, `data:${aid('techlog')}/postgres-data`);
    expect(loss).toMatchObject({ processes: 2, critical: 1, domains: 1, rpo: 15, every: 360 });
    expect(loss.hit.has(pid('raise-report'))).toBe(true);
    expect(loss.hit.has('domain:acme/stores')).toBe(false);
    expect(lossOf(n, aid('planner'))).toMatchObject({ processes: 2, domains: 2, app: undefined });
  });

  it('lists the processes on screen worst first, and walks the tour down the first critical gap', () => {
    const n = nav();
    expect(processesOf(n, visibleOf(n, []), 'both').map(p => p.title)).toEqual(['fix-defects', 'raise-report', 'plan-checks', 'ship-parts']);
    expect(tourOf(n)).toEqual(['domain:acme/maintenance', 'domain:acme/line', pid('fix-defects'), aid('techlog'), `data:${aid('techlog')}/postgres-data`]);
    expect(tourOf(navigator({ map: { domains: [], processes: [] } }))).toEqual([]);
  });
});
