import type { MapData, MapDomain, MapProcess } from '../../businessMap';
import { appMatcher, glassView, type GlassOptions, groupProcess, readGlassParams, writeGlassParams } from './glassViewModel';

// made-up models
const NS = 'customer';
const dom = (name: string, id: string, parent?: string): MapDomain => ({ ref: `domain:${NS}/${name}`, title: name, pcfId: id, ...(parent ? { parent: `domain:${NS}/${parent}` } : {}) });
const proc = (name: string, domain: string, extra: Partial<MapProcess> = {}): MapProcess => ({
  ref: `businessprocess:${NS}/${name}`,
  name,
  namespace: NS,
  title: name,
  domain: `domain:${NS}/${domain}`,
  criticality: 'standard',
  requirement: { rpo: '24h', rto: '72h', retention: null, from: { rpo: 'default', rto: 'default' } },
  dependsOn: [],
  result: 'unknown',
  gaps: [],
  services: [],
  dataProducts: [],
  ...extra,
});
const mapOf = (domains: MapDomain[], processes: MapProcess[]): MapData => ({ namespace: NS, namespaces: [NS], models: [], defaults: {}, domains, processes });
const DEFAULT: GlassOptions = { linked: true, level: 'subdomains', open: new Set(), domains: new Set(), critical: 'all', search: '' };
const title = (kind: 'folded' | 'unlinked', n: number) => (kind === 'folded' ? `${n} processes` : `+${n} without applications`);
const SHOP = ['system:default/shop'];

// two level-1 domains; repairs has linked processes, office none
const SMALL = mapOf(
  [dom('after-sales', '6.0'), dom('repairs', '6.3', 'after-sales'), dom('parts', '6.4', 'after-sales'), dom('office', '7.0'), dom('pay', '7.1', 'office')],
  [
    proc('repair', 'repairs', { dependsOn: SHOP, criticality: 'critical', requirement: { rpo: '15m', rto: '4h', retention: null, from: { rpo: 'default', rto: 'default' } }, result: 'gap' }),
    proc('plan', 'repairs', { parent: `businessprocess:${NS}/repair`, dependsOn: SHOP, criticality: 'critical' }),
    proc('order', 'repairs', { dependsOn: ['system:default/stock'], criticality: 'important' }),
    proc('quote', 'repairs'),
    proc('count-parts', 'parts'),
    proc('pay-people', 'pay', { description: 'Payroll of the month' }),
  ],
);
const names = (v: ReturnType<typeof glassView>) => ({
  domains: v.map.domains.map(d => d.ref.split('/')[1]),
  processes: v.map.processes.map(p => `${p.title}@${p.domain.split('/')[1]}`),
});

describe('glassView', () => {
  it('by default: subdomains with linked processes, linked processes folded, the rest one node per domain', () => {
    const v = glassView(SMALL, DEFAULT, title);
    expect(names(v)).toEqual({
      domains: ['after-sales', 'repairs', 'office'],
      processes: ['2 processes@repairs', '+1 without applications@repairs', '+1 without applications@after-sales', '+1 without applications@office'],
    });
    // the folded group keeps the applications, the strictest need and the worst check
    const g = v.map.processes[0];
    expect([g.dependsOn, g.criticality, g.requirement.rpo, g.requirement.rto, g.result]).toEqual([['system:default/shop', 'system:default/stock'], 'critical', '15m', '4h', 'gap']);
    expect(v.groups.get(g.ref)).toEqual({ ref: g.ref, kind: 'folded', scope: `domain:${NS}/repairs`, members: [`businessprocess:${NS}/repair`, `businessprocess:${NS}/order`] });
    // quote has no application and stays in repairs (drawn); count-parts is in parts, not drawn: after-sales
    expect(v.groups.get(v.map.processes[1].ref)!.members).toEqual([`businessprocess:${NS}/quote`]);
    expect(v.groups.get(v.map.processes[2].ref)!.members).toEqual([`businessprocess:${NS}/count-parts`]);
  });
  it('the processes of a drawn subdomain without applications fold in it', () => {
    const v = glassView(SMALL, { ...DEFAULT, level: 'processes' }, title);
    expect(names(v).processes).toEqual(['repair@repairs', 'order@repairs', '+1 without applications@repairs', '+1 without applications@after-sales', '+1 without applications@office']);
  });
  it('all processes, a domain level, open domains and processes', () => {
    expect(names(glassView(SMALL, { ...DEFAULT, linked: false, level: 'domains' }, title))).toEqual({
      domains: ['after-sales', 'office'],
      processes: ['4 processes@after-sales', '1 processes@office'],
    });
    const open = new Set([`domain:${NS}/repairs`, `businessprocess:${NS}/repair`]);
    expect(names(glassView(SMALL, { ...DEFAULT, linked: false, open }, title)).processes).toEqual([
      'repair@repairs',
      'plan@repairs',
      'order@repairs',
      'quote@repairs',
      '1 processes@parts',
      '1 processes@pay',
    ]);
  });
  it('filters by level-1 domain and by effective criticality', () => {
    expect(names(glassView(SMALL, { ...DEFAULT, domains: new Set([`domain:${NS}/office`]) }, title)).domains).toEqual(['office']);
    expect(names(glassView(SMALL, { ...DEFAULT, critical: 'critical', level: 'processes', open: new Set([`businessprocess:${NS}/repair`]) }, title)).processes).toEqual(['repair@repairs', 'plan@repairs']);
    expect(names(glassView(SMALL, { ...DEFAULT, critical: 'important', level: 'processes' }, title)).processes).toEqual(['repair@repairs', 'order@repairs']);
  });
  it('a search draws only the matches, each on its own, with or without applications', () => {
    expect(names(glassView(SMALL, { ...DEFAULT, search: 'payroll' }, title))).toEqual({ domains: ['office', 'pay'], processes: ['pay-people@pay'] });
    const byApp = glassView(SMALL, { ...DEFAULT, search: 'stock', appMatch: p => p.dependsOn.includes('system:default/stock') }, title);
    expect(names(byApp).processes).toEqual(['order@repairs']);
  });
  it('an APQC-sized model draws tens of nodes by default', () => {
    const domains: MapDomain[] = [];
    const processes: MapProcess[] = [];
    for (let a = 1; a <= 13; a++) {
      domains.push(dom(`d${a}`, `${a}.0`));
      for (let b = 1; b <= 6; b++) {
        domains.push(dom(`d${a}-${b}`, `${a}.${b}`, `d${a}`));
        for (let c = 1; c <= 25; c++) {
          const linked = a <= 3 && b === 1 && c <= 2;
          processes.push(proc(`p${a}-${b}-${c}`, `d${a}-${b}`, linked ? { dependsOn: [`system:default/app${a}`] } : {}));
        }
      }
    }
    const big = mapOf(domains, processes);
    expect(big.domains.length + big.processes.length).toBe(91 + 1950);
    const v = glassView(big, DEFAULT, title);
    expect(v.drawn).toBeLessThan(40);
    expect(names(v).domains).toHaveLength(13 + 3);
    expect(glassView(big, { ...DEFAULT, linked: false }, title).drawn).toBeGreaterThan(150);
    expect(glassView(big, { ...DEFAULT, linked: false, level: 'domains' }, title).drawn).toBe(26);
  });
  it('the small own model: 7 domains, 18 subdomains, 43 processes, 2 sub-processes', () => {
    const domains: MapDomain[] = [];
    const processes: MapProcess[] = [];
    let n = 0;
    for (let a = 1; a <= 7; a++) {
      domains.push(dom(`m${a}`, `M${a}`));
      for (let b = 1; b <= (a <= 4 ? 3 : 2); b++) {
        domains.push(dom(`m${a}-${b}`, `M${a}.${b}`, `m${a}`));
        for (let c = 1; c <= (n < 25 ? 3 : 2) && n < 43; c++, n++) processes.push(proc(`q${n}`, `m${a}-${b}`, n % 3 === 0 ? { dependsOn: SHOP } : {}));
      }
    }
    processes.push(proc('q0-a', 'm1-1', { parent: `businessprocess:${NS}/q0`, dependsOn: SHOP }), proc('q0-b', 'm1-1', { parent: `businessprocess:${NS}/q0`, dependsOn: SHOP }));
    expect([domains.length, processes.filter(p => !p.parent).length]).toEqual([25, 43]);
    const v = glassView(mapOf(domains, processes), DEFAULT, title);
    expect(v.drawn).toBeLessThan(60);
    const open = glassView(mapOf(domains, processes), { ...DEFAULT, open: new Set([`domain:${NS}/m1-1`, `businessprocess:${NS}/q0`]) }, title);
    expect(names(open).processes.filter(x => x.startsWith('q0'))).toEqual(['q0@m1-1', 'q0-a@m1-1', 'q0-b@m1-1']);
  });
});

describe('groupProcess and appMatcher', () => {
  it('a group of no members is a quiet node', () => {
    expect(groupProcess(`businessprocess:${NS}/~unlinked~x`, `domain:${NS}/x`, '+0', [], false)).toMatchObject({ criticality: 'standard', result: 'unknown', dependsOn: [] });
  });
  it('finds the processes whose chain holds the application', () => {
    const nodes = [
      { id: 'system:default/shop', label: 'Shop', name: 'shop' },
      { id: 'component:default/shop-oneke', label: 'shop-oneke', name: 'shop-oneke' },
      { id: 'component:default/postgres-oneke', label: 'Postgres', name: 'postgres-oneke' },
    ];
    const links = [
      { source: 'system:default/shop', target: 'component:default/shop-oneke' },
      { source: 'component:default/shop-oneke', target: 'component:default/postgres-oneke' },
    ];
    const m = appMatcher(SMALL, nodes, links, 'postgres');
    expect(SMALL.processes.filter(m).map(p => p.name)).toEqual(['repair', 'plan']);
    expect(SMALL.processes.filter(appMatcher(SMALL, nodes, links, '')).length).toBe(0);
  });
});

describe('the URL of the view', () => {
  it('reads and writes only what differs from the default', () => {
    const o = readGlassParams(new URLSearchParams('ns=customer&domains=office,after-sales&detail=processes&linked=0&open=repairs,p:repair&crit=critical&q=pay'), NS);
    expect(o).toEqual({
      linked: false,
      level: 'processes',
      open: new Set([`domain:${NS}/repairs`, `businessprocess:${NS}/repair`]),
      domains: new Set([`domain:${NS}/office`, `domain:${NS}/after-sales`]),
      critical: 'critical',
      search: 'pay',
    });
    expect(writeGlassParams(new URLSearchParams('ns=customer'), o).toString()).toBe('ns=customer&linked=0&detail=processes&open=p%3Arepair%2Crepairs&domains=after-sales%2Coffice&crit=critical&q=pay');
    expect(writeGlassParams(new URLSearchParams('ns=customer&detail=domains'), readGlassParams(new URLSearchParams(''), NS)).toString()).toBe('ns=customer');
  });
});
