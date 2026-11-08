import { ENDING_DAYS, type Status } from './model';

/**
 * Portal › Development › Application heatmap: one cell per application and check, from the facts Tech Insights keeps
 * of each instance (retriever refresquitoSupplyChainFactRetriever) and what the catalog and Argo CD say. Levels:
 * 0 good, 1 ok, 2 attention, 3 act now, null n/a (no data: never shown as good).
 */

export type Level = 0 | 1 | 2 | 3 | null;
export type CheckId = 'line' | 'lineEnds' | 'frameworkVulns' | 'ownVulns' | 'supplyChain' | 'tests' | 'coverage' | 'codeIssues' | 'endOfLife' | 'licenses' | 'health' | 'ownerDocs';
export type Lens = 'all' | 'framework' | 'security' | 'quality' | 'running';
export type Cell = { text: string; level: Level };
export type Facts = Record<string, unknown> | undefined;
/** behind: newer lines of its framework, when known apart from status (an ending line can also be behind) */
export type CellContext = { status: Status; behind?: number; health?: string; owner?: string; hasDocs: boolean };

/** the checks, in column order: the lens they belong to, where the value comes from, and the tab of the instance that shows it */
export const CHECKS: Array<{ id: CheckId; lens: Exclude<Lens, 'all'>; source: string; to: string }> = [
  { id: 'line', lens: 'framework', source: 'catalog: refresquito.io/framework-line vs the lines of its framework', to: 'dependencies' },
  { id: 'lineEnds', lens: 'framework', source: 'catalog: refresquito.io/supported-until of its line', to: 'dependencies' },
  { id: 'frameworkVulns', lens: 'security', source: 'Tech Insights: frameworkLayerCritical, frameworkLayerHigh (sbom-backend)', to: 'security' },
  { id: 'ownVulns', lens: 'security', source: 'Tech Insights: ownLayerCritical, ownLayerHigh (sbom-backend)', to: 'security' },
  { id: 'supplyChain', lens: 'security', source: 'Tech Insights: sbomOnEveryImage, imagesScanned', to: 'sbom' },
  { id: 'tests', lens: 'quality', source: 'Tech Insights: testsFailed (quality.json of its CI)', to: 'quality' },
  { id: 'coverage', lens: 'quality', source: 'Tech Insights: backendCoverage, frontendCoverage (quality.json of its CI)', to: 'quality' },
  { id: 'codeIssues', lens: 'quality', source: 'Tech Insights: lintIssues + typeErrors (quality.json of its CI)', to: 'quality' },
  { id: 'endOfLife', lens: 'security', source: 'Tech Insights: osEndOfLife, componentsEndOfLife, toolchainsEndOfLife, componentsEndingSoon (Wazuh)', to: 'sbom' },
  { id: 'licenses', lens: 'security', source: 'Tech Insights: deniedLicenseIds, unknownLicenses (SBOM)', to: 'sbom' },
  { id: 'health', lens: 'running', source: 'Argo CD: health of its application', to: 'live' },
  { id: 'ownerDocs', lens: 'quality', source: 'catalog: spec.owner and backstage.io/techdocs-ref', to: 'docs' },
];

const NA: Cell = { text: 'n/a', level: null };

/** a number fact; undefined when missing or -1 (not known) */
const num = (f: Facts, k: string): number | undefined => {
  const v = f?.[k];
  return typeof v === 'number' && v >= 0 ? v : undefined;
};

const coverageLevel = (c: number): Level => {
  if (c >= 80) return 0;
  if (c >= 60) return 1;
  if (c >= 40) return 2;
  return 3;
};

/** the best coverage the report gives (an application without a frontend reports none) */
const coverage = (f: Facts) => {
  const known = [num(f, 'backendCoverage'), num(f, 'frontendCoverage')].filter((n): n is number => n !== undefined);
  return known.length ? Math.max(...known) : undefined;
};

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

function vulns(f: Facts, critical: string, high: string): Cell {
  const c = num(f, critical);
  const h = num(f, high);
  if (c === undefined || h === undefined) return NA;
  const text = [c ? `${c} crit` : '', h ? `${h} high` : ''].filter(Boolean).join(', ') || '0';
  if (c > 0 || h >= 2) return { text, level: 3 };
  return { text, level: h === 1 ? 2 : 0 };
}

function lineCell(f: Facts, s: Status, known?: number): Cell {
  if (s.kind === 'absent') return NA;
  const behind = known ?? s.behind ?? 0;
  if (f?.frameworkLineMaintained === false) return { text: 'unmaintained', level: 3 };
  if (!behind) return { text: 'latest', level: 0 };
  return { text: `${behind} behind`, level: Math.min(3, behind) as Level };
}

function lineEndsCell(s: Status): Cell {
  if (s.kind === 'absent') return NA;
  if (s.daysLeft === undefined) return { text: '—', level: 0 };
  const d = s.daysLeft;
  const text = d < 92 ? `${d} d` : `${Math.floor(d / 30)} mo`;
  if (d >= ENDING_DAYS) return { text, level: 0 };
  return { text, level: d >= 92 ? 2 : 3 };
}

function endOfLife(f: Facts): Cell {
  const out = ['osEndOfLife', 'componentsEndOfLife', 'toolchainsEndOfLife'].map(k => num(f, k));
  const soon = num(f, 'componentsEndingSoon');
  if (num(f, 'osEndOfLife') === undefined) return NA;
  const ended = out.reduce<number>((a, n) => a + (n ?? 0), 0);
  if (ended > 0) return { text: `${ended} ended`, level: 3 };
  if ((soon ?? 0) > 0) return { text: `${soon} ending`, level: 2 };
  return { text: 'ok', level: 0 };
}

function licenses(f: Facts): Cell {
  const unknown = num(f, 'unknownLicenses');
  if (unknown === undefined) return NA;
  const denied = num(f, 'deniedLicenses');
  if (denied === undefined) return NA;
  if (denied > 0) return { text: `${denied} denied`, level: 3 };
  if (unknown > 0) return { text: `${unknown} unknown`, level: 1 };
  return { text: 'ok', level: 0 };
}

function health(h?: string): Cell {
  if (!h) return NA;
  const level = ({ Healthy: 0, Progressing: 1, Degraded: 3, Missing: 3 } as Record<string, Level>)[h];
  return { text: h, level: level ?? null };
}

function ownerDocs(owner: string | undefined, hasDocs: boolean): Cell {
  // a spec.owner without kind is a group (the catalog's default kind for owner)
  const group = !!owner && !owner.toLowerCase().startsWith('user:');
  if (group && hasDocs) return { text: 'ok', level: 0 };
  if (!group && !hasDocs) return { text: 'no owner, no docs', level: 3 };
  return { text: group ? 'no docs' : 'no owner group', level: 2 };
}

export function cell(id: CheckId, facts: Facts, ctx: CellContext): Cell {
  switch (id) {
    case 'line':
      return lineCell(facts, ctx.status, ctx.behind);
    case 'lineEnds':
      return lineEndsCell(ctx.status);
    case 'frameworkVulns':
      return vulns(facts, 'frameworkLayerCritical', 'frameworkLayerHigh');
    case 'ownVulns':
      return vulns(facts, 'ownLayerCritical', 'ownLayerHigh');
    case 'supplyChain':
      if (!facts || typeof facts.sbomOnEveryImage !== 'boolean') return NA;
      return facts.sbomOnEveryImage && facts.imagesScanned === true ? { text: 'yes', level: 0 } : { text: 'no', level: 3 };
    case 'tests': {
      const n = num(facts, 'testsFailed');
      if (n === undefined) return NA;
      return { text: `${n} failed`, level: n ? 3 : 0 };
    }
    case 'coverage': {
      const c = coverage(facts);
      return c === undefined ? NA : { text: pct(c), level: coverageLevel(c) };
    }
    case 'codeIssues': {
      const known = [num(facts, 'lintIssues'), num(facts, 'typeErrors')].filter((n): n is number => n !== undefined);
      if (!known.length) return NA;
      const n = known.reduce((a, b) => a + b, 0);
      let level: Level = 3;
      if (n === 0) level = 0;
      else if (n <= 10) level = 1;
      else if (n <= 50) level = 2;
      return { text: String(n), level };
    }
    case 'endOfLife':
      return endOfLife(facts);
    case 'licenses':
      return licenses(facts);
    case 'health':
      return health(ctx.health);
    case 'ownerDocs':
      return ownerDocs(ctx.owner, ctx.hasDocs);
    default:
      return NA;
  }
}

/** how hot a row is: 3 per "act now", 1 per "attention" */
export const riskScore = (levels: Level[]) => levels.reduce<number>((a, l) => a + (l === 3 ? 3 : Number(l === 2)), 0);

/** "2026-W45": the ISO week of a date (weeks start on Monday; week 1 holds the first Thursday) */
export function isoWeek(date: string): string {
  const d = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export type Metric = 'vulns' | 'coverage' | 'tests' | 'line';
export const METRICS: Metric[] = ['vulns', 'coverage', 'tests', 'line'];

/** latestLine: the latest line of the app's own framework (a Spring app is never compared with Python's) */
function metricCell(metric: Metric, f: Record<string, unknown>, latestLine?: string): Cell {
  if (metric === 'coverage') return cell('coverage', f, { status: { kind: 'latest' }, hasDocs: true });
  if (metric === 'tests') {
    const n = num(f, 'testsFailed');
    return n === undefined ? NA : { text: String(n), level: n ? 3 : 0 };
  }
  if (metric === 'line') {
    const line = String(f.frameworkLine ?? '');
    if (!line) return NA;
    return { text: line, level: line === (latestLine ?? String(f.latestFrameworkLine ?? '')) ? 0 : 2 };
  }
  // the layer facts are -1 unless every image is scanned (critical/high are 0 when none is): never green when unknown
  const parts = ['frameworkLayerCritical', 'frameworkLayerHigh', 'ownLayerCritical', 'ownLayerHigh'].map(k => num(f, k));
  if (parts.some(x => x === undefined)) return NA;
  const n = (parts as number[]).reduce((a, b) => a + b, 0);
  return { text: String(n), level: Math.min(3, n) as Level };
}

/** the last `weeks` ISO weeks up to today, oldest first: the value of the latest point of each week, empty when none */
export function weekly(series: Array<{ timestamp: string; facts: Record<string, unknown> }>, metric: Metric, weeks: number, today: string, latestLine?: string): Array<{ week: string; text: string; level: Level }> {
  const latest = new Map<string, { timestamp: string; facts: Record<string, unknown> }>();
  for (const p of series) {
    const k = isoWeek(p.timestamp);
    const cur = latest.get(k);
    if (!cur || Date.parse(p.timestamp) > Date.parse(cur.timestamp)) latest.set(k, p);
  }
  const base = Date.parse(today.length === 10 ? `${today}T00:00:00Z` : today);
  return Array.from({ length: weeks }, (_, i) => {
    const k = isoWeek(new Date(base - (weeks - 1 - i) * 7 * 86400000).toISOString());
    const p = latest.get(k);
    const week = k.slice(5);
    if (!p) return { week, text: '', level: null };
    return { week, ...metricCell(metric, p.facts ?? {}, latestLine) };
  });
}
