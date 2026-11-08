import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import type { MapData, MapProcess } from '../../businessMap';
import { buildGraph, chainOf, type DepLink, type DepNodeModel, type Health } from '../depsModel';

/**
 * The model of Business map › Glass, shared by the heat map and the matrix: the glass of Portal › Dependencies
 * (depsModel) with the business domains and processes of a customer on top, cut to the chains of its processes and to
 * production (only the pro instances count for continuity). On it: the criticality inherited down, the continuity
 * check (a gap flows up), the support of the framework lines, the health, and the blast radius of each element.
 */

export type Criticality = 'critical' | 'important' | 'standard';
export const CRITICALITIES: Criticality[] = ['critical', 'important', 'standard'];
const critRank = (c: Criticality | undefined) => (c ? CRITICALITIES.indexOf(c) : CRITICALITIES.length);
/** the strictest of some criticalities; undefined for none */
export const strictest = (cs: Array<Criticality | undefined>): Criticality | undefined =>
  cs.filter((c): c is Criticality => !!c).sort((a, b) => critRank(a) - critRank(b))[0];

const MINUTES: Record<string, number> = {
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
  d: 1440, day: 1440, days: 1440,
  w: 10080, week: 10080, weeks: 10080,
  y: 525600, yr: 525600, year: 525600, years: 525600,
};

/** Minutes of a duration ("15m", "4h", the catalog's "15 min", "24 h"), as the backend's continuityModel reads them. */
export function minutesOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]+)\.?$/.exec(value.trim().toLowerCase());
  if (!m || MINUTES[m[2]] === undefined) return undefined;
  return Math.round(Number(m[1].replace(',', '.')) * MINUTES[m[2]]);
}

/** The short form of some minutes: 30y, 3d, 4h, 15m (3d is written 72h, as the criticality table does). */
export function formatMinutes(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs > 0 && abs % 525600 === 0) return `${minutes / 525600}y`;
  if (abs > 0 && abs % 60 === 0) return `${minutes / 60}h`;
  if (abs > 60) return `${Math.floor(minutes / 60)}h ${abs % 60}m`;
  return `${minutes}m`;
}

/** The entity ref the console writes (stringifyEntityRef) of a ref of the map; the ref itself when it does not parse. */
export function normRef(ref: string): string {
  try {
    return stringifyEntityRef(parseEntityRef(ref));
  } catch {
    return ref.toLowerCase();
  }
}

/** a production element: no stage, or stage pro */
export const isPro = (e: Entity) => {
  const stage = e.metadata.annotations?.['refresquito.io/stage'];
  return !stage || stage === 'pro';
};

/** The domains and processes of the map as entities, so the glass of depsModel can place and link them. */
export function mapEntities(map: MapData): Entity[] {
  const entity = (kind: 'Domain' | 'BusinessProcess', ref: string, title: string, spec: Entity['spec'], relations: Array<{ type: string; targetRef: string }>): Entity => {
    const r = parseEntityRef(ref);
    return { apiVersion: 'refresquito.io/v1alpha1', kind, metadata: { name: r.name, namespace: r.namespace, title }, spec, relations };
  };
  const children = new Map<string, string[]>();
  const push = (parent: string, child: string) => children.set(parent, [...(children.get(parent) ?? []), child]);
  for (const d of map.domains) if (d.parent) push(normRef(d.parent), normRef(d.ref));
  for (const p of map.processes) push(normRef(p.domain), normRef(p.ref));
  const out: Entity[] = [];
  for (const d of map.domains) {
    const ref = normRef(d.ref);
    out.push(entity('Domain', ref, d.title, { type: 'business-area' }, (children.get(ref) ?? []).map(targetRef => ({ type: 'hasPart', targetRef }))));
  }
  for (const p of map.processes)
    out.push(entity('BusinessProcess', normRef(p.ref), p.title, { criticality: p.criticality, owner: p.owner }, p.dependsOn.map(d => ({ type: 'dependsOn', targetRef: normRef(d) }))));
  return out;
}

export type BusinessGraph = {
  nodes: DepNodeModel[];
  links: DepLink[];
  byId: Map<string, DepNodeModel>;
  /** the processes of the map by their (normalised) ref */
  processes: Map<string, MapProcess>;
  /** each element: the processes above it */
  above: Map<string, string[]>;
  /** each process: the elements of its chain, below it */
  below: Map<string, Set<string>>;
};

/** what goes down from a node (the source depends on the target), without the node */
export function downFrom(start: string, links: DepLink[]): Set<string> {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    for (const l of links)
      if (l.source === c && !seen.has(l.target)) {
        seen.add(l.target);
        q.push(l.target);
      }
  }
  seen.delete(start);
  return seen;
}

/**
 * The business glass: the map's domains and processes, and the catalog elements in the chain of a process; instances
 * of other stages are left out. health says the state of an element (healthOf of the cluster overview, as the
 * Dependencies page does).
 */
export function businessGraph(map: MapData, catalog: Entity[], health: (e: Entity) => { tone: Health; label: string }): BusinessGraph {
  const items = [...mapEntities(map), ...catalog.filter(e => e.kind !== 'Component' || isPro(e))];
  const full = buildGraph(items, e => (e.kind === 'Domain' || e.kind === 'BusinessProcess' ? { tone: 'off', label: '' } : health(e)));
  const processes = new Map(map.processes.map(p => [normRef(p.ref), p]));
  const below = new Map<string, Set<string>>();
  const keep = new Set<string>();
  for (const p of processes.keys()) {
    const chain = downFrom(p, full.links);
    below.set(p, chain);
    keep.add(p);
    chain.forEach(id => keep.add(id));
  }
  full.nodes.filter(n => n.layer === 'dom').forEach(n => keep.add(n.id));
  const nodes = full.nodes.filter(n => keep.has(n.id));
  const links = full.links.filter(l => keep.has(l.source) && keep.has(l.target));
  const above = new Map<string, string[]>();
  for (const [p, chain] of below) chain.forEach(id => above.set(id, [...(above.get(id) ?? []), p]));
  return { nodes, links, byId: new Map(nodes.map(n => [n.id, n])), processes, above, below };
}

/** The node's criticality: its own (a process), the strictest of the processes above it, or of those of a domain. */
export function criticalityOf(g: BusinessGraph, id: string): Criticality | undefined {
  const own = g.processes.get(id);
  if (own) return own.criticality;
  if (g.byId.get(id)?.layer === 'dom') return strictest([...downFrom(id, g.links)].map(x => g.processes.get(x)?.criticality));
  return strictest((g.above.get(id) ?? []).map(p => g.processes.get(p)?.criticality));
}

export type Needs = { rpo?: number; rto?: number };
/** What a process needs, in minutes (its effective requirement in the map). */
export const needsOf = (p: MapProcess): Needs => ({ rpo: minutesOf(p.requirement?.rpo), rto: minutesOf(p.requirement?.rto) });
/** What an element says it delivers (refresquito.io/sla-rpo and sla-rto), in minutes. */
export const deliversOf = (e: Entity): Needs => ({ rpo: minutesOf(e.metadata.annotations?.['refresquito.io/sla-rpo']), rto: minutesOf(e.metadata.annotations?.['refresquito.io/sla-rto']) });

export type Check = 'meets' | 'rpo' | 'rto' | 'unknown';
/** One element against one requirement: an RPO gap first (data lost), then an RTO gap, meets when both are known. */
export function checkOf(needs: Needs, got: Needs): Check {
  if (needs.rpo !== undefined && got.rpo !== undefined && got.rpo > needs.rpo) return 'rpo';
  if (needs.rto !== undefined && got.rto !== undefined && got.rto > needs.rto) return 'rto';
  const fields = (['rpo', 'rto'] as const).filter(f => needs[f] !== undefined);
  if (!fields.length || fields.some(f => got[f] === undefined)) return 'unknown';
  return 'meets';
}
const CHECK_RANK: Record<Check, number> = { unknown: 0, meets: 1, rto: 2, rpo: 3 };
export const worstCheck = (cs: Check[]): Check => cs.reduce<Check>((w, c) => (CHECK_RANK[c] > CHECK_RANK[w] ? c : w), 'unknown');

/** layers that are build time (framework lines, development services): not in the RPO/RTO check */
const BUILD_TIME = new Set(['fwk']);
const BUSINESS = new Set(['dom', 'proc', 'biz']);

/** The check of a process: the worst of the elements of its chain, or the map's own result when none says more. */
export function processCheck(g: BusinessGraph, ref: string): Check {
  const p = g.processes.get(ref);
  if (!p) return 'unknown';
  const needs = needsOf(p);
  const own = [...(g.below.get(ref) ?? [])]
    .map(id => g.byId.get(id))
    .filter((n): n is DepNodeModel => !!n && !BUILD_TIME.has(n.layer))
    .map(n => checkOf(needs, deliversOf(n.entity)))
    .filter(c => c !== 'unknown');
  const worst = worstCheck(own);
  if (worst !== 'unknown' && worst !== 'meets') return worst;
  if (p.result === 'gap') return 'rto';
  if (p.result === 'meets') return 'meets';
  return worst;
}

/**
 * The continuity of a node: a process its check; a domain the worst of its processes; an element its own check
 * against the strictest need of the processes above it, and a business element also what is below it (a gap flows
 * up). 'na' for build-time elements.
 */
export function continuityOf(g: BusinessGraph, id: string): Check | 'na' {
  const n = g.byId.get(id);
  if (!n) return 'unknown';
  if (BUILD_TIME.has(n.layer)) return 'na';
  if (n.layer === 'proc') return processCheck(g, id);
  if (n.layer === 'dom') return worstCheck([...downFrom(id, g.links)].filter(x => g.processes.has(x)).map(x => processCheck(g, x)));
  const ownCheck = (x: DepNodeModel) => {
    const procs = (g.above.get(x.id) ?? []).map(p => g.processes.get(p)).filter((p): p is MapProcess => !!p);
    return worstCheck(procs.map(p => checkOf(needsOf(p), deliversOf(x.entity))));
  };
  if (!BUSINESS.has(n.layer)) return ownCheck(n);
  const under = [...downFrom(id, g.links)].map(x => g.byId.get(x)).filter((x): x is DepNodeModel => !!x && !BUILD_TIME.has(x.layer));
  return worstCheck([ownCheck(n), ...under.map(ownCheck)]);
}

export type Support = 'supported' | 'ending' | 'deprecated' | 'unsupported';
const SUPPORT_RANK: Record<Support, number> = { supported: 0, ending: 1, deprecated: 2, unsupported: 3 };
export const worstSupport = (ss: Support[]): Support | undefined => [...ss].sort((a, b) => SUPPORT_RANK[b] - SUPPORT_RANK[a])[0];
const HALF_YEAR = 182 * 24 * 3600 * 1000;

/**
 * The support of a framework line: spec.lifecycle and refresquito.io/supported-until (a date, or a sentence such as
 * "while it is the latest line…" or "replaced by 3.1…"). Past the date or replaced: unsupported; deprecated; ending in
 * under 6 months; supported.
 */
export function supportOf(e: Entity, now: number): { support: Support; until?: string } {
  const until = e.metadata.annotations?.['refresquito.io/supported-until']?.trim();
  const lifecycle = String(e.spec?.lifecycle ?? '').toLowerCase();
  const date = until && /^\d{4}-\d{2}-\d{2}/.test(until) ? Date.parse(until.slice(0, 10)) : NaN;
  if (lifecycle === 'retired' || (!Number.isNaN(date) && date < now) || /^(replaced|unsupported|no longer)/i.test(until ?? '')) return { support: 'unsupported', until };
  if (lifecycle === 'deprecated') return { support: 'deprecated', until };
  if (!Number.isNaN(date) && date - now < HALF_YEAR) return { support: 'ending', until };
  return { support: 'supported', until };
}

/** The framework lines below a node (the lines of its pro instances). */
export const linesBelow = (g: BusinessGraph, id: string): DepNodeModel[] =>
  [...downFrom(id, g.links)].map(x => g.byId.get(x)).filter((n): n is DepNodeModel => !!n && n.layer === 'fwk' && n.entity.spec?.type !== 'development-service');

/** The framework support of a node: a line its own; a business node the worst of its lines; 'na' for the others. */
export function frameworkOf(g: BusinessGraph, id: string, now: number): Support | 'none' | 'na' {
  const n = g.byId.get(id);
  if (!n) return 'none';
  if (n.layer === 'fwk') return supportOf(n.entity, now).support;
  if (!BUSINESS.has(n.layer)) return 'na';
  return worstSupport(linesBelow(g, id).map(l => supportOf(l.entity, now).support)) ?? 'none';
}

const HEALTH_RANK: Record<Health, number> = { off: 0, ok: 1, warn: 2, bad: 3 };
export const worstHealth = (hs: Health[]): Health => hs.reduce<Health>((w, h) => (HEALTH_RANK[h] > HEALTH_RANK[w] ? h : w), 'off');

/** The health of a node: an element its own; a business node the worst of what is below it. */
export function healthOfNode(g: BusinessGraph, id: string): Health {
  const n = g.byId.get(id);
  if (!n) return 'off';
  if (!BUSINESS.has(n.layer)) return n.health;
  return worstHealth([n.health, ...[...downFrom(id, g.links)].map(x => g.byId.get(x)?.health ?? 'off')]);
}

/** The blast radius of an element: the processes above it, the critical ones weigh double. */
export function blastOf(g: BusinessGraph, id: string): { processes: number; critical: number; weight: number } {
  const ps = g.above.get(id) ?? [];
  const critical = ps.filter(p => g.processes.get(p)?.criticality === 'critical').length;
  return { processes: ps.length, critical, weight: ps.length + critical };
}

/** The radius of a node on the glass: business nodes fixed, the others grow with their blast radius. */
export function radiusOf(g: BusinessGraph, id: string): number {
  const n = g.byId.get(id);
  if (!n) return 30;
  if (n.layer === 'dom') return 44;
  if (n.layer === 'proc') return 36;
  if (n.layer === 'biz') return 38;
  return Math.min(70, 24 + blastOf(g, id).weight * 6);
}

/** a duration longer than any requirement, to sort the unknown last */
const NEVER = 1e9;

/** What lights up when a node is picked: its whole chain, up and down. */
export const litOf = (g: BusinessGraph, id: string) => chainOf(id, g.links);

/**
 * The processes affected by a node, strictest first: a process itself, a domain its processes, an element those
 * above it (they stop if it fails; for a framework line: they cannot be patched if it loses support).
 */
export function affectedBy(g: BusinessGraph, id: string): MapProcess[] {
  const n = g.byId.get(id);
  let refs: string[] = [];
  if (n?.layer === 'proc') refs = [id];
  else if (n?.layer === 'dom') refs = [...downFrom(id, g.links)].filter(x => g.processes.has(x));
  else refs = g.above.get(id) ?? [];
  return refs
    .map(r => g.processes.get(r))
    .filter((p): p is MapProcess => !!p)
    .sort((a, b) => critRank(a.criticality) - critRank(b.criticality) || (needsOf(a).rto ?? NEVER) - (needsOf(b).rto ?? NEVER));
}
