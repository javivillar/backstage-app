import { CRITICALITIES, type ContinuityGraph, type Criticality, type CriticalityDefaults, formatDuration, parseDuration } from './continuityModel';
import { A, type Change, type Counts, type CurrentFile, type Issue, type ModelEntity, normRef, type Planned, readCurrent, render, show, tidy } from './importModel';
import { buildMap, compareIds, type MapProcess } from './mapModel';
import type { Sheet, SheetOut, SheetRow } from './sheets';

/**
 * The business impact analysis (docs/business-map.md § Business impact analysis): an APQC model brings the structure
 * only; the RPO, RTO, MTPD, retention and the workaround of each process come from the analysis its business owners
 * make once a year. Two pure halves:
 *
 *   biaWorkbook   the sheet to fill: one row per process of a customer (a level-1 domain of it, if asked), with what
 *                 the catalog says today, and a Guide sheet with the allowed values (GET /api/business-map/bia)
 *   planBia       the filled sheet back, as an update of the files of the namespace: only the non-empty cells, only
 *                 processes already there (matched by their ID), never a new one, never one marked gone (import
 *                 source bia: the same preview and the same template as an import)
 *
 * What the analysis writes is not part of the imported hash (refresquito.io/imported-hash): for a later APQC reimport
 * these values are portal values, so the APQC file never overwrites them (it says nothing of them anyway).
 */

/** The columns of the sheet, in order; the upload finds them by name (case and spaces ignored). */
export const BIA_COLUMNS = [
  'ID',
  'Domain',
  'Subdomain',
  'Process',
  'Description',
  'Owner',
  'Criticality',
  'RPO',
  'RTO',
  'MTPD',
  'Retention',
  'Workaround',
  'Workaround max',
  'Applications',
  'Notes',
] as const;
type Column = (typeof BIA_COLUMNS)[number];

/** The ID of a process in its model: the APQC hierarchy ID, the ID in the customer's model, else its name. */
export const processId = (e: Pick<ModelEntity, 'metadata'>) => e.metadata.annotations?.[A.pcfId] ?? e.metadata.annotations?.[A.modelId] ?? e.metadata.name;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** A ref as short as the sheet can say it: the name of a group or system in default, else the ref. */
const shortRef = (ref: string, kind: string) => {
  const r = ref.toLowerCase();
  return r.startsWith(`${kind}:default/`) ? r.slice(kind.length + 9) : r;
};

export type BiaOptions = { namespace: string; /** a level-1 domain (its name) */ domain?: string; /** 'all' adds the sub-processes */ level?: '3' | 'all' };

/** The sheet of the analysis of a customer, and its file name; undefined when the customer has no process. */
export function biaWorkbook(graph: ContinuityGraph, defaults: CriticalityDefaults, o: BiaOptions): { file: string; sheets: SheetOut[] } | undefined {
  const map = buildMap(graph, defaults, o.namespace);
  if (map.namespace !== o.namespace) return undefined;
  const domains = new Map(map.domains.map(d => [d.ref, d]));
  const rootOf = (ref: string) => {
    let at = domains.get(ref);
    for (let n = 0; at?.parent && n < 20; n++) at = domains.get(at.parent) ?? at;
    return at;
  };
  const wanted = o.domain ? `domain:${o.namespace}/${o.domain}`.toLowerCase() : undefined;
  const byParent = new Map<string, MapProcess[]>();
  for (const p of map.processes) {
    if (!p.parent) continue;
    if (!byParent.has(p.parent)) byParent.set(p.parent, []);
    byParent.get(p.parent)!.push(p);
  }
  const ordered: MapProcess[] = [];
  const walk = (p: MapProcess, seen: Set<string>) => {
    ordered.push(p);
    if (o.level !== 'all') return;
    for (const c of (byParent.get(p.ref) ?? []).sort((x, y) => compareIds(x.pcfId ?? x.modelId, y.pcfId ?? y.modelId) || x.title.localeCompare(y.title))) {
      if (seen.has(c.ref)) continue;
      seen.add(c.ref);
      walk(c, seen);
    }
  };
  for (const p of map.processes.filter(x => !x.parent && (!wanted || rootOf(x.domain)?.ref === wanted))) walk(p, new Set([p.ref]));

  const rows = ordered.map(p => {
    const e = graph.entity(p.ref);
    const spec = e?.spec ?? {};
    const domain = domains.get(p.domain);
    const root = rootOf(p.domain);
    const w = spec.workaround as { manual?: unknown; maxDuration?: unknown } | undefined;
    const workaround = typeof w?.manual === 'boolean' ? (w.manual ? 'yes' : 'no') : '';
    const apps = graph.children(p.ref).filter(c => !c.startsWith('businessprocess:') && !c.startsWith('domain:'));
    const cells: Record<Column, string> = {
      ID: e ? processId(e) : p.name,
      Domain: root?.title ?? '',
      Subdomain: domain && domain.ref !== root?.ref ? domain.title : '',
      Process: p.title,
      Description: p.description ?? '',
      Owner: str(spec.owner) ? shortRef(normRef(str(spec.owner), 'group'), 'group') : '',
      Criticality: str(spec.criticality),
      RPO: str(spec.rpo),
      RTO: str(spec.rto),
      MTPD: str(spec.mtpd),
      Retention: str(spec.retention),
      Workaround: workaround,
      'Workaround max': str(w?.maxDuration),
      Applications: apps.map(a => shortRef(a, 'system')).join(', '),
      Notes: '',
    };
    return BIA_COLUMNS.map(c => cells[c]);
  });
  const d = (c: Criticality) => defaults[c] ?? {};
  const guide: string[][] = [
    ['Business impact analysis', `${o.namespace}${o.domain ? ` · ${o.domain}` : ''}`],
    ['', ''],
    ['How to fill it', 'Change only the cells you mean to change: an empty cell changes nothing (and a sub-process left empty inherits from its parent). Do not change the ID. Rows can be removed: nothing is deleted.'],
    ['ID', 'The ID of the process in the model (APQC hierarchy ID or the ID of your own model). It matches the row.'],
    ['Owner', 'A group of the portal (its name, e.g. a400m-maintenance).'],
    ['Criticality', CRITICALITIES.join(', ')],
    ['RPO, RTO, MTPD, Retention, Workaround max', 'A duration: a number and m (minutes), h (hours), d (days), w (weeks) or y (years). E.g. 15m, 4h, 3d, 30y.'],
    ['RPO', 'How much data the process can lose (time since the last copy).'],
    ['RTO', 'How long the process can be down before it is restored.'],
    ['MTPD', 'Maximum tolerable period of disruption: after it the harm is unacceptable. The RTO must not be above it.'],
    ['Workaround', 'yes or no: can the process go on by hand while the systems are down?'],
    ['Workaround max', 'How long the manual workaround can last.'],
    ['Applications', 'The business services it needs, separated by commas (their names in the portal).'],
    ['Notes', 'For you and the analysts: not imported.'],
    ['', ''],
    ['Criticality', 'Default RPO / RTO (when the process gives none)'],
    ...CRITICALITIES.map(c => [c, `RPO ${d(c).rpo ?? '—'} · RTO ${d(c).rto ?? '—'}${d(c).ha ? ' · high availability' : ''}`]),
  ];
  const file = `bia-${o.namespace}${o.domain ? `-${o.domain}` : ''}${o.level === 'all' ? '-all' : ''}.xlsx`;
  return {
    file,
    sheets: [
      { name: 'BIA', header: true, widths: [12, 28, 28, 40, 50, 22, 12, 8, 8, 8, 10, 12, 14, 30, 30], rows: [[...BIA_COLUMNS], ...rows] },
      { name: 'Guide', header: false, widths: [36, 100], rows: guide },
    ],
  };
}

/** The sheet of an upload with the analysis: the first whose header has ID and one of the columns of the analysis. */
export function pickBiaSheet(sheets: Sheet[]): Sheet {
  const fits = (s: Sheet) => s.rows.slice(0, 30).some(r => headerIndex(r.cells).has('ID') && ['Criticality', 'RPO', 'RTO', 'MTPD'].some(c => headerIndex(r.cells).has(c as Column)));
  return sheets.find(fits) ?? sheets[0];
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
const BY_NAME = new Map<string, Column>(BIA_COLUMNS.map(c => [norm(c), c]));
/** The columns of a header row by name. */
function headerIndex(cells: string[]): Map<Column, number> {
  const out = new Map<Column, number>();
  cells.forEach((c, i) => {
    const col = BY_NAME.get(norm(c));
    if (col && !out.has(col)) out.set(col, i);
  });
  return out;
}

const YES = new Set(['yes', 'y', 'si', 'sí', 's', 'true', '1', 'x']);
const NO = new Set(['no', 'n', 'false', '0']);

type Edit = { field: string; next: unknown; shown: string };
export type BiaOptionsIn = {
  namespace: string;
  dir: string;
  /** Lowercase refs of the Groups of the catalog (an owner that is none is an error). */
  knownGroups?: Set<string>;
  /** Lowercase refs of the Systems, Components and Resources (an application that is none is an error). */
  knownEntities?: Set<string>;
};
export type BiaPlan = { planned: Planned; errors: Issue[]; warnings: Issue[] };

/**
 * The filled sheet as changes to the processes of the namespace: per row, its non-empty cells of Owner, Criticality,
 * RPO, RTO, MTPD, Retention, Workaround, Workaround max, Applications and Description. A row whose ID is no process
 * of the namespace, or with a value that is not valid, is an error and changes nothing; the rest go on.
 */
export function planBia(rows: SheetRow[], current: CurrentFile[], o: BiaOptionsIn): BiaPlan {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const counts: Counts = { domains: 0, subdomains: 0, processes: 0, subprocesses: 0, new: 0, changed: 0, gone: 0, unchanged: 0 };
  const changes: Change[] = [];
  const planned: Planned = { files: [], counts, changes };
  const h = rows.findIndex(r => headerIndex(r.cells).has('ID'));
  if (h < 0) {
    errors.push({ message: 'There is no column "ID": use the sheet downloaded from the portal (Download BIA sheet).' });
    return { planned, errors, warnings };
  }
  const col = headerIndex(rows[h].cells);
  const files = readCurrent(current);
  const byId = new Map<string, { entity: ModelEntity; file: (typeof files)[number] }>();
  for (const f of files) {
    for (const e of f.docs) {
      if (e.kind !== 'BusinessProcess' || (e.metadata.namespace ?? o.namespace) !== o.namespace) continue;
      const ids = new Set([processId(e), e.metadata.name]);
      for (const id of ids) if (!byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), { entity: e, file: f });
    }
  }
  const touched = new Set<(typeof files)[number]>();
  const seen = new Map<string, number>();
  for (const r of rows.slice(h + 1)) {
    const cell = (c: Column) => (col.has(c) ? (r.cells[col.get(c)!] ?? '').trim() : '');
    const id = cell('ID');
    if (!id) continue;
    if (seen.has(id.toLowerCase())) {
      errors.push({ row: r.n, message: `The ID ${id} is also in row ${seen.get(id.toLowerCase())}.` });
      continue;
    }
    seen.set(id.toLowerCase(), r.n);
    const found = byId.get(id.toLowerCase());
    if (!found) {
      errors.push({ row: r.n, message: `${id} is no process of ${o.namespace}: the analysis only updates processes already there.` });
      continue;
    }
    const e = found.entity;
    const spec = (e.spec ?? {}) as Record<string, unknown>;
    const rowErrors: string[] = [];
    const edits: Edit[] = [];
    const duration = (c: Column, field: string) => {
      const raw = cell(c);
      if (!raw) return;
      const m = parseDuration(raw);
      if (m === undefined) rowErrors.push(`${c} "${raw}" is not a duration (15m, 4h, 3d, 30y)`);
      else edits.push({ field, next: formatDuration(m), shown: formatDuration(m) });
    };
    const owner = cell('Owner');
    if (owner) {
      const ref = normRef(owner, 'group');
      if (o.knownGroups?.size && !o.knownGroups.has(ref)) rowErrors.push(`the owner ${owner} is no group of the catalog`);
      else edits.push({ field: 'owner', next: ref, shown: ref });
    }
    const crit = cell('Criticality').toLowerCase();
    if (crit) {
      if (CRITICALITIES.includes(crit as Criticality)) edits.push({ field: 'criticality', next: crit, shown: crit });
      else rowErrors.push(`the criticality "${cell('Criticality')}" is none of ${CRITICALITIES.join(', ')}`);
    }
    duration('RPO', 'rpo');
    duration('RTO', 'rto');
    duration('MTPD', 'mtpd');
    duration('Retention', 'retention');
    // the workaround: yes/no and its maximum, merged into what it says today (its note is kept)
    const wa = cell('Workaround').toLowerCase();
    const waMax = cell('Workaround max');
    const before = (spec.workaround && typeof spec.workaround === 'object' ? spec.workaround : {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...before };
    if (wa) {
      if (YES.has(wa)) next.manual = true;
      else if (NO.has(wa)) next.manual = false;
      else rowErrors.push(`Workaround "${cell('Workaround')}" is not yes or no`);
    }
    if (waMax) {
      const m = parseDuration(waMax);
      if (m === undefined) rowErrors.push(`Workaround max "${waMax}" is not a duration (15m, 4h, 3d, 30y)`);
      else next.maxDuration = formatDuration(m);
    }
    if (!wa && waMax && typeof next.manual !== 'boolean') rowErrors.push('Workaround max needs Workaround yes or no');
    else if ((wa || waMax) && typeof next.manual === 'boolean') edits.push({ field: 'workaround', next, shown: `${next.manual ? 'yes' : 'no'}${next.maxDuration ? `, up to ${next.maxDuration}` : ''}` });
    const apps = cell('Applications');
    if (apps) {
      const refs: string[] = [];
      for (const a of apps.split(/[,;\n]/).map(x => x.trim()).filter(Boolean)) {
        const ref = normRef(a, 'system');
        if (o.knownEntities?.size && !o.knownEntities.has(ref)) rowErrors.push(`the application ${a} is not in the catalog`);
        else if (!refs.includes(ref)) refs.push(ref);
      }
      edits.push({ field: 'dependsOn', next: refs, shown: refs.join(', ') });
    }
    const description = cell('Description');
    if (description) edits.push({ field: 'description', next: description, shown: description.length > 60 ? `${description.slice(0, 57)}…` : description });

    if (rowErrors.length) {
      errors.push({ row: r.n, message: `${id}: ${rowErrors.join('; ')}.` });
      continue;
    }
    const sub = typeof spec.parentProcess === 'string' && !!spec.parentProcess;
    if (sub) counts.subprocesses++;
    else counts.processes++;
    const applied: string[] = [];
    for (const ed of edits) {
      const now = ed.field === 'description' ? e.metadata.description : spec[ed.field];
      const same = JSON.stringify(normalised(ed.field, now)) === JSON.stringify(normalised(ed.field, ed.next));
      if (same) continue;
      const was = ed.field === 'workaround' ? workaroundText(now) : show(Array.isArray(now) ? now : now ?? undefined);
      applied.push(`${ed.field === 'dependsOn' ? 'applications' : ed.field}: ${was} → ${ed.shown}`);
      if (ed.field === 'description') e.metadata.description = ed.next as string;
      else spec[ed.field] = ed.next;
    }
    e.spec = spec;
    const about = { type: sub ? ('subprocess' as const) : ('process' as const), description: e.metadata.description ? String(e.metadata.description) : undefined };
    if (applied.length) {
      counts.changed++;
      touched.add(found.file);
      changes.push({ kind: 'changed', id, title: e.metadata.title ?? e.metadata.name, what: applied.join('; '), type: about.type, ...(about.description ? { description: about.description } : {}) });
    } else counts.unchanged++;
  }
  if (!seen.size) warnings.push({ message: 'The sheet has no row with an ID.' });
  for (const f of touched) planned.files.push({ path: f.path, text: render(f.docs.map(x => (x.kind === 'Domain' || x.kind === 'BusinessProcess' ? tidy(x) : x))) });
  return { planned, errors, warnings };
}

/** A value as compared: refs lowercase, lists sorted, an object with its keys in order. */
function normalised(field: string, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (field === 'dependsOn') return Array.isArray(v) ? v.map(x => normRef(String(x), 'system')).sort() : null;
  if (field === 'owner') return normRef(String(v), 'group');
  if (field === 'workaround' && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  return v;
}

const workaroundText = (v: unknown) => {
  if (!v || typeof v !== 'object') return '(none)';
  const w = v as { manual?: unknown; maxDuration?: unknown };
  if (typeof w.manual !== 'boolean') return '(none)';
  return `${w.manual ? 'yes' : 'no'}${typeof w.maxDuration === 'string' ? `, up to ${w.maxDuration}` : ''}`;
};
