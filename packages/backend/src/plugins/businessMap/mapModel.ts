import {
  type CheckElement,
  checkProcess,
  type ContinuityGraph,
  type Criticality,
  type CriticalityDefaults,
  type Delivers,
  formatDuration,
  gapsOf,
  type MapEntity,
  parseDuration,
  rank,
  refOf,
  type Result,
  resultOf,
  shown,
} from './continuityModel';

/**
 * The pages of the business map, without Express: GET /map (the domains and processes of a customer, each checked),
 * GET /impact (the processes above an element, or who runs on a framework line) and the links of GET /engine.
 * The map lists every process, sub-processes too (each with its parent and its sub-processes): the views of the
 * console draw the top processes and reach the sub-processes from the page of their parent.
 * Pure: the route gives it the graph of the catalog.
 *
 * The result of a process (or of one of its business services) sums up the check of its chain: a gap if any element
 * has a gap, meets if at least one element meets and none has a gap, unknown when no element says what it delivers.
 */

export type ElementGap = { element: string; field: 'rpo' | 'rto'; needs: string; delivers: string };
export type MapDomain = { ref: string; title: string; description?: string; pcfId?: string; modelId?: string; parent?: string };
export type MapServiceCheck = { ref: string; title: string; type?: string; tier?: string; delivers: Delivers | null; result: Result; gaps: ElementGap[] };
/** Where a value of the requirement comes from: the default of the criticality, the process, or a parent process. */
export type Origin = 'default' | 'override' | 'inherited';
export type MapRequirement = { rpo: string | null; rto: string | null; retention: string | null; ha?: boolean; from: { rpo: Origin; rto: Origin } };
export type MapProcess = {
  ref: string;
  name: string;
  namespace: string;
  title: string;
  description?: string;
  domain: string;
  /** A sub-process: its parent process (ref). */
  parent?: string;
  /** The direct sub-processes (refs), [] when none. */
  subprocesses: string[];
  owner?: string;
  criticality: Criticality;
  requirement: MapRequirement;
  classification?: string;
  pcfId?: string;
  modelId?: string;
  processKey?: string;
  deprecated?: boolean;
  dependsOn: string[];
  result: Result;
  gaps: ElementGap[];
  services: MapServiceCheck[];
  dataProducts: string[];
};
export type ModelSummary = { ref: string; title: string; source?: string; industry?: string; version?: string; namespace?: string };
export type MapAnswer = {
  namespace?: string;
  namespaces: string[];
  models: ModelSummary[];
  defaults: CriticalityDefaults;
  domains: MapDomain[];
  processes: MapProcess[];
};

export type ImpactProcess = {
  ref: string;
  title: string;
  namespace: string;
  criticality: Criticality;
  needs: { rpo: string | null; rto: string | null };
  through: string[];
  result: Result;
  gap?: Array<{ field: 'rpo' | 'rto'; needs: string; delivers: string }>;
};
export type LineStage = { stage: string; instance: string; line?: string; lineTitle?: string; version?: string; lifecycle?: string; supportedUntil?: string };
export type LineService = { ref: string; title: string; owner?: string; stages: LineStage[]; processes: string[] };
export type LineSummary = { ref: string; title: string; version?: string; lifecycle?: string; supportedUntil?: string };
export type ImpactRole = 'run-time' | 'framework-line' | 'development-service';
export type ImpactAnswer = {
  entity: string;
  role: ImpactRole;
  delivers: Delivers | null;
  processes: ImpactProcess[];
  support?: { lifecycle?: string; supportedUntil?: string; version?: string; lines: LineSummary[] };
  services?: LineService[];
};

const A = {
  pcfId: 'apqc.org/pcf-id',
  modelId: 'refresquito.io/model-id',
  processKey: 'refresquito.io/process-key',
  deprecated: 'refresquito.io/deprecated',
  dataProduct: 'refresquito.io/data-product',
  stage: 'refresquito.io/stage',
  tier: 'refresquito.io/sla-tier',
  line: 'refresquito.io/framework-line',
  supportedUntil: 'refresquito.io/supported-until',
};
const STAGE_ORDER = ['pro', 'pre', 'dev'];
const stageRank = (s: string) => (STAGE_ORDER.includes(s) ? STAGE_ORDER.indexOf(s) : STAGE_ORDER.length);

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const typeOf = (e: MapEntity | undefined) => str(e?.spec?.type);
const titleOf = (e: MapEntity | undefined, ref: string) => e?.metadata.title ?? e?.metadata.name ?? ref.split('/').pop() ?? ref;
const nsOf = (e: MapEntity) => e.metadata.namespace ?? 'default';

/** A ref as the catalog writes targetRef: kind and namespace filled in, lowercase. */
export function normRef(value: string, defaultKind: string, defaultNamespace: string): string {
  const colon = value.indexOf(':');
  const kind = colon > 0 ? value.slice(0, colon) : defaultKind;
  const rest = colon > 0 ? value.slice(colon + 1) : value;
  const slash = rest.indexOf('/');
  const ns = slash >= 0 ? rest.slice(0, slash) : defaultNamespace;
  const name = slash >= 0 ? rest.slice(slash + 1) : rest;
  return `${kind}:${ns}/${name}`.toLowerCase();
}

/** "6.3.2" before "6.10", numbers as numbers; anything without an id after, by title. */
export function compareIds(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0);
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined || pb[i] === undefined) return pa.length - pb.length;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    const diff = Number.isNaN(na) || Number.isNaN(nb) ? pa[i].localeCompare(pb[i]) : na - nb;
    if (diff) return diff;
  }
  return 0;
}

/** Gap if any is a gap, meets if any meets, else unknown. */
export function combine(results: Result[]): Result {
  if (results.includes('gap')) return 'gap';
  return results.includes('meets') ? 'meets' : 'unknown';
}

const gapsOfElements = (elements: CheckElement[]): ElementGap[] => elements.flatMap(el => (el.gap ?? []).map(g => ({ element: el.ref, ...g })));

/** The domains of a customer: its Domains of type business-area, and any Domain one of its processes points at. */
function domainsOf(all: MapEntity[], namespace: string, pointed: Set<string>): MapDomain[] {
  return all
    .filter(e => e.kind.toLowerCase() === 'domain' && nsOf(e) === namespace && (typeOf(e) === 'business-area' || pointed.has(refOf(e))))
    .map(e => {
      const a = e.metadata.annotations ?? {};
      const parent = str(e.spec?.subdomainOf);
      const d: MapDomain = { ref: refOf(e), title: titleOf(e, refOf(e)) };
      if (e.metadata.description) d.description = e.metadata.description;
      if (a[A.pcfId]) d.pcfId = a[A.pcfId];
      if (a[A.modelId]) d.modelId = a[A.modelId];
      if (parent) d.parent = normRef(parent, 'domain', namespace);
      return d;
    })
    .sort((x, y) => compareIds(x.pcfId ?? x.modelId, y.pcfId ?? y.modelId) || x.title.localeCompare(y.title));
}

/** One process of the map, checked down its chain. */
export function mapProcess(graph: ContinuityGraph, e: MapEntity, defaults: CriticalityDefaults): MapProcess {
  const ref = refOf(e);
  const ns = nsOf(e);
  const a = e.metadata.annotations ?? {};
  const spec = e.spec ?? {};
  const need = graph.need(ref);
  const criticality: Criticality = need?.criticality ?? 'standard';
  const fmt = (m: number | undefined) => (m === undefined ? null : formatDuration(m));
  const check = checkProcess(graph, ref);
  const elements = check?.elements ?? [];
  const byRef = new Map(elements.map(el => [el.ref, el]));
  const dependsOn = graph.dependencies(ref);
  const services: MapServiceCheck[] = dependsOn.map(dep => {
    const target = graph.entity(dep);
    const sub = [dep, ...(graph.counts(dep) ? graph.chain(dep) : [])].map(r => byRef.get(r)).filter((x): x is CheckElement => !!x);
    const own = byRef.get(dep);
    const s: MapServiceCheck = { ref: dep, title: titleOf(target, dep), delivers: own?.delivers ?? null, result: combine(sub.map(x => x.result)), gaps: gapsOfElements(sub) };
    if (typeOf(target)) s.type = typeOf(target);
    if (own?.tier) s.tier = own.tier;
    return s;
  });
  const retention = graph.inherited(ref, 'retention');
  const origin = (f: 'rpo' | 'rto'): Origin => {
    if (parseDuration(spec[f]) !== undefined) return 'override';
    return parseDuration(graph.inherited(ref, f)) === undefined ? 'default' : 'inherited';
  };
  const requirement: MapRequirement = {
    rpo: fmt(need?.rpo),
    rto: fmt(need?.rto),
    retention: fmt(parseDuration(retention)) ?? str(retention) ?? null,
    from: { rpo: origin('rpo'), rto: origin('rto') },
  };
  const ha = defaults[criticality]?.ha;
  if (ha !== undefined) requirement.ha = ha;
  const dataProducts = [...new Set(elements.map(el => graph.entity(el.ref)?.metadata.annotations?.[A.dataProduct]).filter((x): x is string => !!x))];
  const p: MapProcess = {
    ref,
    name: e.metadata.name,
    namespace: ns,
    title: titleOf(e, ref),
    domain: str(spec.domain) ? normRef(String(spec.domain), 'domain', ns) : '',
    subprocesses: graph.subprocesses(ref),
    criticality,
    requirement,
    dependsOn,
    result: combine(elements.map(el => el.result)),
    gaps: gapsOfElements(elements),
    services,
    dataProducts,
  };
  if (e.metadata.description) p.description = e.metadata.description;
  const parent = graph.parentProcess(ref);
  if (parent) p.parent = parent;
  if (str(spec.owner)) p.owner = normRef(String(spec.owner), 'group', 'default');
  if (str(spec.classification)) p.classification = String(spec.classification);
  if (a[A.pcfId]) p.pcfId = a[A.pcfId];
  if (a[A.modelId]) p.modelId = a[A.modelId];
  if (a[A.processKey]) p.processKey = a[A.processKey];
  if (a[A.deprecated] && a[A.deprecated] !== 'false') p.deprecated = true;
  return p;
}

/** GET /map?namespace=: the customers, the models, and the domains and processes of one customer. */
export function buildMap(graph: ContinuityGraph, defaults: CriticalityDefaults, namespace?: string): MapAnswer {
  const all = graph.entities();
  const models = all
    .filter(e => e.kind.toLowerCase() === 'referencemodel')
    .map(e => {
      const m: ModelSummary = { ref: refOf(e), title: titleOf(e, refOf(e)) };
      for (const k of ['source', 'industry', 'version', 'namespace'] as const) if (str(e.spec?.[k])) m[k] = String(e.spec?.[k]);
      return m;
    })
    .sort((x, y) => x.title.localeCompare(y.title));
  // the namespaces of the reference models (APQC, the template) go after the customers
  const library = new Set(models.filter(m => m.source === 'apqc' || m.source === 'template').map(m => m.namespace));
  const found = new Set(
    all.filter(e => e.kind.toLowerCase() === 'businessprocess' || (e.kind.toLowerCase() === 'domain' && typeOf(e) === 'business-area')).map(nsOf),
  );
  const namespaces = [...found].sort((x, y) => Number(library.has(x)) - Number(library.has(y)) || x.localeCompare(y));
  const ns = namespace && found.has(namespace) ? namespace : namespaces[0];
  if (!ns) return { namespace, namespaces, models, defaults, domains: [], processes: [] };
  const processes = all
    .filter(e => e.kind.toLowerCase() === 'businessprocess' && nsOf(e) === ns)
    .map(e => mapProcess(graph, e, defaults))
    .sort((x, y) => compareIds(x.pcfId ?? x.modelId, y.pcfId ?? y.modelId) || x.title.localeCompare(y.title));
  return { namespace: ns, namespaces, models, defaults, domains: domainsOf(all, ns, new Set(processes.map(p => p.domain))), processes };
}

/** The shortest way down from a process to an element (through counted elements), without both ends. */
export function pathTo(graph: ContinuityGraph, from: string, to: string): string[] {
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  let level = [from];
  while (level.length && !seen.has(to)) {
    const next: string[] = [];
    for (const r of level) {
      for (const c of graph.children(r)) {
        if (seen.has(c) || !graph.counts(c)) continue;
        seen.add(c);
        prev.set(c, r);
        next.push(c);
      }
    }
    level = next;
  }
  if (!seen.has(to)) return [];
  const out: string[] = [];
  for (let r = prev.get(to); r && r !== from; r = prev.get(r)) out.unshift(r);
  return out;
}

const minutes = (v: string | null) => parseDuration(v ?? undefined) ?? Number.MAX_SAFE_INTEGER;
const strictest = (x: ImpactProcess, y: ImpactProcess) =>
  rank(x.criticality) - rank(y.criticality) || minutes(x.needs.rpo) - minutes(y.needs.rpo) || minutes(x.needs.rto) - minutes(y.needs.rto) || x.title.localeCompare(y.title);

/** A process as the Impact tab lists it, without its check yet. */
function impactRow(graph: ContinuityGraph, p: string): ImpactProcess | undefined {
  const need = graph.need(p);
  const e = graph.entity(p);
  if (!need || !e) return undefined;
  return { ref: p, title: titleOf(e, p), namespace: nsOf(e), criticality: need.criticality, needs: shown({ rpo: need.rpo, rto: need.rto })!, through: [], result: 'unknown' };
}

/** What runs on a framework line: its instances, grouped by their business service, with the line of each stage. */
function lineServices(graph: ContinuityGraph, lines: string[]): LineService[] {
  const lineSet = new Set(lines);
  const isInstance = (r: string) => {
    const t = typeOf(graph.entity(r));
    return graph.entity(r)?.kind.toLowerCase() === 'component' && t !== 'framework-line' && t !== 'development-service';
  };
  const instances = [...new Set(lines.flatMap(l => graph.parents(l)).filter(isInstance))];
  // the business service of an instance: the System above it (through its application), else the application
  const serviceOf = (inst: string): string => {
    let level = [inst];
    const seen = new Set(level);
    let app: string | undefined;
    for (let depth = 0; depth < 3 && level.length; depth++) {
      const next: string[] = [];
      for (const r of level) {
        for (const up of graph.parents(r)) {
          if (seen.has(up)) continue;
          seen.add(up);
          const e = graph.entity(up);
          const kind = e?.kind.toLowerCase();
          if (kind === 'system' && graph.counts(up)) return up;
          if (kind === 'component' && typeOf(e) === 'business-application') app = app ?? up;
          if (kind === 'component' || kind === 'system') next.push(up);
        }
      }
      level = next;
    }
    return app ?? inst;
  };
  const groups = new Map<string, Set<string>>();
  for (const i of instances) {
    const s = serviceOf(i);
    if (!groups.has(s)) groups.set(s, new Set());
    groups.get(s)!.add(i);
  }
  const processes = graph.listedProcesses();
  const out: LineService[] = [];
  for (const [svc, onLine] of groups) {
    // every instance of the service (not only those on these lines): to see how far each migration is
    const below = new Set<string>(onLine);
    let level = [svc];
    for (let depth = 0; depth < 3 && level.length; depth++) {
      const next: string[] = [];
      for (const r of level) {
        for (const c of graph.children(r)) {
          const e = graph.entity(c);
          if (e?.kind.toLowerCase() !== 'component' || below.has(c) || lineSet.has(c)) continue;
          const t = typeOf(e);
          if (t === 'application-instance' || e.metadata.annotations?.[A.stage]) below.add(c);
          else if (t === 'business-application') next.push(c);
        }
      }
      level = next;
    }
    const stages: LineStage[] = [...below].map(inst => {
      const e = graph.entity(inst);
      const line = graph.children(inst).find(c => typeOf(graph.entity(c)) === 'framework-line');
      const le = line ? graph.entity(line) : undefined;
      const st: LineStage = { stage: e?.metadata.annotations?.[A.stage] ?? 'pro', instance: inst };
      if (line) {
        st.line = line;
        st.lineTitle = titleOf(le, line);
        const version = le?.metadata.annotations?.[A.line] ?? e?.metadata.annotations?.[A.line];
        if (version) st.version = version;
        if (str(le?.spec?.lifecycle)) st.lifecycle = String(le?.spec?.lifecycle);
        if (le?.metadata.annotations?.[A.supportedUntil]) st.supportedUntil = le.metadata.annotations[A.supportedUntil];
      }
      return st;
    });
    stages.sort((x, y) => stageRank(x.stage) - stageRank(y.stage) || x.instance.localeCompare(y.instance));
    const mine = new Set([svc, ...below]);
    const above = processes.filter(p => graph.chain(p).some(r => mine.has(r)) || graph.children(p).some(r => mine.has(r)));
    const se = graph.entity(svc);
    const ls: LineService = { ref: svc, title: titleOf(se, svc), stages, processes: above };
    if (str(se?.spec?.owner)) ls.owner = normRef(String(se?.spec?.owner), 'group', 'default');
    out.push(ls);
  }
  return out.sort((x, y) => x.title.localeCompare(y.title));
}

const lineSummary = (graph: ContinuityGraph, ref: string): LineSummary => {
  const e = graph.entity(ref);
  const l: LineSummary = { ref, title: titleOf(e, ref) };
  if (e?.metadata.annotations?.[A.line]) l.version = e.metadata.annotations[A.line];
  if (str(e?.spec?.lifecycle)) l.lifecycle = String(e?.spec?.lifecycle);
  if (e?.metadata.annotations?.[A.supportedUntil]) l.supportedUntil = e.metadata.annotations[A.supportedUntil];
  return l;
};

/** GET /impact?entity=: the processes that depend on an element, strictest first; for a line, who runs on it. */
export function impactOf(graph: ContinuityGraph, entityRef: string): ImpactAnswer {
  const ref = entityRef.toLowerCase();
  const e = graph.entity(ref);
  const type = typeOf(e);
  if (type === 'framework-line' || type === 'development-service') {
    const lines = type === 'framework-line' ? [ref] : graph.children(ref).filter(c => typeOf(graph.entity(c)) === 'framework-line');
    const services = lineServices(graph, lines);
    const rows = new Map<string, ImpactProcess>();
    for (const s of services) {
      for (const p of s.processes) {
        const row = rows.get(p) ?? impactRow(graph, p);
        if (!row) continue;
        row.through = [...row.through, s.ref];
        rows.set(p, row);
      }
    }
    const own = lineSummary(graph, ref);
    return {
      entity: ref,
      role: type,
      delivers: null,
      processes: [...rows.values()].sort(strictest),
      support: { lifecycle: own.lifecycle, supportedUntil: own.supportedUntil, version: own.version, lines: lines.map(l => lineSummary(graph, l)) },
      services,
    };
  }
  const got = graph.delivers(ref);
  const processes: ImpactProcess[] = [];
  if (graph.counts(ref)) {
    for (const p of graph.listedProcesses()) {
      const need = graph.need(p);
      const row = impactRow(graph, p);
      if (!need || !row || !graph.chain(p).includes(ref)) continue;
      const gap = gapsOf(need, got);
      row.through = pathTo(graph, p, ref);
      row.result = resultOf(need, got, gap.length);
      if (gap.length) row.gap = gap;
      processes.push(row);
    }
  }
  return { entity: ref, role: 'run-time', delivers: shown(got), processes: processes.sort(strictest) };
}

/** Operaton serves its webapps under /operaton/app (the Camunda 7 /camunda/app paths answer 404). */
export const OPERATON_WEBAPP_PATH = '/operaton/app';
export type EngineAnswer = { baseUrl?: string; cockpitUrl?: string; tasklistUrl?: string; definitionUrl?: string };

/** GET /engine: the links into the process engine (Cockpit, Tasklist, and the definition of a key when known). */
export function engineLinks(publicUrl: string | undefined, definitionId?: string): EngineAnswer {
  const base = (publicUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return {};
  const out: EngineAnswer = {
    baseUrl: base,
    cockpitUrl: `${base}${OPERATON_WEBAPP_PATH}/cockpit/default/#/processes`,
    tasklistUrl: `${base}${OPERATON_WEBAPP_PATH}/tasklist/default/`,
  };
  // a definition id is key:version:uuid; anything else is not put in a link
  if (definitionId && /^[\w.:-]+$/.test(definitionId)) out.definitionUrl = `${base}${OPERATON_WEBAPP_PATH}/cockpit/default/#/process-definition/${definitionId}`;
  return out;
}
