/**
 * Continuity of the business map: the requirement of the business processes (criticality, RPO, RTO), inherited down
 * the chain process → business service (System) → business application → its production instance → blocks
 * (Resource) → platform services, and checked against what each element says it delivers (its annotations
 * refresquito.io/sla-rpo and refresquito.io/sla-rto). Pure: the route gives it the entities of the catalog.
 *
 * Only production counts: an element with refresquito.io/stage other than pro is left out of the chain, and so are the
 * framework lines and development services (they are not run time: no RPO/RTO of theirs is checked).
 *
 * A sub-process (spec.parentProcess) inherits from its parent chain what it does not say itself: criticality, rpo,
 * rto, retention and what it depends on. The answers that list the processes above an element (continuity, impact)
 * take the top processes and only the sub-processes that say something of their own, so one service does not list
 * every activity of a process.
 */

export type Criticality = 'critical' | 'important' | 'standard';
export const CRITICALITIES: Criticality[] = ['critical', 'important', 'standard'];

/** businessMap.criticality of the app-config: the RPO/RTO of each criticality (a process's own rpo/rto win). */
export type CriticalityDefaults = Partial<Record<Criticality, { rpo?: string; rto?: string; ha?: boolean }>>;

/** What the model needs of a catalog entity. */
export type MapEntity = {
  kind: string;
  metadata: { name: string; namespace?: string; title?: string; description?: string; annotations?: Record<string, string> };
  spec?: Record<string, unknown>;
  relations?: Array<{ type: string; targetRef: string }>;
};

export type Requirement = { criticality: Criticality; rpo: string | null; rto: string | null; from: string[] };
export type Delivers = { rpo: string | null; rto: string | null };
export type Result = 'meets' | 'gap' | 'unknown';
export type Gap = { process: string; field: 'rpo' | 'rto'; needs: string; delivers: string };

export type ContinuityAnswer = { entity: string; requirement: Requirement | null; delivers: Delivers | null; result: Result; gaps: Gap[] };
export type CheckElement = {
  ref: string;
  kind: string;
  type?: string;
  tier?: string;
  delivers: Delivers | null;
  result: Result;
  gap?: Array<{ field: 'rpo' | 'rto'; needs: string; delivers: string }>;
};
export type ProcessCheck = { process: string; requirement: Requirement; elements: CheckElement[] };

const MINUTE: Record<string, number> = {
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
  d: 1440, day: 1440, days: 1440,
  w: 10080, week: 10080, weeks: 10080,
  y: 525600, yr: 525600, year: 525600, years: 525600,
};

/** Minutes of a duration: "15m", "4h", "30y", and the catalog's "15 min", "1 h", "24 h". Undefined when not one. */
export function parseDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]+)\.?$/.exec(value.trim().toLowerCase());
  if (!m || MINUTE[m[2]] === undefined) return undefined;
  return Math.round(Number(m[1].replace(',', '.')) * MINUTE[m[2]]);
}

/** The short form of some minutes: 30y, 72h, 15m. */
export function formatDuration(minutes: number): string {
  if (minutes > 0 && minutes % 525600 === 0) return `${minutes / 525600}y`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

const fmt = (minutes: number | undefined) => (minutes === undefined ? null : formatDuration(minutes));

/** A ref with kind and namespace filled in, lowercase as the catalog writes targetRef. */
function refFrom(value: string, defaultKind: string, defaultNamespace: string): string {
  const colon = value.indexOf(':');
  const kind = colon > 0 ? value.slice(0, colon) : defaultKind;
  const rest = colon > 0 ? value.slice(colon + 1) : value;
  const slash = rest.indexOf('/');
  return (slash >= 0 ? `${kind}:${rest}` : `${kind}:${defaultNamespace}/${rest}`).toLowerCase();
}

/** The entity reference of an entity, lowercase as the catalog writes targetRef. */
export function refOf(e: MapEntity): string {
  return `${e.kind}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`.toLowerCase();
}

const DOWN = new Set(['dependson', 'haspart']);
const UP = new Set(['dependencyof', 'partof']);
const KINDS = new Set(['system', 'component', 'resource']);
const NOT_RUN_TIME = new Set(['framework-line', 'development-service']);
const NOT_A_SERVICE_SYSTEM = new Set(['network-segment', 'development-services']);

export type Need = { criticality: Criticality; rpo?: number; rto?: number };

/** The catalog as a graph: who is under whom along the chain. */
export class ContinuityGraph {
  private readonly nodes = new Map<string, MapEntity>();
  private readonly down = new Map<string, Set<string>>();
  private readonly up = new Map<string, Set<string>>();
  private readonly chains = new Map<string, string[]>();

  constructor(
    entities: MapEntity[],
    private readonly defaults: CriticalityDefaults = {},
  ) {
    for (const e of entities) this.nodes.set(refOf(e), e);
    const link = (from: string, to: string) => {
      if (!this.down.has(from)) this.down.set(from, new Set());
      this.down.get(from)!.add(to);
      if (!this.up.has(to)) this.up.set(to, new Set());
      this.up.get(to)!.add(from);
    };
    for (const [ref, e] of this.nodes) {
      for (const r of e.relations ?? []) {
        const type = r.type.toLowerCase();
        const target = r.targetRef.toLowerCase();
        if (DOWN.has(type)) link(ref, target);
        else if (UP.has(type)) link(target, ref);
      }
    }
  }

  entity(ref: string): MapEntity | undefined {
    return this.nodes.get(ref.toLowerCase());
  }

  /** Every entity of the graph. */
  entities(): MapEntity[] {
    return [...this.nodes.values()];
  }

  /** What is directly under an element (dependsOn, hasPart), whether it counts or not. */
  children(ref: string): string[] {
    return [...(this.down.get(ref.toLowerCase()) ?? [])];
  }

  /** What is directly above an element (dependencyOf, partOf), whether it counts or not. */
  parents(ref: string): string[] {
    return [...(this.up.get(ref.toLowerCase()) ?? [])];
  }

  processes(): string[] {
    return [...this.nodes.keys()].filter(r => r.startsWith('businessprocess:'));
  }

  /** The parent process of a sub-process (its spec.parentProcess, as a ref), else undefined. */
  parentProcess(ref: string): string | undefined {
    const e = this.nodes.get(ref.toLowerCase());
    const raw = e?.spec?.parentProcess;
    if (typeof raw !== 'string' || !raw) return undefined;
    const r = refFrom(raw, 'businessprocess', e!.metadata.namespace ?? 'default');
    return r === ref.toLowerCase() ? undefined : r;
  }

  /** A process and its parents up to its top process, nearest first (a loop of parents stops). */
  lineage(ref: string): string[] {
    const out = [ref.toLowerCase()];
    for (let up = this.parentProcess(out[0]); up && !out.includes(up) && this.nodes.has(up); up = this.parentProcess(up)) out.push(up);
    return out;
  }

  /** The direct sub-processes of a process. */
  subprocesses(ref: string): string[] {
    return this.children(ref).filter(c => c.startsWith('businessprocess:') && this.parentProcess(c) === ref.toLowerCase());
  }

  /** A spec field of a process, or the nearest of its parents that says it. */
  inherited(ref: string, field: string): unknown {
    for (const r of this.lineage(ref)) {
      const v = this.nodes.get(r)?.spec?.[field];
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) return v;
    }
    return undefined;
  }

  /** What a process depends on itself (its dependsOn, not its domain nor its sub-processes); a sub-process without
   *  any, those of its nearest parent with some. */
  dependencies(ref: string): string[] {
    for (const r of this.lineage(ref)) {
      const own = this.children(r).filter(c => !c.startsWith('businessprocess:'));
      if (own.length) return own;
    }
    return [];
  }

  /** The processes the answers listing processes above an element take: top processes, and sub-processes that say
   *  their own criticality, rpo, rto or dependencies. */
  listedProcesses(): string[] {
    return this.processes().filter(p => {
      if (!this.parentProcess(p)) return true;
      const spec = this.nodes.get(p)?.spec ?? {};
      return ['criticality', 'rpo', 'rto'].some(f => typeof spec[f] === 'string' && spec[f]) || this.children(p).some(c => !c.startsWith('businessprocess:'));
    });
  }

  /** Whether an element is part of a continuity chain: run time, production, a System, Component or Resource. */
  counts(ref: string): boolean {
    const e = this.nodes.get(ref);
    if (!e || !KINDS.has(e.kind.toLowerCase())) return false;
    const type = typeof e.spec?.type === 'string' ? e.spec.type : undefined;
    if (type && NOT_RUN_TIME.has(type)) return false;
    if (e.kind.toLowerCase() === 'system' && type && NOT_A_SERVICE_SYSTEM.has(type)) return false;
    const stage = e.metadata.annotations?.['refresquito.io/stage'];
    return !stage || stage === 'pro';
  }

  /** The elements a process depends on, directly or through the chain, nearest first. */
  chain(process: string): string[] {
    const key = process.toLowerCase();
    const known = this.chains.get(key);
    if (known) return known;
    const seen = new Set<string>([key]);
    const out: string[] = [];
    let level = key.startsWith('businessprocess:') ? this.dependencies(key) : [...(this.down.get(key) ?? [])];
    while (level.length) {
      const next: string[] = [];
      for (const ref of level) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        if (!this.counts(ref)) continue;
        out.push(ref);
        next.push(...(this.down.get(ref) ?? []));
      }
      level = next;
    }
    this.chains.set(key, out);
    return out;
  }

  /** What a process needs: its own rpo/rto (or its nearest parent's), else the default of its criticality (its own,
   *  else inherited). */
  need(process: string): Need | undefined {
    const e = this.nodes.get(process.toLowerCase());
    const criticality = (e ? this.inherited(process, 'criticality') : undefined) as Criticality | undefined;
    if (!e || !criticality || !CRITICALITIES.includes(criticality)) return undefined;
    const d = this.defaults[criticality] ?? {};
    return {
      criticality,
      rpo: parseDuration(this.inherited(process, 'rpo')) ?? parseDuration(d.rpo),
      rto: parseDuration(this.inherited(process, 'rto')) ?? parseDuration(d.rto),
    };
  }

  /** What an element says it delivers, from its annotations; null when it says nothing usable. */
  delivers(ref: string): { rpo?: number; rto?: number } | null {
    const a = this.nodes.get(ref.toLowerCase())?.metadata.annotations ?? {};
    const rpo = parseDuration(a['refresquito.io/sla-rpo']);
    const rto = parseDuration(a['refresquito.io/sla-rto']);
    return rpo === undefined && rto === undefined ? null : { rpo, rto };
  }
}

export const rank = (c: Criticality) => CRITICALITIES.indexOf(c);
const minOf = (values: Array<number | undefined>) => {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length ? Math.min(...known) : undefined;
};

export function gapsOf(need: Need, got: { rpo?: number; rto?: number } | null) {
  const out: Array<{ field: 'rpo' | 'rto'; needs: string; delivers: string }> = [];
  for (const field of ['rpo', 'rto'] as const) {
    const n = need[field];
    const d = got?.[field];
    if (n !== undefined && d !== undefined && d > n) out.push({ field, needs: formatDuration(n), delivers: formatDuration(d) });
  }
  return out;
}

export function resultOf(need: Need | undefined, got: { rpo?: number; rto?: number } | null, gaps: number): Result {
  if (!need) return 'unknown';
  if (gaps) return 'gap';
  const fields = (['rpo', 'rto'] as const).filter(f => need[f] !== undefined);
  if (!fields.length || fields.some(f => got?.[f] === undefined)) return 'unknown';
  return 'meets';
}

export const shown = (got: { rpo?: number; rto?: number } | null): Delivers | null => (got ? { rpo: fmt(got.rpo), rto: fmt(got.rto) } : null);

/** GET /continuity?entity=: the strictest requirement of the processes above an entity, and its check. */
export function continuityOf(graph: ContinuityGraph, entityRef: string): ContinuityAnswer {
  const ref = entityRef.toLowerCase();
  const needs: Array<{ process: string; need: Need }> = [];
  const own = ref.startsWith('businessprocess:') ? graph.need(ref) : undefined;
  if (own) needs.push({ process: ref, need: own });
  else if (graph.counts(ref)) {
    for (const p of graph.listedProcesses()) {
      const need = graph.need(p);
      if (need && graph.chain(p).includes(ref)) needs.push({ process: p, need });
    }
  }
  needs.sort((a, b) => rank(a.need.criticality) - rank(b.need.criticality) || a.process.localeCompare(b.process));
  const got = own ? null : graph.delivers(ref);
  if (!needs.length) return { entity: ref, requirement: null, delivers: shown(got), result: 'unknown', gaps: [] };
  const strictest: Need = {
    criticality: needs[0].need.criticality,
    rpo: minOf(needs.map(n => n.need.rpo)),
    rto: minOf(needs.map(n => n.need.rto)),
  };
  const gaps: Gap[] = own ? [] : needs.flatMap(n => gapsOf(n.need, got).map(g => ({ process: n.process, ...g })));
  return {
    entity: ref,
    requirement: { criticality: strictest.criticality, rpo: fmt(strictest.rpo), rto: fmt(strictest.rto), from: needs.map(n => n.process) },
    delivers: shown(got),
    result: own ? 'unknown' : resultOf(strictest, got, gaps.length),
    gaps,
  };
}

/** GET /processes/:namespace/:name/check: every element of the chain of a process, checked. Undefined if no process. */
export function checkProcess(graph: ContinuityGraph, processRef: string): ProcessCheck | undefined {
  const ref = processRef.toLowerCase();
  const need = graph.need(ref);
  if (!graph.entity(ref) || !need) return undefined;
  const elements = graph.chain(ref).map(r => {
    const e = graph.entity(r)!;
    const got = graph.delivers(r);
    const gap = gapsOf(need, got);
    const el: CheckElement = {
      ref: r,
      kind: e.kind,
      type: typeof e.spec?.type === 'string' ? e.spec.type : undefined,
      tier: e.metadata.annotations?.['refresquito.io/sla-tier'],
      delivers: shown(got),
      result: resultOf(need, got, gap.length),
    };
    if (gap.length) el.gap = gap;
    return el;
  });
  return { process: ref, requirement: { criticality: need.criticality, rpo: fmt(need.rpo), rto: fmt(need.rto), from: [ref] }, elements };
}

/** businessMap.criticality read from a plain object (the app-config), anything malformed left out. */
export function readDefaults(raw: unknown): CriticalityDefaults {
  const out: CriticalityDefaults = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const c of CRITICALITIES) {
    const v = (raw as Record<string, unknown>)[c] as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object') continue;
    out[c] = {
      rpo: typeof v.rpo === 'string' ? v.rpo : undefined,
      rto: typeof v.rto === 'string' ? v.rto : undefined,
      ha: typeof v.ha === 'boolean' ? v.ha : undefined,
    };
  }
  return out;
}
