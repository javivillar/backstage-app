import type { CheckResult, Criticality, MapData, MapDomain, MapProcess } from '../../businessMap';
import { nameOf, UNASSIGNED } from './businessMapModel';

/**
 * Business continuity › Explorer, without React: the whole model of a customer as one tree (level-1 domains →
 * subdomains → processes → sub-processes) flattened into rows in the order of their IDs, the filters (a search over
 * ID, title and description shows each match with its ancestors), what is open, the pages and the CSV of the rows.
 */

export type RowType = 'domain' | 'subdomain' | 'process' | 'subprocess';
export type ExplorerRow = {
  /** the entity ref (domain:… or businessprocess:…) */
  key: string;
  type: RowType;
  /** 1 = a level-1 domain */
  level: number;
  /** the ID in the model (APQC hierarchy ID, own model ID), '' when none */
  id: string;
  title: string;
  description?: string;
  parent?: string;
  /** the ref of its level-1 domain */
  root: string;
  /** how many rows hang directly under it */
  children: number;
  criticality?: Criticality;
  criticalityInherited?: boolean;
  rpo?: string;
  rto?: string;
  /** a process: its check; a domain: the worst of the processes under it */
  result?: CheckResult;
  /** the names of what it depends on (inherited for a sub-process that says none) */
  applications: string[];
  applicationsInherited?: boolean;
  /** the owner group's name, '' when unassigned */
  owner: string;
};

const order = (a: { id: string; title: string }, b: { id: string; title: string }) =>
  (a.id || '￿').localeCompare(b.id || '￿', undefined, { numeric: true }) || a.title.localeCompare(b.title);

/** The worst of some results: a gap if any, unknown if any, else meets (undefined for none). */
export function worstResult(results: Array<CheckResult | undefined>): CheckResult | undefined {
  const known = results.filter((r): r is CheckResult => !!r);
  if (!known.length) return undefined;
  if (known.includes('gap')) return 'gap';
  return known.includes('unknown') ? 'unknown' : 'meets';
}

/** Every domain and process of a map as rows, depth first, in the order of their IDs. */
export function explorerRows(map: Pick<MapData, 'domains' | 'processes'>): ExplorerRow[] {
  const domains = new Map(map.domains.map(d => [d.ref, d]));
  const kids = new Map<string, Array<{ ref: string; id: string; title: string; d?: MapDomain; p?: MapProcess }>>();
  const add = (parent: string, item: { ref: string; id: string; title: string; d?: MapDomain; p?: MapProcess }) => {
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent)!.push(item);
  };
  const tops: Array<{ ref: string; id: string; title: string; d?: MapDomain }> = [];
  for (const d of map.domains) {
    const item = { ref: d.ref, id: d.pcfId ?? d.modelId ?? '', title: d.title, d };
    if (d.parent && domains.has(d.parent)) add(d.parent, item);
    else tops.push(item);
  }
  const procs = new Map(map.processes.map(p => [p.ref, p]));
  for (const p of map.processes) {
    const item = { ref: p.ref, id: p.pcfId ?? p.modelId ?? '', title: p.title, p };
    if (p.parent && procs.has(p.parent)) add(p.parent, item);
    else if (domains.has(p.domain)) add(p.domain, item);
  }
  const out: ExplorerRow[] = [];
  const seen = new Set<string>();
  const walk = (item: { ref: string; id: string; title: string; d?: MapDomain; p?: MapProcess }, level: number, root: string, parent?: string): ExplorerRow | undefined => {
    if (seen.has(item.ref)) return undefined;
    seen.add(item.ref);
    const under = [...(kids.get(item.ref) ?? [])].sort(order);
    const p = item.p;
    let type: RowType = 'domain';
    if (p) type = p.parent ? 'subprocess' : 'process';
    else if (level > 1) type = 'subdomain';
    const row: ExplorerRow = { key: item.ref, type, level, id: item.id, title: item.title, root, children: under.length, applications: [], owner: '' };
    if (parent) row.parent = parent;
    const description = p?.description ?? item.d?.description;
    if (description) row.description = description;
    if (p) {
      row.criticality = p.criticality;
      if (p.inherited?.includes('criticality')) row.criticalityInherited = true;
      if (p.requirement.rpo) row.rpo = p.requirement.rpo;
      if (p.requirement.rto) row.rto = p.requirement.rto;
      row.result = p.result;
      row.applications = p.dependsOn.map(nameOf);
      if (p.inherited?.includes('dependsOn')) row.applicationsInherited = true;
      row.owner = p.owner && p.owner !== UNASSIGNED ? nameOf(p.owner) : '';
    }
    out.push(row);
    const childRows = under.map(c => walk(c, level + 1, root, item.ref)).filter((r): r is ExplorerRow => !!r);
    if (!p) row.result = worstResult(childRows.map(r => r.result));
    return row;
  };
  for (const t of [...tops].sort(order)) walk(t, 1, t.ref);
  return out;
}

export type ExplorerFilter = { text: string; level: string; root: string; criticality: '' | Criticality; result: '' | CheckResult; owner: string };
export const NO_EXPLORER_FILTER: ExplorerFilter = { text: '', level: '', root: '', criticality: '', result: '', owner: '' };
export const filtering = (f: ExplorerFilter) => Object.values(f).some(v => String(v).trim() !== '');

const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Whether a row passes every filter that is set. */
export function matches(r: ExplorerRow, f: ExplorerFilter): boolean {
  const text = fold(f.text.trim());
  if (text && !fold(`${r.id} ${r.title} ${r.description ?? ''}`).includes(text)) return false;
  if (f.level && String(r.level) !== f.level) return false;
  if (f.root && r.root !== f.root) return false;
  if (f.criticality && r.criticality !== f.criticality) return false;
  if (f.result && r.result !== f.result) return false;
  if (f.owner && r.owner !== f.owner) return false;
  return true;
}

export type FilteredRow = ExplorerRow & { match: boolean };

/** The rows that match, each with its ancestors (to see where it is), in the order of the tree. */
export function filterRows(rows: ExplorerRow[], f: ExplorerFilter): FilteredRow[] {
  if (!filtering(f)) return rows.map(r => ({ ...r, match: true }));
  const byKey = new Map(rows.map(r => [r.key, r]));
  const keep = new Set<string>();
  const hit = new Set<string>();
  for (const r of rows) {
    if (!matches(r, f)) continue;
    hit.add(r.key);
    for (let at: ExplorerRow | undefined = r; at && !keep.has(at.key); at = at.parent ? byKey.get(at.parent) : undefined) keep.add(at.key);
  }
  return rows.filter(r => keep.has(r.key)).map(r => ({ ...r, match: hit.has(r.key) }));
}

/** The rows to open so every match shows: those with a row of the list under them. */
export function openFor(rows: Array<Pick<ExplorerRow, 'key' | 'parent'>>): Set<string> {
  return new Set(rows.map(r => r.parent).filter((p): p is string => !!p));
}

/** Collapse to level 3: open the domains and subdomains, so the processes show and their sub-processes do not. */
export const openToLevel = (rows: ExplorerRow[], level: number) => new Set(rows.filter(r => r.level < level && r.children > 0).map(r => r.key));

/** Every row that has rows under it (expand all). */
export const openAll = (rows: ExplorerRow[]) => new Set(rows.filter(r => r.children > 0).map(r => r.key));

/** The rows that show: those whose ancestors are all open. */
export function visibleRows<T extends Pick<ExplorerRow, 'key' | 'parent'>>(rows: T[], open: Set<string>): T[] {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const shown = new Map<string, boolean>();
  const isShown = (r: T): boolean => {
    const known = shown.get(r.key);
    if (known !== undefined) return known;
    const parent = r.parent ? byKey.get(r.parent) : undefined;
    const v = !parent || (open.has(parent.key) && isShown(parent));
    shown.set(r.key, v);
    return v;
  };
  return rows.filter(isShown);
}

/** The options of the filters: the levels, the level-1 domains and the owners of the rows. */
export function filterOptions(rows: ExplorerRow[]) {
  return {
    levels: [...new Set(rows.map(r => r.level))].sort((a, b) => a - b),
    roots: rows.filter(r => r.level === 1).map(r => ({ key: r.key, label: r.id ? `${r.id} ${r.title}` : r.title })),
    owners: [...new Set(rows.map(r => r.owner).filter(Boolean))].sort(),
  };
}

const csvCell = (v: string) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The rows as a CSV (UTF-8, for Excel with its BOM): what the table shows, every row of the filters, not one page. */
export function explorerCsv(rows: FilteredRow[]): string {
  const head = ['Level', 'Type', 'ID', 'Title', 'Description', 'Criticality', 'Criticality inherited', 'RPO', 'RTO', 'Check', 'Applications', 'Owner', 'Match'];
  const lines = rows.map(r =>
    [
      String(r.level),
      r.type,
      r.id,
      r.title,
      r.description ?? '',
      r.criticality ?? '',
      r.criticalityInherited ? 'yes' : '',
      r.rpo ?? '',
      r.rto ?? '',
      r.result ?? '',
      r.applications.join(', '),
      r.owner,
      r.match ? 'yes' : '',
    ]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
}
