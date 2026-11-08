import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';

/**
 * Portal › Development › Frameworks: the lines of each framework and the business applications on them, from the
 * catalog only. A line is a Component tagged (or of spec.type) framework-line, part of its framework (subcomponentOf);
 * an application has one instance per stage (annotations refresquito.io/framework-line, -/stage, -/application) and
 * its platform blocks are Resources with refresquito.io/platform-block.
 */

export type Stage = 'dev' | 'pre' | 'pro';
export const STAGES: Stage[] = ['dev', 'pre', 'pro'];

export type Line = {
  ref: string;
  framework: string;
  frameworkTitle: string;
  line: string;
  title: string;
  lifecycle: string;
  /** ISO date; only when refresquito.io/supported-until is one */
  supportedUntil?: string;
  supportText: string;
  versions: string;
  links: Array<{ title: string; url: string }>;
  requires: string[];
};

export type AppRow = {
  application: string;
  system?: string;
  owner?: string;
  framework: string;
  lines: Partial<Record<Stage, string>>;
  /** entity ref of the instance of each stage */
  instances: Partial<Record<Stage, string>>;
  blocks: string[];
};

export type Status = { kind: 'latest' | 'behind' | 'ending' | 'absent'; behind?: number; daysLeft?: number };

/** a line whose support ends within this many days is "ending" */
export const ENDING_DAYS = 183;

const ANN_LINE = 'refresquito.io/framework-line';
const ANN_STAGE = 'refresquito.io/stage';
const ANN_APP = 'refresquito.io/application';
const ANN_BLOCK = 'refresquito.io/platform-block';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ann = (e: Entity, k: string) => e.metadata.annotations?.[k]?.trim() ?? '';
const isComponent = (e: Entity) => e.kind.toLowerCase() === 'component';

export const isLine = (e: Entity) => isComponent(e) && ((e.metadata.tags ?? []).includes('framework-line') || e.spec?.type === 'framework-line');

/** "3.1" < "3.10": by number, part by part */
export function compareLines(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** "3.1", also when written as the component of the line (python-framework-3-1) */
export function normalizeLine(value?: string): string {
  const m = /(\d+)[.-](\d+)$/.exec((value ?? '').trim());
  return m ? `${m[1]}.${m[2]}` : '';
}

/** whole days from a to b (ISO dates or timestamps), UTC */
export function daysBetween(a: string, b: string): number {
  const day = (s: string) => Math.floor(Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s) / 86400000);
  return day(b) - day(a);
}

const refName = (ref: unknown) => {
  if (typeof ref !== 'string' || !ref) return '';
  try {
    return parseEntityRef(ref, { defaultKind: 'component', defaultNamespace: 'default' }).name;
  } catch {
    return '';
  }
};

export function linesOf(entities: Entity[]): Line[] {
  const titles = new Map(entities.filter(isComponent).map(e => [e.metadata.name, e.metadata.title ?? e.metadata.name]));
  return entities
    .filter(isLine)
    .map(e => {
      const framework = refName(e.spec?.subcomponentOf) || e.metadata.name.replace(/-\d+-\d+$/, '');
      const until = ann(e, 'refresquito.io/supported-until');
      return {
        ref: stringifyEntityRef(e),
        framework,
        frameworkTitle: titles.get(framework) ?? framework,
        line: normalizeLine(ann(e, ANN_LINE)) || normalizeLine(e.metadata.name),
        title: e.metadata.title ?? e.metadata.name,
        lifecycle: String(e.spec?.lifecycle ?? ''),
        supportedUntil: ISO_DATE.test(until) ? until : undefined,
        supportText: until,
        versions: ann(e, 'refresquito.io/versions'),
        links: (e.metadata.links ?? []).map(l => ({ title: l.title ?? l.url, url: l.url })),
        requires: ann(e, 'refresquito.io/requires').split(',').map(s => s.trim()).filter(Boolean),
      };
    })
    .sort((a, b) => a.framework.localeCompare(b.framework) || compareLines(a.line, b.line));
}

/** an instance of a business application (not a line, not a service of a Spring application) */
const isInstance = (e: Entity) =>
  isComponent(e) && !isLine(e) && !!ann(e, ANN_LINE) && !ann(e, 'refresquito.io/service') && (e.spec?.type === 'application-instance' || !!ann(e, ANN_STAGE) || !!ann(e, 'argocd/app-name'));

/** the framework of an instance: the line it depends on, else the framework that has its line number, else the same major */
function frameworkOf(e: Entity, lines: Line[]): string {
  const deps = [...((e.spec?.dependsOn as string[] | undefined) ?? []), ...(e.relations ?? []).filter(r => r.type === 'dependsOn').map(r => r.targetRef)];
  const byRef = lines.find(l => deps.some(d => refName(d) === refName(l.ref)));
  if (byRef) return byRef.framework;
  const v = normalizeLine(ann(e, ANN_LINE));
  const same = lines.find(l => l.line === v);
  if (same) return same.framework;
  return lines.find(l => l.line.split('.')[0] === v.split('.')[0])?.framework ?? '';
}

export function appsOf(entities: Entity[], lines: Line[]): AppRow[] {
  const rows = new Map<string, AppRow>();
  const instanceApp = new Map<string, string>();
  for (const e of entities.filter(isInstance)) {
    const application = ann(e, ANN_APP) || e.metadata.name;
    const stage = (STAGES as string[]).includes(ann(e, ANN_STAGE)) ? (ann(e, ANN_STAGE) as Stage) : 'pro';
    const row = rows.get(application) ?? { application, framework: '', lines: {}, instances: {}, blocks: [] };
    row.lines[stage] = normalizeLine(ann(e, ANN_LINE));
    row.instances[stage] = stringifyEntityRef(e);
    row.framework = row.framework || frameworkOf(e, lines);
    // the pro instance speaks for the application
    if (stage === 'pro' || !row.owner) row.owner = (e.spec?.owner as string | undefined) ?? row.owner;
    if (stage === 'pro' || !row.system) row.system = (e.spec?.system as string | undefined) ?? row.system;
    rows.set(application, row);
    instanceApp.set(e.metadata.name, application);
  }
  // a block names the instance (Argo app) that declares it, or the application
  for (const r of entities.filter(e => e.kind.toLowerCase() === 'resource' && ann(e, ANN_BLOCK))) {
    const owner = ann(r, ANN_APP);
    const row = rows.get(instanceApp.get(owner) ?? owner);
    if (row && !row.blocks.includes(ann(r, ANN_BLOCK))) row.blocks.push(ann(r, ANN_BLOCK));
  }
  return [...rows.values()].map(r => ({ ...r, blocks: r.blocks.sort() })).sort((a, b) => a.application.localeCompare(b.application));
}

export function statusOf(app: AppRow, stage: Stage, lines: Line[], today: string): Status {
  const v = app.lines[stage];
  if (!v) return { kind: 'absent' };
  const own = lines.filter(l => l.framework === app.framework);
  const current = own.find(l => l.line === v);
  const daysLeft = current?.supportedUntil ? Math.max(0, daysBetween(today, current.supportedUntil)) : undefined;
  if (daysLeft !== undefined && daysLeft < ENDING_DAYS) return { kind: 'ending', daysLeft };
  const newer = own.filter(l => compareLines(l.line, v) > 0).length;
  // a line the catalog no longer keeps is out of support: behind even with no newer line known
  const behind = current ? newer : Math.max(1, newer);
  const s: Status = behind ? { kind: 'behind', behind } : { kind: 'latest' };
  if (daysLeft !== undefined) s.daysLeft = daysLeft;
  return s;
}

/** the latest line of each framework */
export function latestLines(lines: Line[]): Map<string, Line> {
  const m = new Map<string, Line>();
  for (const l of lines) m.set(l.framework, l); // sorted: the last one wins
  return m;
}
