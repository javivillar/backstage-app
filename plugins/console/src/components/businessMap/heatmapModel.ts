import type { Entity } from '@backstage/catalog-model';
import type { MapData } from '../../businessMap';
import type { DepNodeModel } from '../depsModel';
import {
  type BusinessGraph,
  checkOf,
  deliversOf,
  frameworkOf,
  healthOfNode,
  linesBelow,
  needsOf,
  normRef,
  processCheck,
  supportOf,
} from './glassModel';

/**
 * The model of Business map › Heat map: the processes of a customer as tiles grouped by domain and subdomain, coloured
 * by one lens at a time (a domain shows its worst process). Each lens has its own source; a source that cannot be read
 * leaves its tiles at "no data" and the others still work.
 */

export type Lens = 'continuity' | 'health' | 'incidents' | 'vulns' | 'cost' | 'readiness' | 'framework';
export const LENSES: Lens[] = ['continuity', 'health', 'incidents', 'vulns', 'cost', 'readiness', 'framework'];

/** 0 good … 3 bad; none: nothing to say (no data, no application, no check yet) */
export type Level = 0 | 1 | 2 | 3 | 'none';
/** a tile: its level and its text (a message key of BUSINESS_MAP_DASHBOARDS, its values, and keys to list after it) */
export type Tile = { level: Level; key: string; vars?: Record<string, string | number>; parts?: string[] };

/** What the sources said; undefined: that source could not be read. */
export type HeatSources = {
  /** the cluster overview (Argo CD) was read */
  health: boolean;
  /** incidents of this month by element ref (lowercase), all priorities */
  incidents?: Map<string, number>;
  /** open critical vulnerabilities by image ref */
  critical?: Map<string, number>;
  /** cost of a month by namespace */
  cost?: Map<string, number>;
  /** the namespace an element runs in (its Argo CD application) */
  namespaceOf: (e: Entity) => string | undefined;
  now: number;
};

const NO_DATA: Tile = { level: 'none', key: 'bmd.v.noData' };
const NO_APP: Tile = { level: 'none', key: 'bmd.v.noApp' };

/** thresholds: the level is the number of limits the value reaches */
const levelBy = (value: number, limits: [number, number, number]): Level => {
  if (value >= limits[2]) return 3;
  if (value >= limits[1]) return 2;
  if (value >= limits[0]) return 1;
  return 0;
};
/** the legend of each lens: incidents 1 / 3 / 7, vulnerabilities 1 / 2 / 4, cost 300 / 700 / 1500 a month */
export const LIMITS: Record<'incidents' | 'vulns' | 'cost', [number, number, number]> = { incidents: [1, 3, 7], vulns: [1, 2, 4], cost: [300, 700, 1500] };

/** the business elements of the chain of a process (business service, application, pro instances) */
export const businessBelow = (g: BusinessGraph, ref: string): DepNodeModel[] =>
  [...(g.below.get(ref) ?? [])].map(id => g.byId.get(id)).filter((n): n is DepNodeModel => !!n && n.layer === 'biz');

/** the running elements of a process: its pro instances (an application Component that is not the application itself) */
export const instancesOf = (g: BusinessGraph, ref: string): DepNodeModel[] =>
  businessBelow(g, ref).filter(n => n.entity.kind === 'Component' && n.entity.spec?.type !== 'business-application');

const images = (e: Entity) =>
  (e.metadata.annotations?.['refresquito.io/sbom-images'] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

/** The images of the pro instances of a process (refresquito.io/sbom-images), once each. */
export const imagesOf = (g: BusinessGraph, ref: string) => [...new Set(instancesOf(g, ref).flatMap(n => images(n.entity)))];

/** The tile of a process under a lens. */
export function tileOf(lens: Lens, g: BusinessGraph, ref: string, s: HeatSources): Tile {
  const p = g.processes.get(ref);
  if (!p) return NO_DATA;
  const biz = businessBelow(g, ref);
  const running = instancesOf(g, ref);
  switch (lens) {
    case 'continuity': {
      const c = processCheck(g, ref);
      if (c === 'unknown') return { level: 'none', key: 'bmd.v.noCheck' };
      if (c === 'meets') return { level: 0, key: 'bmd.v.meets' };
      const needs = needsOf(p);
      const worst = [...(g.below.get(ref) ?? [])]
        .map(id => g.byId.get(id))
        .find(n => n && n.layer !== 'fwk' && checkOf(needs, deliversOf(n.entity)) === c);
      return { level: c === 'rpo' ? 3 : 2, key: c === 'rpo' ? 'bmd.v.rpoGap' : 'bmd.v.rtoGap', vars: { through: worst?.label ?? '—' } };
    }
    case 'health': {
      if (!biz.length) return NO_APP;
      if (!s.health) return NO_DATA;
      const h = healthOfNode(g, ref);
      if (h === 'off') return NO_DATA;
      return { level: ({ ok: 0, warn: 1, bad: 3 } as const)[h], key: `bmd.v.health.${h}` };
    }
    case 'incidents': {
      if (!biz.length) return NO_APP;
      if (!s.incidents) return NO_DATA;
      const n = biz.reduce((t, x) => t + (s.incidents!.get(x.id.toLowerCase()) ?? 0), 0);
      return { level: levelBy(n, LIMITS.incidents), key: n === 1 ? 'bmd.v.incident' : 'bmd.v.incidents', vars: { n } };
    }
    case 'vulns': {
      if (!running.length) return NO_APP;
      const imgs = imagesOf(g, ref);
      if (!s.critical || !imgs.length) return NO_DATA;
      const known = imgs.filter(i => s.critical!.has(i));
      if (!known.length) return NO_DATA;
      const n = known.reduce((t, i) => t + s.critical!.get(i)!, 0);
      return { level: levelBy(n, LIMITS.vulns), key: 'bmd.v.critical', vars: { n } };
    }
    case 'cost': {
      if (!running.length) return NO_APP;
      if (!s.cost) return NO_DATA;
      const namespaces = [...new Set(running.map(n => s.namespaceOf(n.entity)).filter((x): x is string => !!x))].filter(ns => s.cost!.has(ns));
      if (!namespaces.length) return NO_DATA;
      const total = namespaces.reduce((t, ns) => t + s.cost!.get(ns)!, 0);
      return { level: levelBy(total, LIMITS.cost), key: 'bmd.v.cost', vars: { total: Math.round(total) } };
    }
    case 'readiness': {
      const missing = [!p.owner && 'bmd.ready.owner', !biz.length && 'bmd.ready.apps', !p.processKey && 'bmd.ready.bpmn'].filter((x): x is string => !!x);
      const pct = Math.round((100 * (3 - missing.length)) / 3);
      return { level: levelBy(100 - pct, [11, 31, 61]), key: missing.length ? 'bmd.v.readyMissing' : 'bmd.v.ready', vars: { pct }, parts: missing };
    }
    case 'framework': {
      if (!running.length) return NO_APP;
      const f = frameworkOf(g, ref, s.now);
      if (f === 'none' || f === 'na') return { level: 'none', key: 'bmd.v.noLine' };
      const lines = linesBelow(g, ref);
      const worst = lines.find(l => supportOf(l.entity, s.now).support === f) ?? lines[0];
      const level = ({ supported: 0, ending: 2, deprecated: 3, unsupported: 3 } as const)[f];
      const until = worst ? supportOf(worst.entity, s.now).until : undefined;
      return { level, key: `bmd.v.fw.${f}`, vars: { line: worst?.label ?? '—', until: until ?? '—' } };
    }
    default:
      return NO_DATA;
  }
}

/** The worst of some tiles: the highest level; "none" only when all are. */
export function worstTile(tiles: Tile[]): Tile {
  let worst: Tile | undefined;
  for (const t of tiles) if (t.level !== 'none' && (!worst || worst.level === 'none' || t.level > worst.level)) worst = t;
  return worst ?? tiles[0] ?? NO_DATA;
}

export type HeatGroup = { ref: string; title: string; processes: string[] };
export type HeatDomain = { ref: string; title: string; groups: HeatGroup[]; processes: string[] };

/**
 * Domains → subdomains → processes: a top domain (no parent in the map) with a group for its own processes and one per
 * subdomain below it (any depth, flattened). Processes whose domain is not in the map go to a last domain without ref.
 */
export function heatTree(map: MapData): HeatDomain[] {
  const domains = new Map(map.domains.map(d => [normRef(d.ref), d]));
  const top = (ref: string): string => {
    const seen = new Set<string>();
    let at = ref;
    while (!seen.has(at)) {
      seen.add(at);
      const parent = domains.get(at)?.parent;
      if (!parent || !domains.has(normRef(parent))) return at;
      at = normRef(parent);
    }
    return at;
  };
  const byDomain = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const p of map.processes) {
    const d = normRef(p.domain);
    if (domains.has(d)) byDomain.set(d, [...(byDomain.get(d) ?? []), normRef(p.ref)]);
    else orphans.push(normRef(p.ref));
  }
  const out: HeatDomain[] = [];
  for (const [ref, d] of domains) {
    if (top(ref) !== ref) continue;
    const groups: HeatGroup[] = [];
    if (byDomain.get(ref)?.length) groups.push({ ref, title: d.title, processes: byDomain.get(ref)! });
    for (const [sub, s] of domains) if (sub !== ref && top(sub) === ref && byDomain.get(sub)?.length) groups.push({ ref: sub, title: s.title, processes: byDomain.get(sub)! });
    out.push({ ref, title: d.title, groups, processes: groups.flatMap(x => x.processes) });
  }
  if (orphans.length) out.push({ ref: '', title: '', groups: [{ ref: '', title: '', processes: orphans }], processes: orphans });
  return out.filter(d => d.processes.length);
}

/** Parse the answer of the sbom backend (GET /api/sbom/vulnerabilities?ref=<image>): open critical ones, or undefined. */
export function criticalOf(body: unknown): number | undefined {
  const scan = (body as { scan?: { vulns?: Array<{ sev?: string; not_applicable?: string }>; counts?: Record<string, number> } | null })?.scan;
  if (!scan) return undefined;
  if (Array.isArray(scan.vulns)) return scan.vulns.filter(v => String(v.sev).toUpperCase() === 'CRITICAL' && !v.not_applicable).length;
  const n = scan.counts?.CRITICAL ?? scan.counts?.critical;
  return typeof n === 'number' ? n : undefined;
}

/** Parse GET /api/costs/incidents of the support: the incidents of this month by element ref (lowercase). */
export function incidentsOf(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const rows = Array.isArray((body as { elements?: unknown[] })?.elements) ? (body as { elements: unknown[] }).elements : [];
  for (const row of rows as Array<{ ref?: unknown; count?: unknown }>) {
    if (typeof row?.ref !== 'string') continue;
    const ref = row.ref.toLowerCase();
    const n = typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : 0;
    out.set(ref, (out.get(ref) ?? 0) + n);
  }
  return out;
}
