import type {
  CheckElement,
  CheckResult,
  Criticality,
  ImpactData,
  LineService,
  MapData,
  MapDomain,
  MapProcess,
  ModelSummary,
  Origin,
  Workaround,
} from '../../businessMap';

/**
 * Portal › Business continuity (the business map), without React: how the map groups domains, subdomains and processes, the links to the
 * forms of the templates (no direct writes: every change is a pull request), the texts of a gap and of how to close it, and the
 * framework support of a line. The pages (BusinessMapPage, BusinessProcessPage, ImpactTab) only draw this.
 */

export const CRITICALITIES: Criticality[] = ['critical', 'important', 'standard'];
/** The owner an import gives a process whose owner is no group of the catalog. */
export const UNASSIGNED = 'group:default/unassigned';
/** The console forms of the templates of the business map (ImportModelPage, AdoptModelPage, ProcessFormPage). */
const FORMS = '/console/business-map';

export type Vars = Record<string, string | number>;
export type Text = { key: string; vars?: Vars };

/** The name of a ref: kind:namespace/name → name. */
export const nameOf = (ref: string) => ref.slice(ref.indexOf('/') + 1) || ref;
/** The namespace of a ref: kind:namespace/name → namespace. */
export const namespaceOf = (ref: string) => {
  const colon = ref.indexOf(':');
  const slash = ref.indexOf('/');
  return slash > colon ? ref.slice(colon + 1, slash) : 'default';
};
/** The kind of a ref, lowercase. */
export const kindOf = (ref: string) => (ref.includes(':') ? ref.slice(0, ref.indexOf(':')).toLowerCase() : '');
/** The page of an entity in the console. */
export const consolePath = (ref: string) => `/console/entity/${namespaceOf(ref)}/${kindOf(ref)}/${nameOf(ref)}`;

const MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, y: 525600 };
/** Minutes of a short duration (15m, 4h, 30y); undefined for anything else. */
export function toMinutes(v: string | null | undefined): number | undefined {
  const m = /^(\d+)\s*(m|h|d|w|y)$/.exec((v ?? '').trim());
  return m ? Number(m[1]) * MINUTES[m[2]] : undefined;
}

const withQuery = (path: string, query: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1]));
  const text = q.toString();
  return text ? `${path}?${text}` : path;
};

/** New business process (the console form of the template business-process-new), in a domain when one is given. */
export const newProcessUrl = (domain?: string) => withQuery(`${FORMS}/process/new`, { domain });
/** Import business model (the console form of business-model-import), for a customer when one is given. */
export const importModelUrl = (namespace?: string) => withQuery(`${FORMS}/import`, { ns: namespace });
/** Adopt reference model (the console form of business-model-adopt), for a customer when one is given. */
export const adoptModelUrl = (namespace?: string) => withQuery(`${FORMS}/adopt`, { ns: namespace });
/** Edit business process (the console form of business-process-edit): it reads the process from the catalog. */
export const editProcessUrl = (p: Pick<MapProcess, 'ref'>) => `${FORMS}/process/edit/${encodeURIComponent(namespaceOf(p.ref))}/${encodeURIComponent(nameOf(p.ref))}`;

/** A domain of the map with its subdomains; `domain` undefined holds what sits on the domain itself. */
export type SubBlock = { domain?: MapDomain; processes: MapProcess[] };
export type DomainBlock = { domain?: MapDomain; subs: SubBlock[]; count: number };

/**
 * The blocks of the map: level-1 domains in the order of the backend, each with the processes on it and its
 * subdomains (deeper levels fold into their level-2 ancestor). Processes of a domain the map does not know go last,
 * in a block without domain. gapsOnly keeps the processes with a gap and drops what is left empty.
 */
export function mapBlocks(map: Pick<MapData, 'domains' | 'processes'>, gapsOnly = false): DomainBlock[] {
  const byRef = new Map(map.domains.map(d => [d.ref, d]));
  const chainUp = (ref: string): string[] => {
    const out: string[] = [];
    for (let r: string | undefined = ref; r && byRef.has(r) && !out.includes(r); r = byRef.get(r)?.parent) out.unshift(r);
    return out;
  };
  const shown = map.processes.filter(p => !gapsOnly || p.result === 'gap');
  const tops = map.domains.filter(d => !d.parent || !byRef.has(d.parent));
  const blocks: DomainBlock[] = tops.map(top => {
    const subsOf = map.domains.filter(d => chainUp(d.ref).length === 2 && chainUp(d.ref)[0] === top.ref);
    const direct: SubBlock = { processes: shown.filter(p => p.domain === top.ref) };
    const subs = subsOf.map(sub => ({ domain: sub, processes: shown.filter(p => chainUp(p.domain)[1] === sub.ref) }));
    const all = [direct, ...subs].filter(s => s.processes.length || (!gapsOnly && s.domain));
    return { domain: top, subs: all, count: all.reduce((n, s) => n + s.processes.length, 0) };
  });
  const lost = shown.filter(p => !byRef.has(p.domain));
  if (lost.length) blocks.push({ subs: [{ processes: lost }], count: lost.length });
  return gapsOnly ? blocks.filter(b => b.count) : blocks;
}

/** A process with its sub-processes, as the page of a process lists them. */
export type ProcessNode = { process: MapProcess; children: ProcessNode[] };

/**
 * The sub-processes of a process as a tree (by their parent), in the order of their IDs; a loop or a missing parent
 * stops a branch.
 */
export function subprocessTree(processes: MapProcess[], ref: string): ProcessNode[] {
  const byParent = new Map<string, MapProcess[]>();
  for (const p of processes) {
    if (!p.parent) continue;
    if (!byParent.has(p.parent)) byParent.set(p.parent, []);
    byParent.get(p.parent)!.push(p);
  }
  const id = (p: MapProcess) => p.pcfId ?? p.modelId ?? p.title;
  const order = (a: MapProcess, b: MapProcess) => id(a).localeCompare(id(b), undefined, { numeric: true });
  const seen = new Set<string>([ref]);
  const grow = (at: string): ProcessNode[] =>
    (byParent.get(at) ?? [])
      .filter(c => !seen.has(c.ref))
      .sort(order)
      .map(c => {
        seen.add(c.ref);
        return { process: c, children: grow(c.ref) };
      });
  return grow(ref);
}

/** Where a value of the requirement comes from, as the panels say it (the default of the criticality, the process,
 *  or a parent process). */
export function originText(t: (k: string, v?: Vars) => string, o: Origin, criticality: string): string {
  if (o === 'override') return t('bm.from.override');
  if (o === 'inherited') return t('bm.from.inherited');
  return t('bm.from.default', { criticality: t(`bm.crit.${criticality}`) });
}

/** A workaround as a card says it: yes, up to 1d / no / — when the analysis says nothing. */
export function workaroundText(t: (k: string, v?: Vars) => string, w: Workaround | undefined): string {
  if (!w) return '—';
  if (!w.manual) return t('bmp.workaround.no');
  return w.maxDuration ? t('bmp.workaround.upTo', { d: w.maxDuration }) : t('bmp.workaround.yes');
}

/** The path of the BIA sheet of a customer (GET /api/business-map/bia), of one level-1 domain (its name) if given. */
export function biaPath(namespace: string, domain?: string, level: '3' | 'all' = '3'): string {
  const q = new URLSearchParams({ namespace });
  if (domain) q.set('domain', domain);
  if (level === 'all') q.set('level', 'all');
  return `/bia?${q.toString()}`;
}

/** How many processes a tree holds. */
export const treeSize = (nodes: ProcessNode[]): number => nodes.reduce((n, x) => n + 1 + treeSize(x.children), 0);

/** A process and its parents up to its top process, top first (the crumbs of a sub-process). */
export function parentsOf(processes: MapProcess[], p: MapProcess): MapProcess[] {
  const byRef = new Map(processes.map(x => [x.ref, x]));
  const out: MapProcess[] = [];
  for (let at = p.parent ? byRef.get(p.parent) : undefined; at && !out.includes(at) && at !== p; at = at.parent ? byRef.get(at.parent) : undefined) out.unshift(at);
  return out;
}

export type MapStats = { processes: number; critical: number; gaps: number; unowned: number; model?: ModelSummary };

/** The KPIs of a customer: processes, critical ones, with a gap, without owner, and its reference model. */
export function mapStats(map: MapData): MapStats {
  const ps = map.processes;
  return {
    processes: ps.length,
    critical: ps.filter(p => p.criticality === 'critical').length,
    gaps: ps.filter(p => p.result === 'gap').length,
    unowned: ps.filter(p => !p.owner || p.owner === UNASSIGNED).length,
    model: map.models.find(m => m.namespace === map.namespace),
  };
}

/** The tone of a check result for a Pill. */
export const resultTone = (r: CheckResult): 'pos' | 'neg' | 'neu' => ({ meets: 'pos', gap: 'neg', unknown: 'neu' } as const)[r];

/** One gap as people read it: RPO 24h > 15m. */
export const gapText = (g: { field: 'rpo' | 'rto'; needs: string; delivers: string }) => `${g.field.toUpperCase()} ${g.delivers} > ${g.needs}`;

/** The label of the result of a process: meets, no check yet, or "RPO gap · 2" (elements with a gap). */
export function resultLabel(p: Pick<MapProcess, 'result' | 'gaps'>): Text {
  if (p.result !== 'gap') return { key: p.result === 'meets' ? 'bm.meets' : 'bm.unknown' };
  const fields = new Set(p.gaps.map(g => g.field));
  const n = new Set(p.gaps.map(g => g.element)).size;
  if (fields.size > 1) return { key: 'bm.gap.both', vars: { n } };
  return { key: fields.has('rto') ? 'bm.gap.rto' : 'bm.gap.rpo', vars: { n } };
}

/** The columns of the chain of a process (as the Process board): its business services, applications, stages and blocks, platform services. */
export function chainColumns(elements: CheckElement[]) {
  const type = (e: CheckElement) => e.type ?? '';
  const kind = (e: CheckElement) => e.kind.toLowerCase();
  return {
    services: elements.filter(e => kind(e) === 'system'),
    applications: elements.filter(e => kind(e) === 'component' && type(e) === 'business-application'),
    blocks: elements.filter(e => kind(e) === 'resource' || (kind(e) === 'component' && type(e) === 'application-instance')),
    platform: elements.filter(e => kind(e) === 'component' && !['business-application', 'application-instance'].includes(type(e))),
  };
}

/** How to close the gaps of a process: one line per element with a gap, then accepting the risk. */
export function closeAdvice(elements: CheckElement[]): Text[] {
  const out: Text[] = [];
  for (const e of elements) {
    for (const g of e.gap ?? []) {
      const vars = { element: nameOf(e.ref), field: g.field.toUpperCase(), needs: g.needs, delivers: g.delivers };
      let key = 'bm.fix.app';
      if (e.kind.toLowerCase() === 'resource') key = 'bm.fix.block';
      else if (e.type === 'platform-service') key = 'bm.fix.service';
      out.push({ key, vars });
    }
  }
  if (out.length) out.push({ key: 'bm.fix.accept' });
  return out;
}

/** The strictest of some durations (the shortest); null when none is known. */
export function strictestOf(values: Array<string | null | undefined>): string | null {
  let best: { v: string; m: number } | undefined;
  for (const v of values) {
    const m = toMinutes(v);
    if (v && m !== undefined && (!best || m < best.m)) best = { v, m };
  }
  return best?.v ?? null;
}

export type ImpactSummary = { count: number; strictest?: Criticality; needs: { rpo: string | null; rto: string | null }; gaps: number };

/** The cards of the Impact tab: how many processes, the strictest criticality and need, how many with a gap. */
export function impactSummary(impact: Pick<ImpactData, 'processes'>): ImpactSummary {
  const ps = impact.processes;
  const strictest = CRITICALITIES.find(c => ps.some(p => p.criticality === c));
  return {
    count: ps.length,
    strictest,
    needs: { rpo: strictestOf(ps.map(p => p.needs.rpo)), rto: strictestOf(ps.map(p => p.needs.rto)) },
    gaps: ps.filter(p => p.result === 'gap').length,
  };
}

/** The way down of an impact row, short: the first and the last element (e.g. documents → documents-records). */
export function throughText(through: string[]): string {
  if (!through.length) return '';
  if (through.length === 1) return nameOf(through[0]);
  return `${nameOf(through[0])} → ${nameOf(through[through.length - 1])}`;
}

export type SupportState = 'supported' | 'ending' | 'deprecated' | 'unsupported';

/**
 * The framework support of a line: unsupported once its date passed, ending in under 6 months, deprecated by its
 * lifecycle, else supported. supportedUntil may be a date (2027-04-16) or a sentence ("while it is the latest line").
 */
export function supportOf(line: { lifecycle?: string; supportedUntil?: string }, today: Date): { state: SupportState; monthsLeft?: number } {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(line.supportedUntil ?? '') ? new Date(`${line.supportedUntil}T00:00:00Z`) : undefined;
  if (date && !Number.isNaN(date.getTime())) {
    const monthsLeft = Math.floor((date.getTime() - today.getTime()) / (30.44 * 86400000));
    if (date.getTime() < today.getTime()) return { state: 'unsupported', monthsLeft: 0 };
    if (monthsLeft < 6) return { state: 'ending', monthsLeft };
    return { state: line.lifecycle === 'deprecated' ? 'deprecated' : 'supported', monthsLeft };
  }
  return { state: line.lifecycle === 'deprecated' ? 'deprecated' : 'supported' };
}

export const supportTone = (s: SupportState): 'pos' | 'warn' | 'neg' => ({ supported: 'pos', ending: 'warn', deprecated: 'neg', unsupported: 'neg' } as const)[s];

/** Versions as numbers: 3.10 after 3.2. */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const pa = (a ?? '').split('.').map(Number);
  const pb = (b ?? '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** Whether a stage of a service runs on one of these lines. */
const onLines = (lines: Set<string>) => (s: { line?: string }) => !!s.line && lines.has(s.line);

/**
 * The next step of a business service on a line (ImpactLine board): pre already on a newer line → promote it to
 * pro; dev on a newer line → test it, then promote; pro no longer on the line → done; else start in dev.
 */
export function nextStep(service: LineService, lines: string[]): Text {
  const mine = onLines(new Set(lines));
  const pro = service.stages.find(s => s.stage === 'pro');
  if (!pro || !mine(pro)) return { key: 'bm.line.proMoved' };
  const newer = (stage: string) => service.stages.find(s => s.stage === stage && !mine(s) && compareVersions(s.version, pro.version) > 0);
  const pre = newer('pre');
  if (pre) return { key: 'bm.line.promotePro', vars: { version: pre.version ?? '' } };
  const dev = newer('dev');
  if (dev) return { key: 'bm.line.testThenPromote', vars: { version: dev.version ?? '' } };
  return { key: 'bm.line.startDev' };
}

/** The services on a line in production, and how many of them already moved a dev or pre stage off it. */
export function lineProgress(services: LineService[], lines: string[]): { inPro: number; moved: number } {
  const mine = onLines(new Set(lines));
  const inPro = services.filter(s => s.stages.some(x => x.stage === 'pro' && mine(x)));
  return { inPro: inPro.length, moved: inPro.filter(s => s.stages.some(x => x.stage !== 'pro' && !mine(x) && !!x.line)).length };
}

/** The colours of a criticality (Main board): they differ in lightness, not only hue; text keeps 4.5:1. */
export const CRIT_COLOURS: Record<'light' | 'dark', Record<Criticality, { bg: string; fg: string }>> = {
  light: { critical: { bg: '#6b1d24', fg: '#ffffff' }, important: { bg: '#f2c27c', fg: '#3a2200' }, standard: { bg: '#e3e8ee', fg: '#27303a' } },
  dark: { critical: { bg: '#ff9c9c', fg: '#2a0508' }, important: { bg: '#8a5a17', fg: '#fff1dc' }, standard: { bg: '#2b3540', fg: '#d6dde5' } },
};
