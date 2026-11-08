import type { CheckResult, Criticality, MapData, MapDomain, MapProcess } from '../../businessMap';
import { minutesOf, normRef } from './glassModel';

/**
 * What Business continuity › Glass draws of a big model (an APQC PCF has thousands of processes), without React:
 * the map cut down before the glass is built, so the lenses and the picking stay as they are.
 *
 *   linked     processes with no application (own or inherited) folded into one "+N without applications" node per
 *              domain; a subdomain with no linked process is not drawn (its processes go to the nearest drawn domain)
 *   level      domains / subdomains / processes: what is not drawn folds into one "N processes" node per domain, that
 *              keeps their applications (the chains below stay); an open domain shows what is under it, an open process
 *              its sub-processes
 *   domains    the level-1 domains to draw (none: all)
 *   critical   the effective (inherited) criticality: all, critical only, critical and important
 *   search     a process (ID, title, description) or an application (name, title, ref, anywhere in the chain of a
 *              business service): only the matches are drawn, each on its own, whatever the level
 *
 * The state is the URL (?ns=&domains=&detail=&crit=&linked=&open=&q=), so a view can be shared.
 */

export type GlassLevel = 'domains' | 'subdomains' | 'processes';
export const GLASS_LEVELS: GlassLevel[] = ['domains', 'subdomains', 'processes'];
export type CritFilter = 'all' | 'critical' | 'important';
export const CRIT_FILTERS: CritFilter[] = ['all', 'critical', 'important'];

export type GlassOptions = {
  linked: boolean;
  level: GlassLevel;
  /** refs of the open domains and processes */
  open: Set<string>;
  /** refs of the level-1 domains to draw; empty: all */
  domains: Set<string>;
  critical: CritFilter;
  search: string;
  /** a process whose applications match the search (anywhere in their chain) */
  appMatch?: (p: MapProcess) => boolean;
};

/** A node standing for several processes: folded by the level of detail, or without applications. */
export type GlassGroup = { ref: string; kind: 'folded' | 'unlinked'; scope: string; members: string[] };
export type GlassView = { map: MapData; groups: Map<string, GlassGroup>; total: number; drawn: number };

const RESULT_RANK: Record<CheckResult, number> = { meets: 0, unknown: 1, gap: 2 };
const CRIT_RANK: Record<Criticality, number> = { critical: 0, important: 1, standard: 2 };
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The name of a ref (kind:ns/name → name). */
const nameOf = (ref: string) => ref.slice(ref.indexOf('/') + 1);

/** The members as one process of the glass: the strictest criticality and requirement, the worst check. */
export function groupProcess(ref: string, scope: string, title: string, members: MapProcess[], withApps: boolean): MapProcess {
  const ns = scope.includes(':') ? scope.slice(scope.indexOf(':') + 1, scope.indexOf('/')) : 'default';
  const strict = [...members].sort((a, b) => CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality])[0];
  const least = (f: 'rpo' | 'rto') =>
    members.map(m => m.requirement[f]).filter((v): v is string => !!v).sort((a, b) => (minutesOf(a) ?? Infinity) - (minutesOf(b) ?? Infinity))[0] ?? null;
  const result = members.map(m => m.result).sort((a, b) => RESULT_RANK[b] - RESULT_RANK[a])[0] ?? 'unknown';
  return {
    ref,
    name: nameOf(ref),
    namespace: ns,
    title,
    domain: scope,
    criticality: strict?.criticality ?? 'standard',
    requirement: { rpo: least('rpo'), rto: least('rto'), retention: null, from: { rpo: 'default', rto: 'default' } },
    dependsOn: withApps ? [...new Set(members.flatMap(m => m.dependsOn))] : [],
    result,
    gaps: [],
    services: [],
    dataProducts: [],
  };
}

/** What a group node says: "N processes" or "+N without applications" (the page gives the words). */
export type GroupTitle = (kind: GlassGroup['kind'], n: number) => string;

export function glassView(full: MapData, o: GlassOptions, title: GroupTitle): GlassView {
  const domains = new Map(full.domains.map(d => [normRef(d.ref), { ...d, ref: normRef(d.ref), parent: d.parent ? normRef(d.parent) : undefined }]));
  const procs = new Map(full.processes.map(p => [normRef(p.ref), p]));
  const parentOf = (d: MapDomain) => (d.parent && domains.has(d.parent) ? domains.get(d.parent) : undefined);
  const rootOf = (ref: string): string => {
    let at = domains.get(ref);
    for (let n = 0; at && parentOf(at) && n < 20; n++) at = parentOf(at);
    return at?.ref ?? ref;
  };
  /** the domain of a process: its own, or that of its top process */
  const domainOf = (p: MapProcess): string => {
    let at = p;
    for (let n = 0; at.parent && procs.has(normRef(at.parent)) && n < 20; n++) at = procs.get(normRef(at.parent))!;
    return normRef(at.domain);
  };

  // the processes left by the filters
  const text = fold(o.search.trim());
  const searching = !!text;
  let candidates = full.processes.filter(p => {
    if (o.domains.size && !o.domains.has(rootOf(domainOf(p)))) return false;
    if (o.critical === 'critical' && p.criticality !== 'critical') return false;
    if (o.critical === 'important' && p.criticality === 'standard') return false;
    return true;
  });
  if (searching)
    candidates = candidates.filter(p => fold(`${p.pcfId ?? ''} ${p.modelId ?? ''} ${p.title} ${p.description ?? ''}`).includes(text) || !!o.appMatch?.(p));
  const linkedOf = (p: MapProcess) => p.dependsOn.length > 0;

  // which domains have something under them, and something linked
  const hasAny = new Set<string>();
  const hasLinked = new Set<string>();
  for (const p of candidates) {
    for (let at = domains.get(domainOf(p)); at; at = parentOf(at)) {
      hasAny.add(at.ref);
      if (linkedOf(p)) hasLinked.add(at.ref);
    }
  }
  const drawnDomain = new Map<string, boolean>();
  const isDrawn = (ref: string): boolean => {
    const known = drawnDomain.get(ref);
    if (known !== undefined) return known;
    const d = domains.get(ref);
    let v = !!d && hasAny.has(ref);
    if (v && d && parentOf(d)) {
      const parent = parentOf(d)!;
      const byLevel = searching || o.level !== 'domains' || o.open.has(parent.ref);
      const byLinks = searching || !o.linked || hasLinked.has(ref);
      v = byLevel && byLinks && isDrawn(parent.ref);
    }
    drawnDomain.set(ref, v);
    return v;
  };
  const nearestDrawn = (ref: string): string => {
    for (let at = domains.get(ref); at; at = parentOf(at)) if (isDrawn(at.ref)) return at.ref;
    return rootOf(ref);
  };

  /** a process drawn on its own: a top one at the level of processes or in an open domain, a sub-process under an
   *  open process that is drawn */
  const own = new Map<string, boolean>();
  const drawnAlone = (p: MapProcess): boolean => {
    const ref = normRef(p.ref);
    const known = own.get(ref);
    if (known !== undefined) return known;
    own.set(ref, false); // a loop of parents draws nothing
    const d = domainOf(p);
    let v = isDrawn(d) && nearestDrawn(d) === d;
    if (v && p.parent) {
      const parent = procs.get(normRef(p.parent));
      v = !!parent && o.open.has(normRef(parent.ref)) && drawnAlone(parent);
    } else if (v) v = o.level === 'processes' || o.open.has(d);
    own.set(ref, v);
    return v;
  };

  const shown: MapProcess[] = [];
  const folded = new Map<string, MapProcess[]>();
  const unlinked = new Map<string, MapProcess[]>();
  const put = (bag: Map<string, MapProcess[]>, scope: string, p: MapProcess) => bag.set(scope, [...(bag.get(scope) ?? []), p]);
  for (const p of candidates) {
    const d = domainOf(p);
    const at = nearestDrawn(d);
    if (searching) {
      shown.push({ ...p, domain: at });
      continue;
    }
    if (o.linked && !linkedOf(p)) {
      if (!p.parent) put(unlinked, at, p);
      continue;
    }
    if (drawnAlone(p)) shown.push({ ...p, domain: at });
    // a sub-process not drawn: its parent (or the group of its parent) stands for it
    else if (!p.parent) put(folded, at, p);
  }

  const groups = new Map<string, GlassGroup>();
  const groupProcs: MapProcess[] = [];
  const addGroups = (bag: Map<string, MapProcess[]>, kind: GlassGroup['kind']) => {
    for (const [scope, members] of bag) {
      const ref = `businessprocess:${scope.slice(scope.indexOf(':') + 1, scope.indexOf('/'))}/~${kind}~${nameOf(scope)}`;
      groups.set(ref, { ref, kind, scope, members: members.map(m => normRef(m.ref)) });
      groupProcs.push(groupProcess(ref, scope, title(kind, members.length), members, kind === 'folded'));
    }
  };
  addGroups(folded, 'folded');
  addGroups(unlinked, 'unlinked');
  const drawn = [...domains.values()].filter(d => isDrawn(d.ref));
  return {
    map: { ...full, domains: drawn, processes: [...shown, ...groupProcs] },
    groups,
    total: full.processes.length,
    drawn: drawn.length + shown.length + groupProcs.length,
  };
}

/**
 * The processes whose applications match a search: a business service they depend on, or anything in its chain down
 * (its application, instances, platform and development services), by name, title or ref.
 */
export function appMatcher(full: MapData, nodes: Array<{ id: string; label: string; name: string }>, links: Array<{ source: string; target: string }>, search: string): (p: MapProcess) => boolean {
  const text = fold(search.trim());
  if (!text) return () => false;
  const down = new Map<string, string[]>();
  for (const l of links) down.set(l.source, [...(down.get(l.source) ?? []), l.target]);
  const hit = new Set(nodes.filter(n => fold(`${n.id} ${n.label} ${n.name}`).includes(text)).map(n => n.id));
  const deps = new Set(full.processes.flatMap(p => p.dependsOn.map(normRef)));
  const matching = new Set<string>();
  for (const d of deps) {
    const seen = new Set([d]);
    const q = [d];
    while (q.length) {
      const c = q.shift()!;
      if (hit.has(c)) {
        matching.add(d);
        break;
      }
      for (const n of down.get(c) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        q.push(n);
      }
    }
  }
  return p => p.dependsOn.some(d => matching.has(normRef(d)));
}

/** The view of the URL: ?domains=a,b&detail=&crit=&linked=0&open=d:x,p:y&q= (domain and process names of the customer). */
export function readGlassParams(params: URLSearchParams, namespace: string): Omit<GlassOptions, 'appMatch'> {
  const list = (k: string) => (params.get(k) ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const level = (params.get('detail') ?? params.get('level')) as GlassLevel | null;
  const critical = params.get('crit') as CritFilter | null;
  const ref = (x: string) => (x.startsWith('p:') ? `businessprocess:${namespace}/${x.slice(2)}` : `domain:${namespace}/${x.replace(/^d:/, '')}`);
  return {
    linked: params.get('linked') !== '0',
    level: level && GLASS_LEVELS.includes(level) ? level : 'subdomains',
    open: new Set(list('open').map(ref).map(normRef)),
    domains: new Set(list('domains').map(x => normRef(`domain:${namespace}/${x}`))),
    critical: critical && CRIT_FILTERS.includes(critical) ? critical : 'all',
    search: params.get('q') ?? '',
  };
}

/** The view in the URL: only what differs from the default view. */
export function writeGlassParams(params: URLSearchParams, o: Omit<GlassOptions, 'appMatch'>): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (k: string, v: string | undefined) => (v ? next.set(k, v) : next.delete(k));
  const short = (ref: string) => (ref.startsWith('businessprocess:') ? `p:${nameOf(ref)}` : nameOf(ref));
  set('linked', o.linked ? undefined : '0');
  next.delete('level');
  set('detail', o.level === 'subdomains' ? undefined : o.level);
  set('open', [...o.open].map(short).sort().join(',') || undefined);
  set('domains', [...o.domains].map(nameOf).sort().join(',') || undefined);
  set('crit', o.critical === 'all' ? undefined : o.critical);
  set('q', o.search.trim() || undefined);
  return next;
}
