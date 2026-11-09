import type { MapData, MapProcess } from '../../businessMap';
import { classify } from '../classify';
import type { DepNodeModel } from '../depsModel';
import { heatTree } from './heatmapModel';
import { type BusinessGraph, type Check, checkOf, deliversOf, downFrom, needsOf, type Support, supportOf } from './glassModel';

/**
 * The model of Business map › Matrix: the processes of a customer (rows, by domain) against the platform services and
 * the framework lines (development services) they depend on through their applications. A platform cell says whether
 * the service meets the process's RPO/RTO; a development cell says the support of the line. What if: services marked
 * as failed stop the processes above them for the restore time (the longest RTO of the failed ones), and each process
 * has a margin (its RTO minus that time). A rehearsal changes nothing in the cluster.
 */

export type Column = { id: string; label: string; family: 'platform' | 'development'; tier?: string; rpo?: number; rto?: number; support?: Support; until?: string };
export type Cell = { family: 'platform'; check: Check } | { family: 'development'; support: Support };
export type MatrixRow = { ref: string; process: MapProcess; cells: Map<string, Cell> };
export type MatrixGroup = { ref: string; title: string; rows: MatrixRow[] };
export type Matrix = { columns: Column[]; groups: MatrixGroup[]; footer: Map<string, { deps: number; gaps: number }> };

const isPlatform = (n: DepNodeModel) =>
  n.entity.kind === 'Component' && !['dom', 'sub', 'proc', 'subp', 'biz', 'fwk'].includes(n.layer) && (n.entity.spec?.type === 'platform-service' || classify(n.entity) === 'service');
const isLine = (n: DepNodeModel) => n.entity.kind === 'Component' && n.layer === 'fwk' && n.entity.spec?.type !== 'development-service';

/** a cell that is not "meets" / "supported" */
export const isGap = (c: Cell) => (c.family === 'platform' ? c.check === 'rpo' || c.check === 'rto' : c.support !== 'supported');

export function buildMatrix(g: BusinessGraph, map: MapData, now: number): Matrix {
  const used = new Set([...g.below.values()].flatMap(s => [...s]));
  const nodes = g.nodes.filter(n => used.has(n.id));
  const byLabel = (a: Column, b: Column) => a.label.localeCompare(b.label);
  const platform: Column[] = nodes.filter(isPlatform).map(n => {
    const d = deliversOf(n.entity);
    return { id: n.id, label: n.label, family: 'platform' as const, tier: n.entity.metadata.annotations?.['refresquito.io/sla-tier'], rpo: d.rpo, rto: d.rto };
  });
  const development: Column[] = nodes.filter(isLine).map(n => ({ id: n.id, label: n.label, family: 'development' as const, ...supportOf(n.entity, now) }));
  const columns = [...platform.sort(byLabel), ...development.sort(byLabel)];
  const footer = new Map(columns.map(c => [c.id, { deps: 0, gaps: 0 }]));
  const rowOf = (ref: string): MatrixRow | undefined => {
    const p = g.processes.get(ref);
    if (!p) return undefined;
    const chain = g.below.get(ref) ?? new Set<string>();
    const cells = new Map<string, Cell>();
    for (const c of columns) {
      if (!chain.has(c.id)) continue;
      const cell: Cell = c.family === 'platform' ? { family: 'platform', check: checkOf(needsOf(p), { rpo: c.rpo, rto: c.rto }) } : { family: 'development', support: c.support ?? 'supported' };
      cells.set(c.id, cell);
      const f = footer.get(c.id)!;
      f.deps += 1;
      if (isGap(cell)) f.gaps += 1;
    }
    return { ref, process: p, cells };
  };
  const groups = heatTree(map).map(d => ({ ref: d.ref, title: d.title, rows: d.processes.map(rowOf).filter((r): r is MatrixRow => !!r) }));
  return { columns, groups, footer };
}

export type Verdict = 'spare' | 'no-margin' | 'breach' | 'unknown';
export type Margin = { ref: string; title: string; criticality: MapProcess['criticality']; rto?: number; margin?: number; verdict: Verdict };
export type WhatIf = {
  failed: Column[];
  stopped: MapProcess[];
  critical: number;
  /** the restore time: the longest RTO of the failed services; undefined when one of them says none */
  restore?: number;
  applications: string[];
  domains: string[];
  margins: Margin[];
};

/** What stops when some platform services fail, and the margin of each process while they are restored. */
export function whatIf(g: BusinessGraph, m: Matrix, failedIds: string[]): WhatIf {
  const failedSet = new Set(failedIds);
  const failed = m.columns.filter(c => c.family === 'platform' && failedSet.has(c.id));
  const hit = (ref: string) => failed.some(c => g.below.get(ref)?.has(c.id));
  const rows = m.groups.flatMap(gr => gr.rows.map(r => ({ row: r, domain: gr.title })));
  const stoppedRows = rows.filter(r => hit(r.row.ref));
  const rtos = failed.map(c => c.rto);
  const restore = failed.length && rtos.every((x): x is number => x !== undefined) ? Math.max(...(rtos as number[])) : undefined;
  // the business applications (or, without them, the instances) with a failed service below
  const biz = [...new Set(stoppedRows.flatMap(r => [...(g.below.get(r.row.ref) ?? [])]))]
    .map(id => g.byId.get(id))
    .filter((n): n is DepNodeModel => !!n && n.layer === 'biz' && n.entity.kind === 'Component')
    .filter(n => failed.some(c => downFrom(n.id, g.links).has(c.id)));
  const apps = biz.filter(n => n.entity.spec?.type === 'business-application');
  const applications = [...new Set((apps.length ? apps : biz).map(n => n.label))].sort();
  const margins: Margin[] = stoppedRows.map(({ row }) => {
    const rto = needsOf(row.process).rto;
    const margin = rto !== undefined && restore !== undefined ? rto - restore : undefined;
    let verdict: Verdict = 'unknown';
    if (margin !== undefined) {
      if (margin < 0) verdict = 'breach';
      else if (margin === 0) verdict = 'no-margin';
      else verdict = 'spare';
    }
    return { ref: row.ref, title: row.process.title, criticality: row.process.criticality, rto, margin, verdict };
  });
  margins.sort((a, b) => (a.margin ?? 1e9) - (b.margin ?? 1e9));
  return {
    failed,
    stopped: stoppedRows.map(r => r.row.process),
    critical: stoppedRows.filter(r => r.row.process.criticality === 'critical').length,
    restore,
    applications,
    domains: [...new Set(stoppedRows.map(r => r.domain))].filter(Boolean),
    margins,
  };
}

/** The body of POST /api/business-map/exercises: the rehearsal saved as an exercise of the continuity plan. */
export type ExerciseBody = { namespace: string; failed: string[]; processes: Array<{ ref: string; result: Verdict; marginMinutes: number | null }>; note?: string };

export function exerciseBody(namespace: string, w: WhatIf, note?: string): ExerciseBody {
  const body: ExerciseBody = {
    namespace,
    failed: w.failed.map(c => c.id),
    processes: w.margins.map(x => ({ ref: x.ref, result: x.verdict, marginMinutes: x.margin ?? null })),
  };
  if (note?.trim()) body.note = note.trim();
  return body;
}
