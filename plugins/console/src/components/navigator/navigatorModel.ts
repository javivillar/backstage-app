import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import type { Criticality, MapData, MapProcess } from '../../businessMap';
import type { App, AppState, Plan, Volume } from '../../protection';
import { minutesOf, normRef } from '../businessMap/glassModel';
import { isInstance, stageOf } from '../businessService';

/**
 * Continuity navigator: one map from the business domain down to the data. Seven levels, each a column: domains,
 * subdomains, processes, sub-processes, applications (what a process depends on), their data (the volumes of the
 * application, with their copies) and digital continuity (open: nothing is declared per application yet).
 *
 * Pure: the graph of a customer from the business map (GET /api/business-map/map) and the data continuity of the
 * cluster (GET /api/protection), its two lights (the declared continuity check and what the copies really give
 * against the RPO of the process), what a selection keeps on screen, where every box goes and what a loss reaches.
 */
export type Kind = 'dom' | 'sub' | 'proc' | 'subp' | 'app' | 'data' | 'dig';
export const KINDS: Kind[] = ['dom', 'sub', 'proc', 'subp', 'app', 'data', 'dig'];
/** ok: met · warn: at risk · bad: a gap · na: nothing to check */
export type Light = 'ok' | 'warn' | 'bad' | 'na';
/** what colours the map: both lights (the worst), the declared check, or the copies */
export type Lens = 'both' | 'check' | 'data';

/** Where the pro instance of a business service runs, and the framework line it is built on (from the catalog). */
export type ServiceInstance = { namespace?: string; line?: string };

export type NavNode = {
  id: string;
  kind: Kind;
  col: number;
  title: string;
  /** the entity behind it (not for data and digital continuity) */
  ref?: string;
  description?: string;
  up: string[];
  down: string[];
  /** the declared continuity check (Business continuity): RPO and RTO of the chain against the process */
  check: Light;
  /** what the copies give against the RPO of the processes above */
  data: Light;
  process?: MapProcess;
  /** minutes the processes above accept losing (the tightest); for a process, its own */
  rpo?: number;
  rto?: number;
  /** processes under a domain */
  processes?: number;
  critical?: number;
  /** an application: its data continuity in this cluster and its framework line */
  app?: App;
  line?: string;
  volume?: Volume;
  /** minutes between two copies of the data (the most frequent of snapshots and backups) */
  every?: number;
};

export type Navigator = {
  nodes: Map<string, NavNode>;
  /** ids in the order they are drawn, by column */
  columns: string[][];
  /** the data continuity of the cluster could be read */
  dataKnown: boolean;
  threads: Map<string, Set<string>>;
};

const RANK: Record<Light, number> = { na: 0, ok: 1, warn: 2, bad: 3 };
export const worst = (a: Light, b: Light): Light => (RANK[b] > RANK[a] ? b : a);
export const lightOf = (n: Pick<NavNode, 'check' | 'data'>, lens: Lens): Light => {
  if (lens === 'check') return n.check;
  return lens === 'data' ? n.data : worst(n.check, n.data);
};
const CHECK: Record<string, Light> = { meets: 'ok', gap: 'bad', unknown: 'na' };
const STATE: Record<AppState, Light> = { ok: 'ok', late: 'warn', failed: 'warn', never: 'warn', store: 'warn', noplan: 'bad' };
const min = (a: number | undefined, b: number | undefined) => {
  if (a === undefined) return b;
  return b === undefined ? a : Math.min(a, b);
};

/** Minutes between two runs of a cron line, for the schedules the protection plans use; undefined for another. */
export function cronMinutes(cron: string | undefined): number | undefined {
  if (!cron) return undefined;
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (dow === undefined || dom !== '*' || mon !== '*') return undefined;
  const step = (field: string) => {
    const s = /^\*\/(\d+)$/.exec(field);
    return s ? Number(s[1]) : undefined;
  };
  const days = dow === '*' ? 1 : undefined;
  if (h === '*') {
    if (m === '*') return 1;
    const everyM = step(m);
    if (everyM) return everyM;
    return /^\d+$/.test(m) ? 60 : undefined;
  }
  if (!/^[\d,]+$/.test(m)) return undefined;
  const everyH = step(h);
  if (everyH && days) return everyH * 60;
  if (!/^[\d,]+$/.test(h)) return undefined;
  const runs = h.split(',').length * m.split(',').length;
  if (days) return Math.round(1440 / runs);
  return /^[0-6]$/.test(dow) ? Math.round(10080 / runs) : undefined;
}

/** Minutes between two copies under a plan: the most frequent of its snapshots and its backups. */
export const planMinutes = (plan: Plan | undefined): number | undefined =>
  plan ? min(min(cronMinutes(plan.snapshot?.cron), cronMinutes(plan.backup?.cron)), cronMinutes(plan.weekly?.cron)) : undefined;

/** The copies of an application against what a process accepts losing. */
export function copiesLight(app: App | undefined, every: number | undefined, rpo: number | undefined): Light {
  if (!app) return 'na';
  const own = STATE[app.state] ?? 'na';
  if (own === 'bad') return 'bad';
  return every !== undefined && rpo !== undefined && every > rpo ? 'bad' : own;
}

const lower = (s: string) => s.toLowerCase();
/** The protected application of a service: by the namespace of its pro instance, else by its name. */
function appOf(ref: string, instance: ServiceInstance | undefined, apps: App[]): App | undefined {
  const byNs = instance?.namespace ? apps.find(a => a.namespace === instance.namespace) : undefined;
  if (byNs) return byNs;
  const name = lower(ref.slice(ref.indexOf('/') + 1)).replace(/-oneke$/, '');
  return apps.find(a => lower(a.app).replace(/-oneke$/, '') === name);
}

const NAMESPACE = 'backstage.io/kubernetes-namespace';
const LINE = 'refresquito.io/framework-line';
/**
 * Where each thing of the catalog runs: every Component with a namespace under its own ref, and the pro instance of
 * a business service under the ref of that service too (a process names the service, the data is of its instance).
 */
export function instancesOf(entities: Entity[]): Map<string, ServiceInstance> {
  const out = new Map<string, ServiceInstance>();
  for (const e of entities) {
    const ann = e.metadata.annotations ?? {};
    if (e.kind !== 'Component' || !ann[NAMESPACE]) continue;
    const it = { namespace: ann[NAMESPACE], line: ann[LINE] };
    out.set(stringifyEntityRef(e), it);
    const system = e.spec?.system;
    if (typeof system !== 'string' || !isInstance(e) || stageOf(e) !== 'pro') continue;
    try {
      out.set(stringifyEntityRef(parseEntityRef(system, { defaultKind: 'system', defaultNamespace: e.metadata.namespace ?? 'default' })), it);
    } catch {
      /* a system that is not a ref: only the instance itself is known */
    }
  }
  return out;
}

export type Sources = {
  map: Pick<MapData, 'domains' | 'processes'>;
  /** undefined when the data continuity is not available in the cluster */
  protection?: { apps: App[]; plans: Record<string, Plan> };
  /** by the ref of the service (normRef) */
  instances?: Map<string, ServiceInstance>;
};

/** The graph of a customer. */
export function navigator({ map, protection, instances }: Sources): Navigator {
  const nodes = new Map<string, NavNode>();
  const add = (n: Omit<NavNode, 'col' | 'up' | 'down' | 'check' | 'data'>): NavNode => {
    const node: NavNode = { ...n, col: KINDS.indexOf(n.kind), up: [], down: [], check: 'na', data: 'na' };
    nodes.set(n.id, node);
    return node;
  };
  const link = (a: string, b: string) => {
    const from = nodes.get(a);
    const to = nodes.get(b);
    if (!from || !to || from.down.includes(b)) return;
    from.down.push(b);
    to.up.push(a);
  };
  for (const d of map.domains) add({ id: d.ref, kind: d.parent ? 'sub' : 'dom', title: d.title, ref: d.ref, description: d.description, processes: 0, critical: 0 });
  for (const d of map.domains) if (d.parent) link(d.parent, d.ref);
  for (const p of map.processes) {
    add({ id: p.ref, kind: p.parent ? 'subp' : 'proc', title: p.title, ref: p.ref, description: p.description, process: p, rpo: minutesOf(p.requirement.rpo), rto: minutesOf(p.requirement.rto) });
  }
  for (const p of map.processes) link(p.parent ?? p.domain, p.ref);
  // applications: what the processes depend on, in the order the processes name them
  for (const p of map.processes) {
    for (const s of p.services) {
      const id = `app:${normRef(s.ref)}`;
      if (!nodes.has(id)) {
        const instance = instances?.get(normRef(s.ref));
        const app = protection ? appOf(s.ref, instance, protection.apps) : undefined;
        add({ id, kind: 'app', title: s.title, ref: s.ref, app, line: instance?.line, every: app ? planMinutes(protection?.plans[app.plan]) : undefined });
      }
      link(p.ref, id);
    }
  }
  const apps = [...nodes.values()].filter(n => n.kind === 'app');
  for (const a of apps) for (const v of a.app?.volumes ?? []) {
    add({ id: `data:${a.id}/${v.name}`, kind: 'data', title: v.name, app: a.app, volume: v, every: a.every });
    link(a.id, `data:${a.id}/${v.name}`);
  }
  for (const a of apps) {
    const id = `dig:${a.id}`;
    add({ id, kind: 'dig', title: a.title, line: a.line });
    const stores = a.down.filter(x => nodes.get(x)?.kind === 'data');
    for (const from of stores.length ? stores : [a.id]) link(from, id);
  }

  // the lights, bottom-up: a process against each application it names; an application against every process above
  const tight = new Map<string, { rpo?: number; rto?: number }>();
  for (const p of map.processes) {
    const n = nodes.get(p.ref)!;
    n.check = CHECK[p.result] ?? 'na';
    for (const s of p.services) {
      const a = nodes.get(`app:${normRef(s.ref)}`)!;
      a.check = worst(a.check, CHECK[s.result] ?? 'na');
      n.data = worst(n.data, copiesLight(a.app, a.every, n.rpo));
      const t = tight.get(a.id) ?? {};
      tight.set(a.id, { rpo: min(t.rpo, n.rpo), rto: min(t.rto, n.rto) });
    }
  }
  for (const a of apps) {
    const t = tight.get(a.id) ?? {};
    a.rpo = t.rpo;
    a.rto = t.rto;
    a.data = copiesLight(a.app, a.every, t.rpo);
    for (const id of a.down) {
      const s = nodes.get(id)!;
      if (s.kind !== 'data') continue;
      s.rpo = t.rpo;
      s.rto = t.rto;
      s.data = a.data;
    }
  }
  // a domain is as good as its worst process, and counts the top processes under it
  const domainsOf = (p: MapProcess) => {
    const out: NavNode[] = [];
    for (let d = nodes.get(p.domain); d && (d.kind === 'dom' || d.kind === 'sub') && !out.includes(d); d = d.up[0] ? nodes.get(d.up[0]) : undefined) out.push(d);
    return out;
  };
  for (const p of map.processes) {
    const n = nodes.get(p.ref)!;
    for (const d of domainsOf(p)) {
      d.check = worst(d.check, n.check);
      d.data = worst(d.data, n.data);
      if (p.parent) continue;
      d.processes = (d.processes ?? 0) + 1;
      if (p.criticality === 'critical') d.critical = (d.critical ?? 0) + 1;
      d.rpo = min(d.rpo, n.rpo);
      d.rto = min(d.rto, n.rto);
    }
  }
  const columns: string[][] = KINDS.map(() => []);
  // applications follow the processes; data and digital continuity follow their application
  for (const n of nodes.values()) if (n.col < 5) columns[n.col].push(n.id);
  for (const a of apps) {
    for (const id of a.down) if (nodes.get(id)?.kind === 'data') columns[5].push(id);
    columns[6].push(`dig:${a.id}`);
  }
  return { nodes, columns, dataKnown: !!protection, threads: new Map() };
}

/** A box with everything above and below it. */
export function threadOf(nav: Navigator, id: string): Set<string> {
  const known = nav.threads.get(id);
  if (known) return known;
  const set = new Set<string>([id]);
  const above = new Set<string>();
  const below = new Set<string>();
  const walk = (from: string, dir: 'up' | 'down') => {
    for (const next of nav.nodes.get(from)?.[dir] ?? []) {
      if (dir === 'up' ? above.has(next) : below.has(next)) continue;
      (dir === 'up' ? above : below).add(next);
      set.add(next);
      walk(next, dir);
    }
  };
  walk(id, 'up');
  walk(id, 'down');
  nav.threads.set(id, set);
  return set;
}

const isBelow = (nav: Navigator, a: string, b: string): boolean => {
  const seen = new Set<string>();
  const walk = (from: string): boolean => (nav.nodes.get(from)?.down ?? []).some(x => x === b || (!seen.has(x) && (seen.add(x), walk(x))));
  return walk(a);
};

/**
 * Selecting a box: under the last one selected it narrows the thread; the last one again goes back a step; one of
 * the trail goes back to it; anything else starts a new thread.
 */
export function pick(nav: Navigator, trail: string[], id: string): string[] {
  const last = trail[trail.length - 1];
  if (last === id) return trail.slice(0, -1);
  if (last && isBelow(nav, last, id)) return [...trail, id];
  const i = trail.indexOf(id);
  return i >= 0 ? trail.slice(0, i + 1) : [id];
}

/** What stays on screen: what is on the thread of every box of the trail (everything without a trail). */
export function visibleOf(nav: Navigator, trail: string[]): Set<string> {
  let out: Set<string> | undefined;
  for (const id of trail) {
    const t = threadOf(nav, id);
    out = out ? new Set([...out].filter(x => t.has(x))) : new Set(t);
  }
  return out ?? new Set(nav.nodes.keys());
}

export type Size = 'big' | 'med' | 'cmp';
export const SIZES: Record<Size, { h: number; gap: number }> = { big: { h: 78, gap: 10 }, med: { h: 44, gap: 6 }, cmp: { h: 22, gap: 3 } };
/** a column with more boxes than this is drawn as one box that says how many it holds */
export const FOLD = 40;
export const MIN_WIDTH = 1120;
const WEIGHT = [1.15, 1.15, 1.6, 1.25, 1.1, 1.35, 1.1];
const TOP = 54;
const PAD = 16;
const GAP = 40;

export type Box = { id: string; col: number; x: number; y: number; w: number; h: number; size: Size; fold?: { count: number; gaps: number } };
export type Link = { key: string; from: string; to: string; d: string; light: Light };
export type Column = { x: number; w: number; count: number; gaps: number; folded: boolean };
export type Layout = { width: number; height: number; columns: Column[]; boxes: Box[]; links: Link[] };
export const foldId = (col: number) => `fold:${col}`;

/** Where every box and link goes: each level a column centred on the tallest one, a crowded column folded. */
export function layout(nav: Navigator, visible: Set<string>, lens: Lens, width: number): Layout {
  const W = Math.max(width, MIN_WIDTH);
  const unit = (W - 2 * PAD - 6 * GAP) / WEIGHT.reduce((a, b) => a + b, 0);
  let x = PAD;
  const cols = nav.columns.map((ids, col) => {
    const shown = ids.filter(id => visible.has(id));
    const gaps = shown.filter(id => lightOf(nav.nodes.get(id)!, lens) === 'bad').length;
    const folded = shown.length > FOLD;
    let size: Size = 'cmp';
    if (folded || shown.length <= 7) size = 'big';
    else if (shown.length <= 13) size = 'med';
    const n = folded ? 1 : shown.length;
    const c = { col, x, w: unit * WEIGHT[col], shown, gaps, folded, size, height: n ? n * (SIZES[size].h + SIZES[size].gap) - SIZES[size].gap : 0 };
    x += c.w + GAP;
    return c;
  });
  const H = Math.max(150, ...cols.map(c => c.height));
  const boxes: Box[] = [];
  const place = new Map<string, Box>();
  for (const c of cols) {
    let y = TOP + (H - c.height) / 2;
    if (c.folded) {
      const b: Box = { id: foldId(c.col), col: c.col, x: c.x, y, w: c.w, h: SIZES.big.h, size: 'big', fold: { count: c.shown.length, gaps: c.gaps } };
      boxes.push(b);
      for (const id of c.shown) place.set(id, b);
      continue;
    }
    for (const id of c.shown) {
      const b: Box = { id, col: c.col, x: c.x, y, w: c.w, h: SIZES[c.size].h, size: c.size };
      boxes.push(b);
      place.set(id, b);
      y += SIZES[c.size].h + SIZES[c.size].gap;
    }
  }
  const links = new Map<string, Link>();
  for (const id of visible) {
    const a = nav.nodes.get(id);
    const from = place.get(id);
    if (!a || !from) continue;
    for (const next of a.down) {
      const b = nav.nodes.get(next);
      const to = place.get(next);
      if (!b || !to || to.col <= from.col) continue;
      const key = `${from.id}>${to.id}`;
      const light = linkLight(a, b, lens);
      const known = links.get(key);
      if (known) {
        known.light = worst(known.light, light);
        continue;
      }
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const y2 = to.y + to.h / 2;
      const dx = (to.x - x1) / 2;
      const f = (v: number) => v.toFixed(1);
      links.set(key, { key, from: from.id, to: to.id, light, d: `M${f(x1)} ${f(y1)} C${f(x1 + dx)} ${f(y1)} ${f(to.x - dx)} ${f(y2)} ${f(to.x)} ${f(y2)}` });
    }
  }
  return {
    width: W,
    height: TOP + H + 22,
    columns: cols.map(c => ({ x: c.x, w: c.w, count: c.shown.length, gaps: c.gaps, folded: c.folded })),
    boxes,
    links: [...links.values()],
  };
}

/** A link is as good as what it leads to; from a process to an application, as that application is for that process. */
export function linkLight(a: NavNode, b: NavNode, lens: Lens): Light {
  if (b.kind !== 'app' || !a.process) return lightOf(b, lens);
  const service = a.process.services.find(s => `app:${normRef(s.ref)}` === b.id);
  return lightOf({ check: CHECK[service?.result ?? 'unknown'] ?? 'na', data: copiesLight(b.app, b.every, a.rpo) }, lens);
}

export type Loss = { hit: Set<string>; processes: number; critical: number; domains: number; rpo?: number; every?: number; app?: App };
/** Losing an application or its data: every process and domain above stops. */
export function lossOf(nav: Navigator, id: string): Loss {
  const lost = nav.nodes.get(id);
  const hit = new Set<string>([id]);
  const walk = (from: string) => {
    for (const up of nav.nodes.get(from)?.up ?? []) if (!hit.has(up)) {
      hit.add(up);
      walk(up);
    }
  };
  walk(id);
  const above = [...hit].map(x => nav.nodes.get(x)!);
  const processes = above.filter(n => n.kind === 'proc');
  return {
    hit,
    processes: processes.length,
    critical: processes.filter(n => n.process?.criticality === 'critical').length,
    domains: above.filter(n => n.kind === 'dom').length,
    rpo: lost?.rpo,
    every: lost?.every,
    app: lost?.app,
  };
}

const CRIT: Criticality[] = ['critical', 'important', 'standard'];
/** The processes on screen, the worst first and then the most critical. */
export function processesOf(nav: Navigator, visible: Set<string>, lens: Lens): NavNode[] {
  const rank = (n: NavNode) => RANK[lightOf(n, lens)] * 10 - CRIT.indexOf(n.process?.criticality ?? 'standard');
  return [...nav.columns[2], ...nav.columns[3]].filter(id => visible.has(id)).map(id => nav.nodes.get(id)!).sort((a, b) => rank(b) - rank(a));
}

/**
 * The guided tour: the thread of the first critical process with a gap (else the first process with one, else the
 * first process), from its top domain down to the data.
 */
export function tourOf(nav: Navigator): string[] {
  const procs = nav.columns[2].map(id => nav.nodes.get(id)!);
  const bad = (n: NavNode) => lightOf(n, 'both') === 'bad';
  const p = procs.find(n => bad(n) && n.process?.criticality === 'critical') ?? procs.find(bad) ?? procs[0];
  if (!p) return [];
  const up: string[] = [];
  for (let d = nav.nodes.get(p.up[0]); d; d = d.up[0] ? nav.nodes.get(d.up[0]) : undefined) up.unshift(d.id);
  const apps = p.down.map(id => nav.nodes.get(id)!).filter(n => n.kind === 'app');
  const app = apps.find(bad) ?? apps[0];
  const store = app?.down.map(id => nav.nodes.get(id)!).find(n => n.kind === 'data');
  return [...up, p.id, ...(app ? [app.id] : []), ...(store ? [store.id] : [])];
}
