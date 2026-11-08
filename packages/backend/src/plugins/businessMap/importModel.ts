import { createHash } from 'node:crypto';
import { parseAllDocuments, stringify } from 'yaml';
import { CRITICALITIES, type Criticality, formatDuration, parseDuration } from './continuityModel';
import type { SheetRow } from './sheets';

/**
 * The importer of business models (docs/business-map.md): the rows of a spreadsheet (APQC PCF, the Refresquito
 * template or a customer's own layout) become Domains (business-area), subdomains, BusinessProcesses and their
 * sub-processes (a BusinessProcess with spec.parentProcess: APQC levels 4 and 5, or any row under a process of an own
 * model) of a customer namespace, one YAML file each in catalog/business-map/<namespace>/ of refresquito-services. Pure: the scaffolder
 * actions read the file, the catalog and the current files, and write what this answers.
 *
 * Reimport: entities are matched by their original ID (apqc.org/pcf-id or refresquito.io/model-id). A field changed
 * in the file is applied, unless it was edited in the portal since the last import (its value is not what that
 * import wrote: refresquito.io/imported-hash keeps a short hash of every imported field): then the portal value
 * stays and the change is listed for review. Entities no longer in the file are marked refresquito.io/deprecated,
 * never deleted. The uploaded file itself is never stored.
 *
 * Licence: Refresquito ships the importer only. Each customer uploads the APQC PCF files it has downloaded itself;
 * never commit APQC content anywhere (not even as a test fixture): the fixtures of the tests are made up.
 */

export type Source = 'apqc' | 'template' | 'own';
export const FIELDS = ['id', 'title', 'description', 'parent', 'level', 'owner', 'criticality', 'rpo', 'rto', 'retention', 'applications'] as const;
type Field = (typeof FIELDS)[number] | 'elementId';
/** Which column holds each field: a header name, or a column letter (A, B, AA). */
export type Mapping = Partial<Record<Field, string>>;
export type ValueMapping = { criticality?: Record<string, string> };
export type Issue = { row?: number; message: string };
/** What an entity of the model is: a level-1 domain, a subdomain, a process, or a sub-process (under a process). */
export type EntityType = 'domain' | 'subdomain' | 'process' | 'subprocess';
/**
 * One line of the preview: type and level (1 = a level-1 domain), root (the ID of its level-1 domain, to filter by)
 * and description are there when known (an entity gone from the file has no level nor root).
 */
export type Change = { kind: 'new' | 'changed' | 'review'; id: string; title: string; what: string; type?: EntityType; level?: number; root?: string; description?: string };
export type Counts = {
  domains: number;
  subdomains: number;
  processes: number;
  subprocesses: number;
  new: number;
  changed: number;
  gone: number;
  unchanged: number;
};

export const API_VERSION = 'refresquito.io/v1alpha1';
export const UNASSIGNED = 'group:default/unassigned';
export const A = {
  pcfId: 'apqc.org/pcf-id',
  pcfElementId: 'apqc.org/pcf-element-id',
  pcfVersion: 'apqc.org/pcf-version',
  modelId: 'refresquito.io/model-id',
  modelVersion: 'refresquito.io/model-version',
  hash: 'refresquito.io/imported-hash',
  deprecated: 'refresquito.io/deprecated',
  adoptedFrom: 'refresquito.io/adopted-from',
  importMapping: 'refresquito.io/import-mapping',
  lastImport: 'refresquito.io/last-import',
  keptFrom: 'refresquito.io/kept-from',
};

/** The header names each source finds by itself (a mapping given in the form wins). */
export const DEFAULT_COLUMNS: Record<Source, Mapping> = {
  // the layout of the PCF spreadsheets: hierarchy number, element number, name, and the description when the sheet
  // has one (its header differs between editions: any of these, "|" separates the candidates)
  apqc: { id: 'Hierarchy ID', elementId: 'PCF ID', title: 'Name', description: 'Description|Element Description|Definition' },
  template: {
    id: 'ID', parent: 'Parent', title: 'Title', description: 'Description', owner: 'Owner', criticality: 'Criticality',
    rpo: 'RPO', rto: 'RTO', retention: 'Retention', applications: 'Applications',
  },
  own: {},
};

/** An entity to be, before it has a name: what the file (or a copied model) says of it. */
export type Draft = {
  key: string;
  kind: 'Domain' | 'BusinessProcess';
  title: string;
  description?: string;
  /** Of a Domain: its parent Domain; of a process: its Domain; of a sub-process: its parent process. */
  parentKey?: string;
  /** A sub-process: its parent is a process (parentKey), its domain that of its top process. */
  sub?: boolean;
  /** The level in the model (1 = a level-1 domain) and the ID of its level-1 domain, for the preview. */
  level?: number;
  root?: string;
  row?: number;
  annotations: Record<string, string>;
  owner: string;
  criticality?: Criticality;
  rpo?: string;
  rto?: string;
  retention?: string;
  dependsOn?: string[];
  /** Fields copied as they are (from an adopted model: classification, process key). */
  extra?: { annotations?: Record<string, string>; spec?: Record<string, unknown> };
};

export type ParseOptions = {
  source: Source;
  mapping?: Mapping;
  valueMapping?: ValueMapping;
  owner?: string;
  version?: string;
  /** Lowercase refs of the Groups of the catalog: an owner that is none becomes group:default/unassigned. */
  knownGroups?: Set<string>;
  /** Lowercase refs of the Systems, Components and Resources of the catalog: an application that is none is dropped. */
  knownEntities?: Set<string>;
};

export type Parsed = { drafts: Draft[]; errors: Issue[]; warnings: Issue[] };

/** A ref with kind and namespace, lowercase: group:default/x. */
export function normRef(ref: string, defaultKind: string, defaultNamespace = 'default'): string {
  const r = ref.trim().toLowerCase();
  const withKind = r.includes(':') ? r : `${defaultKind}:${r}`;
  const [kind, rest] = [withKind.slice(0, withKind.indexOf(':')), withKind.slice(withKind.indexOf(':') + 1)];
  return `${kind}:${rest.includes('/') ? rest : `${defaultNamespace}/${rest}`}`;
}

/** The name of an entity made of a title: lowercase, a-z 0-9 and "-", up to 60. */
export function slug(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'item';
}

const keyFamily = (source: Source) => (source === 'apqc' ? 'apqc' : 'model');

/** The matching key of an entity (or a draft) from its annotations; undefined when it came from no model. */
export function keyOf(annotations: Record<string, string> | undefined): string | undefined {
  const a = annotations ?? {};
  if (a[A.pcfElementId]) return `apqc:e:${a[A.pcfElementId]}`;
  if (a[A.pcfId]) return `apqc:${a[A.pcfId].replace(/\.0$/, '')}`;
  if (a[A.modelId]) return `model:${a[A.modelId]}`;
  return undefined;
}

/** Where a field is in the sheet: header name first (case and spaces ignored), then a column letter. */
function columnIndex(header: string[], spec: string | undefined): number | undefined {
  if (!spec) return undefined;
  if (spec.includes('|')) {
    for (const one of spec.split('|')) {
      const i = columnIndex(header, one);
      if (i !== undefined && !/^[A-Z]{1,3}$/.test(one.trim())) return i;
    }
    return undefined;
  }
  const want = spec.trim().toLowerCase().replace(/\s+/g, ' ');
  const i = header.findIndex(h => h.trim().toLowerCase().replace(/\s+/g, ' ') === want);
  if (i >= 0) return i;
  if (/^[A-Z]{1,3}$/.test(spec.trim())) {
    let n = 0;
    for (const ch of spec.trim()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  return undefined;
}

/** The header row: the first of the first 30 rows that holds the id column by name; else the first row. */
function headerRow(rows: SheetRow[], mapping: Mapping): number {
  const id = mapping.id;
  if (id && !/^[A-Z]{1,3}$/.test(id)) {
    const i = rows.slice(0, 30).findIndex(r => columnIndex(r.cells, id) !== undefined && r.cells.some(c => c.trim().toLowerCase() === id.trim().toLowerCase()));
    if (i >= 0) return i;
  }
  return 0;
}

/** Whether a sheet has the header of a source (to pick the sheet of an APQC workbook). */
export function hasHeader(rows: SheetRow[], source: Source, mapping?: Mapping): boolean {
  const m = { ...DEFAULT_COLUMNS[source], ...(mapping ?? {}) };
  if (!m.id || /^[A-Z]{1,3}$/.test(m.id)) return rows.length > 0;
  return rows.slice(0, 30).some(r => r.cells.some(c => c.trim().toLowerCase() === m.id!.trim().toLowerCase()));
}

type Item = {
  row: number;
  id: string;
  elementId?: string;
  title: string;
  parent?: string;
  level?: number;
  cells: Partial<Record<Field, string>>;
};

/** The rows of a sheet as drafts: errors (rows left out) and warnings (imported with a fix). */
export function parseRows(rows: SheetRow[], o: ParseOptions): Parsed {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const mapping: Mapping = { ...DEFAULT_COLUMNS[o.source], ...(o.mapping ?? {}) };
  const h = headerRow(rows, mapping);
  const header = rows[h]?.cells ?? [];
  const col: Partial<Record<Field, number>> = {};
  for (const f of [...FIELDS, 'elementId' as const]) {
    const i = columnIndex(header, mapping[f]);
    if (i !== undefined) col[f] = i;
    else if (mapping[f] && (o.source === 'own' || f === 'id' || f === 'title')) errors.push({ row: rows[h]?.n, message: `There is no column "${mapping[f]}" (${f}).` });
  }
  if (col.id === undefined || col.title === undefined) errors.push({ message: 'The columns of the ID and the title are required.' });
  if (o.source !== 'apqc' && col.parent === undefined && col.level === undefined) errors.push({ message: 'A column of the parent or of the level is required.' });
  if (errors.length) return { drafts: [], errors, warnings };

  // the rows, with their parent
  const items: Item[] = [];
  const stack: Item[] = [];
  for (const r of rows.slice(h + 1)) {
    const cell = (f: Field) => (col[f] === undefined ? '' : (r.cells[col[f]!] ?? '').trim());
    const cells: Partial<Record<Field, string>> = {};
    for (const f of [...FIELDS, 'elementId' as const]) cells[f] = cell(f);
    if (!cells.id && !cells.title) continue;
    if (!cells.id || !cells.title) {
      errors.push({ row: r.n, message: cells.id ? `${cells.id} has no title.` : `"${cells.title}" has no ID.` });
      continue;
    }
    const it: Item = { row: r.n, id: cells.id, elementId: cells.elementId || undefined, title: cells.title, cells };
    if (o.source === 'apqc') {
      if (!/^\d+(\.\d+)*$/.test(it.id)) {
        errors.push({ row: r.n, message: `${it.id} is not a hierarchy ID (1.0, 1.1, 1.1.1).` });
        continue;
      }
      const parts = it.id.replace(/\.0$/, '').split('.');
      it.level = parts.length;
      it.parent = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;
      it.id = parts.join('.');
    } else if (col.parent !== undefined) {
      it.parent = cells.parent || undefined;
    } else {
      const level = Number(cells.level);
      if (!Number.isInteger(level) || level < 1) {
        errors.push({ row: r.n, message: `${it.id}: the level "${cells.level}" is not 1, 2, 3...` });
        continue;
      }
      while (stack.length && (stack[stack.length - 1].level ?? 0) >= level) stack.pop();
      if (level > 1 && !stack.length) {
        errors.push({ row: r.n, message: `${it.id} is at level ${level} with nothing above it.` });
        continue;
      }
      it.level = level;
      it.parent = stack[stack.length - 1]?.id;
      stack.push(it);
    }
    items.push(it);
  }

  // duplicated IDs, then parents not in the file (or with errors), until nothing changes
  const byId = new Map<string, Item>();
  const allIds = new Set(items.map(i => i.id));
  let valid = items.filter(i => {
    if (byId.has(i.id)) {
      errors.push({ row: i.row, message: `The ID ${i.id} is also in row ${byId.get(i.id)!.row}.` });
      return false;
    }
    byId.set(i.id, i);
    return true;
  });
  for (let changed = true; changed; ) {
    const ids = new Set(valid.map(i => i.id));
    const before = valid.length;
    valid = valid.filter(i => {
      if (!i.parent || ids.has(i.parent)) return true;
      errors.push({
        row: i.row,
        message: allIds.has(i.parent) ? `${i.id}: its parent ${i.parent} has errors.` : `${i.id}: its parent ${i.parent} is not in the file.`,
      });
      return false;
    });
    changed = valid.length !== before;
  }

  // depth and children (a loop of parents is an error)
  const parentOf = new Map(valid.map(i => [i.id, i.parent]));
  const depth = new Map<string, number>();
  for (const i of valid) {
    let d = 0;
    let p = i.parent;
    const seen = new Set([i.id]);
    while (p && !seen.has(p)) {
      seen.add(p);
      d++;
      p = parentOf.get(p);
    }
    if (p) {
      errors.push({ row: i.row, message: `${i.id}: its parents make a loop.` });
      depth.set(i.id, -1);
    } else depth.set(i.id, d);
  }
  valid = valid.filter(i => depth.get(i.id)! >= 0);
  const hasChildren = new Set(valid.map(i => i.parent).filter((p): p is string => !!p));

  // what each row becomes, parents first: APQC 1 domain, 2 subdomain, 3 process, 4 and below sub-processes; an own
  // model: a row without parent is a domain, under a domain a subdomain if it has children (else a process), under a
  // subdomain a process, and anything under a process a sub-process
  const kindOf = new Map<string, EntityType>();
  const rootOf = new Map<string, string>();
  for (const i of [...valid].sort((x, y) => depth.get(x.id)! - depth.get(y.id)!)) {
    const d = depth.get(i.id)!;
    const up = i.parent ? kindOf.get(i.parent) : undefined;
    let k: EntityType;
    if (d === 0) k = 'domain';
    else if (up === 'process' || up === 'subprocess') k = 'subprocess';
    else if (o.source === 'apqc') k = d === 1 ? 'subdomain' : 'process';
    else if (up === 'domain') k = hasChildren.has(i.id) ? 'subdomain' : 'process';
    else k = 'process';
    kindOf.set(i.id, k);
    // the ID of the level-1 domain as the file writes it (APQC: 1.0)
    rootOf.set(i.id, i.parent ? rootOf.get(i.parent) ?? i.parent : i.cells.id || i.id);
  }

  const family = keyFamily(o.source);
  const versionKey = o.source === 'apqc' ? A.pcfVersion : A.modelVersion;
  const ownerOf = (i: Item) => {
    const raw = i.cells.owner;
    if (!raw) return o.owner ? normRef(o.owner, 'group') : UNASSIGNED;
    const ref = normRef(raw, 'group');
    if (o.knownGroups?.size && !o.knownGroups.has(ref)) {
      warnings.push({ row: i.row, message: `${i.id}: the owner ${raw} is no group of the catalog: imported as ${UNASSIGNED}.` });
      return UNASSIGNED;
    }
    return ref;
  };
  const durationOf = (i: Item, f: 'rpo' | 'rto' | 'retention') => {
    const raw = i.cells[f];
    if (!raw) return undefined;
    const m = parseDuration(raw);
    if (m === undefined) warnings.push({ row: i.row, message: `${i.id}: ${f} "${raw}" is not a duration (15m, 4h, 30y): left out.` });
    return m === undefined ? undefined : formatDuration(m);
  };
  // a sub-process without its own criticality inherits the one of its parent (none written)
  const criticalityOf = (i: Item, sub: boolean): Criticality | undefined => {
    const raw = i.cells.criticality ?? '';
    if (!raw) return sub ? undefined : 'standard';
    const map = o.valueMapping?.criticality ?? {};
    const found = map[raw] ?? Object.entries(map).find(([k]) => k.trim().toLowerCase() === raw.toLowerCase())?.[1] ?? raw.toLowerCase();
    if (CRITICALITIES.includes(found as Criticality)) return found as Criticality;
    warnings.push({ row: i.row, message: `${i.id}: the criticality "${raw}" is none of ${CRITICALITIES.join(', ')}: ${sub ? 'it inherits that of its parent' : 'imported as standard'}.` });
    return sub ? undefined : 'standard';
  };
  const applicationsOf = (i: Item) => {
    const out: string[] = [];
    for (const a of (i.cells.applications ?? '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean)) {
      const ref = normRef(a, 'system');
      if (o.knownEntities?.size && !o.knownEntities.has(ref)) {
        warnings.push({ row: i.row, message: `${i.id}: the application ${a} is not in the catalog: imported without it.` });
      } else if (!out.includes(ref)) out.push(ref);
    }
    return out;
  };

  const drafts: Draft[] = [];
  for (const i of valid) {
    const k = kindOf.get(i.id)!;
    const annotations: Record<string, string> = {};
    if (family === 'apqc') {
      annotations[A.pcfId] = i.cells.id ?? i.id;
      if (i.elementId) annotations[A.pcfElementId] = i.elementId;
    } else annotations[A.modelId] = i.id;
    if (o.version) annotations[versionKey] = o.version;
    const parentKey = i.parent ? keyOf(family === 'apqc' ? { [A.pcfElementId]: byId.get(i.parent)!.elementId ?? '', [A.pcfId]: i.parent } : { [A.modelId]: i.parent }) : undefined;
    const isProcess = k === 'process' || k === 'subprocess';
    const d: Draft = { key: keyOf(annotations)!, kind: isProcess ? 'BusinessProcess' : 'Domain', title: i.title, parentKey, row: i.row, annotations, owner: ownerOf(i) };
    if (i.cells.description) d.description = i.cells.description;
    d.level = depth.get(i.id)! + 1;
    d.root = rootOf.get(i.id);
    if (k === 'subprocess') d.sub = true;
    if (isProcess) {
      d.criticality = criticalityOf(i, k === 'subprocess');
      d.rpo = durationOf(i, 'rpo');
      d.rto = durationOf(i, 'rto');
      d.retention = durationOf(i, 'retention');
      d.dependsOn = applicationsOf(i);
    }
    drafts.push(d);
  }
  return { drafts, errors, warnings };
}

/** A catalog entity as the files and the catalog hold it (the parts the importer reads). */
export type ModelEntity = {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; title?: string; annotations?: Record<string, string>; [k: string]: unknown };
  spec?: Record<string, unknown>;
};

/**
 * Drafts copied from the entities of a model already in the catalog (adopt a reference model, or keep the support
 * categories of one): the level-1 Domains whose ID or name is in `roots`, their subdomains, processes and
 * sub-processes (each under its parent process).
 */
export function copyDrafts(entities: ModelEntity[], roots: string[], o: { owner?: string; from: string }): Draft[] {
  const domains = entities.filter(e => e.kind === 'Domain');
  const level1 = domains.filter(e => !e.spec?.subdomainOf);
  const wanted = new Set(roots.map(r => r.trim().toLowerCase().replace(/\.0$/, '')));
  const idOf = (e: ModelEntity) => (e.metadata.annotations?.[A.pcfId] ?? e.metadata.annotations?.[A.modelId] ?? '').replace(/\.0$/, '').toLowerCase();
  const picked = new Set(level1.filter(e => wanted.has(idOf(e)) || wanted.has(e.metadata.name) || wanted.has(normRef(e.metadata.name, 'domain', e.metadata.namespace))).map(e => e.metadata.name));
  const nameOf = (ref: unknown, ns?: string) => (typeof ref === 'string' ? normRef(ref, 'domain', ns ?? 'default').split('/')[1] : undefined);
  const subs = domains.filter(e => picked.has(nameOf(e.spec?.subdomainOf, e.metadata.namespace) ?? ''));
  for (const s of subs) picked.add(s.metadata.name);
  const byName = new Map(domains.map(e => [e.metadata.name, e]));
  const keyFor = (e: ModelEntity) => keyOf(e.metadata.annotations) ?? `name:${e.metadata.name}`;
  const owner = o.owner ? normRef(o.owner, 'group') : undefined;
  const out: Draft[] = [];
  const take = (e: ModelEntity, kind: Draft['kind'], parentName?: string, parentProcess?: ModelEntity) => {
    const a = e.metadata.annotations ?? {};
    const annotations: Record<string, string> = {};
    for (const k of [A.pcfId, A.pcfElementId, A.pcfVersion, A.modelId, A.modelVersion]) if (a[k]) annotations[k] = a[k];
    annotations[A.adoptedFrom] = o.from;
    const extraAnnotations = Object.fromEntries(Object.entries(a).filter(([k]) => k === 'refresquito.io/process-key'));
    const parent = parentProcess ?? (parentName ? byName.get(parentName) : undefined);
    const spec = e.spec ?? {};
    const d: Draft = {
      key: keyFor(e),
      kind,
      title: e.metadata.title ?? e.metadata.name,
      parentKey: parent ? keyFor(parent) : undefined,
      annotations,
      owner: owner ?? (typeof spec.owner === 'string' ? normRef(spec.owner, 'group') : UNASSIGNED),
      extra: { annotations: extraAnnotations, spec: typeof spec.classification === 'string' ? { classification: spec.classification } : {} },
    };
    if (e.metadata.description) d.description = String(e.metadata.description);
    if (parentProcess) d.sub = true;
    if (kind === 'BusinessProcess') {
      // a sub-process without its own criticality keeps inheriting it
      if (CRITICALITIES.includes(spec.criticality as Criticality)) d.criticality = spec.criticality as Criticality;
      else if (!parentProcess) d.criticality = 'standard';
      for (const f of ['rpo', 'rto', 'retention'] as const) if (typeof spec[f] === 'string') d[f] = spec[f] as string;
      d.dependsOn = Array.isArray(spec.dependsOn) ? (spec.dependsOn as string[]).map(r => normRef(r, 'system')) : [];
    }
    out.push(d);
  };
  for (const e of level1.filter(x => picked.has(x.metadata.name))) take(e, 'Domain');
  for (const e of subs) take(e, 'Domain', nameOf(e.spec?.subdomainOf, e.metadata.namespace));
  const processes = entities.filter(x => x.kind === 'BusinessProcess');
  const procByName = new Map(processes.map(e => [e.metadata.name, e]));
  const parentProcessOf = (e: ModelEntity) =>
    typeof e.spec?.parentProcess === 'string' ? procByName.get(normRef(e.spec.parentProcess, 'businessprocess', e.metadata.namespace ?? 'default').split('/')[1]) : undefined;
  // the top process of each, to know whether it is in the picked categories
  const topOf = (e: ModelEntity) => {
    let at = e;
    for (let n = 0; n < 20; n++) {
      const up = parentProcessOf(at);
      if (!up) break;
      at = up;
    }
    return at;
  };
  for (const e of processes) {
    const top = topOf(e);
    const parent = nameOf(top.spec?.domain, top.metadata.namespace);
    if (!parent || !picked.has(parent)) continue;
    const up = parentProcessOf(e);
    if (up) take(e, 'BusinessProcess', undefined, up);
    else take(e, 'BusinessProcess', parent);
  }
  return out;
}

/** The level-1 IDs of a model that are support categories: spec.supportCategories, else (APQC) those from 7 on. */
export function supportCategories(model: ModelEntity, entities: ModelEntity[]): string[] {
  const declared = model.spec?.supportCategories;
  if (Array.isArray(declared)) return declared.map(String);
  if (model.spec?.source !== 'apqc') return [];
  return entities
    .filter(e => e.kind === 'Domain' && !e.spec?.subdomainOf)
    .map(e => e.metadata.annotations?.[A.pcfId] ?? '')
    .filter(id => Number(id.split('.')[0]) >= 7);
}

/** A file of the folder of the namespace, as it is in git. */
export type CurrentFile = { path: string; text: string };
export type Planned = { files: CurrentFile[]; counts: Counts; changes: Change[]; referenceModel?: string };
export type PlanOptions = {
  namespace: string;
  /** catalog/business-map/<namespace> */
  dir: string;
  today: string;
  /** Mark as deprecated what this family of keys (apqc / model) has and the drafts have not (import; not adopt). */
  goneFamily?: 'apqc' | 'model';
  /** The ReferenceModel to write (import), merged with the one in the folder. */
  model?: ModelEntity;
};

type Tracked = 'title' | 'description' | 'owner' | 'subdomainOf' | 'domain' | 'parentProcess' | 'criticality' | 'rpo' | 'rto' | 'retention' | 'dependsOn';
const DOMAIN_FIELDS: Tracked[] = ['title', 'owner', 'subdomainOf', 'description'];
const PROCESS_FIELDS: Tracked[] = ['title', 'owner', 'domain', 'criticality', 'rpo', 'rto', 'retention', 'dependsOn', 'parentProcess', 'description'];
/** Fields added later: hashed only when they have a value, so the hashes of older imports stay the same. */
const LATER = new Set<Tracked>(['description', 'parentProcess']);
/** Fields the portal edits: without a hash (a hand-made or adopted entity), their current value stays. */
const PORTAL = new Set<Tracked>(['owner', 'criticality', 'rpo', 'rto', 'retention', 'dependsOn', 'description']);

function getField(e: ModelEntity, f: Tracked): unknown {
  if (f === 'title' || f === 'description') return e.metadata[f];
  return e.spec?.[f];
}

function setField(e: ModelEntity, f: Tracked, v: unknown) {
  if (f === 'title' || f === 'description') {
    if (v === undefined || v === '') delete e.metadata[f];
    else e.metadata[f] = v as string;
    return;
  }
  e.spec = e.spec ?? {};
  if (v === undefined || (Array.isArray(v) && !v.length)) delete e.spec[f];
  else e.spec[f] = v;
}

/** A field as compared and hashed: refs complete and lowercase, lists sorted, nothing as ''. */
function norm(f: Tracked, v: unknown, ns: string): string {
  if (v === undefined || v === null || v === '') return '';
  if (f === 'dependsOn') return Array.isArray(v) ? v.map(x => normRef(String(x), 'system')).sort().join(',') : '';
  if (f === 'owner') return normRef(String(v), 'group');
  if (f === 'domain' || f === 'subdomainOf') return normRef(String(v), 'domain', ns);
  if (f === 'parentProcess') return normRef(String(v), 'businessprocess', ns);
  return String(v);
}

const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);

export function hashesOf(e: ModelEntity, ns: string): string {
  const fields = e.kind === 'Domain' ? DOMAIN_FIELDS : PROCESS_FIELDS;
  return fields
    .filter(f => !LATER.has(f) || norm(f, getField(e, f), ns) !== '')
    .map(f => `${f}:${short(norm(f, getField(e, f), ns))}`)
    .join(',');
}

function readHashes(s: string | undefined): Map<string, string> | undefined {
  if (!s) return undefined;
  return new Map(s.split(',').map(p => p.split(':') as [string, string]));
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '(none)' : String(v ?? '(none)'));

/** Parse the YAML documents of the current files. */
function readCurrent(files: CurrentFile[]) {
  return files.map(f => ({
    path: f.path,
    docs: parseAllDocuments(f.text)
      .map(d => d.toJS() as ModelEntity | null)
      .filter((d): d is ModelEntity => !!d && typeof d === 'object'),
  }));
}

const render = (docs: ModelEntity[]) => docs.map(d => stringify(d, { lineWidth: 0 })).join('---\n');

/** An entity in the order a person reads it. */
function tidy(e: ModelEntity): ModelEntity {
  const { name, namespace, title, annotations, ...rest } = e.metadata;
  const metadata: ModelEntity['metadata'] = { name };
  if (namespace) metadata.namespace = namespace;
  if (title) metadata.title = title;
  if (annotations && Object.keys(annotations).length) metadata.annotations = Object.fromEntries(Object.entries(annotations).sort(([x], [y]) => x.localeCompare(y)));
  Object.assign(metadata, rest);
  const out: ModelEntity = { apiVersion: e.apiVersion, kind: e.kind, metadata };
  if (e.spec) out.spec = e.spec;
  return out;
}

/**
 * What to write: the drafts named (an entity already in the folder keeps its name and its file), merged with the
 * current files by the reimport rules; only the files that change are returned.
 */
export function plan(drafts: Draft[], current: CurrentFile[], o: PlanOptions): Planned {
  const ns = o.namespace;
  const files = readCurrent(current);
  const byKey = new Map<string, { entity: ModelEntity; file: (typeof files)[number] }>();
  const used = new Set<string>();
  for (const f of files) {
    for (const e of f.docs) {
      if (e.kind !== 'Domain' && e.kind !== 'BusinessProcess') continue;
      used.add(e.metadata.name);
      const k = keyOf(e.metadata.annotations);
      if (k) byKey.set(k, { entity: e, file: f });
    }
  }
  const changes: Change[] = [];
  const counts: Counts = { domains: 0, subdomains: 0, processes: 0, subprocesses: 0, new: 0, changed: 0, gone: 0, unchanged: 0 };
  const touched = new Set<(typeof files)[number]>();
  const added: Array<{ path: string; entity: ModelEntity }> = [];
  const names = new Map<string, string>();
  /** The Domain ref of each process drawn (a sub-process: that of its top process). */
  const domainOf = new Map<string, string>();
  const idOf = (d: Draft) => d.annotations[A.pcfId] ?? d.annotations[A.modelId] ?? d.key;
  const typeOf = (d: Draft): EntityType => {
    if (d.kind === 'Domain') return d.parentKey ? 'subdomain' : 'domain';
    return d.sub ? 'subprocess' : 'process';
  };
  const about = (d: Draft): Pick<Change, 'type' | 'level' | 'root' | 'description'> => {
    const x: Pick<Change, 'type' | 'level' | 'root' | 'description'> = { type: typeOf(d) };
    if (d.level) x.level = d.level;
    if (d.root) x.root = d.root;
    if (d.description) x.description = d.description;
    return x;
  };

  // parents first, so a child knows the name of its parent (thousands of rows: depths computed once)
  const byDraftKey = new Map(drafts.map(d => [d.key, d]));
  const depths = new Map<string, number>();
  const depthOf = (d: Draft): number => {
    const known = depths.get(d.key);
    if (known !== undefined) return known;
    let n = 0;
    for (let at = d.parentKey ? byDraftKey.get(d.parentKey) : undefined; at && n < 20; at = at.parentKey ? byDraftKey.get(at.parentKey) : undefined) n++;
    depths.set(d.key, n);
    return n;
  };
  const ordered = [...drafts].sort((x, y) => depthOf(x) - depthOf(y));
  const keys = new Set(drafts.map(d => d.key));

  for (const d of ordered) {
    const type = typeOf(d);
    if (type === 'domain') counts.domains++;
    else if (type === 'subdomain') counts.subdomains++;
    else if (type === 'process') counts.processes++;
    else counts.subprocesses++;
    const parentName = d.parentKey ? names.get(d.parentKey) : undefined;
    if (d.parentKey && !parentName) continue; // its parent was left out
    const found = byKey.get(d.key);
    const match = found && found.entity.kind === d.kind ? found : undefined;
    let name = match?.entity.metadata.name;
    if (!name) {
      const base = slug(d.title);
      name = base;
      // a sub-process named like another takes its ID (stable whatever the order of the rows); the rest as before
      if (d.sub && used.has(name)) name = `${base.slice(0, 50).replace(/-+$/, '')}-${slug(idOf(d))}`;
      for (let n = 2; used.has(name); n++) name = `${base.slice(0, 56)}-${n}`;
      used.add(name);
    }
    names.set(d.key, name);

    // what the file says, as an entity
    const domainSpec: Record<string, unknown> = { type: 'business-area', owner: d.owner };
    if (parentName) domainSpec.subdomainOf = `domain:${ns}/${parentName}`;
    let processSpec: Record<string, unknown> = {};
    if (d.kind === 'BusinessProcess') {
      const domain = d.sub ? domainOf.get(d.parentKey!) ?? '' : `domain:${ns}/${parentName}`;
      domainOf.set(d.key, domain);
      processSpec = { owner: d.owner, domain };
      if (d.sub) processSpec.parentProcess = `businessprocess:${ns}/${parentName}`;
      if (d.criticality) processSpec.criticality = d.criticality;
      else if (!d.sub) processSpec.criticality = 'standard';
      processSpec = { ...processSpec, ...(d.extra?.spec ?? {}) };
    }
    const fresh: ModelEntity = {
      apiVersion: d.kind === 'Domain' ? 'backstage.io/v1alpha1' : API_VERSION,
      kind: d.kind,
      metadata: { name, namespace: ns, title: d.title, annotations: { ...(d.extra?.annotations ?? {}), ...d.annotations } },
      spec: d.kind === 'Domain' ? domainSpec : processSpec,
    };
    setField(fresh, 'description', d.description);
    if (d.kind === 'BusinessProcess') for (const f of ['rpo', 'rto', 'retention', 'dependsOn'] as const) setField(fresh, f, d[f]);
    const hash = hashesOf(fresh, ns);

    if (!match) {
      fresh.metadata.annotations![A.hash] = hash;
      counts.new++;
      changes.push({ kind: 'new', id: idOf(d), title: d.title, what: `new ${type === 'subprocess' ? 'sub-process' : type} ${name}`, ...about(d) });
      added.push({ path: `${o.dir}/${d.kind === 'Domain' ? 'domain' : 'process'}-${name}.yaml`, entity: tidy(fresh) });
      continue;
    }

    const e = match.entity;
    const stored = readHashes(e.metadata.annotations?.[A.hash]);
    const applied: string[] = [];
    for (const f of d.kind === 'Domain' ? DOMAIN_FIELDS : PROCESS_FIELDS) {
      const now = getField(e, f);
      const next = getField(fresh, f);
      if (norm(f, now, ns) === norm(f, next, ns)) continue;
      // a field the last import did not hash (empty then, or added later) was edited when it has a value now
      const before = stored?.get(f);
      let edited: boolean;
      if (!stored) edited = PORTAL.has(f) && norm(f, now, ns) !== '';
      else if (before === undefined && LATER.has(f)) edited = norm(f, now, ns) !== '';
      else edited = before !== short(norm(f, now, ns));
      if (edited) {
        changes.push({ kind: 'review', id: idOf(d), title: d.title, what: `${f} edited in the portal: kept ${show(now)} (the file says ${show(next)})`, ...about(d) });
      } else {
        setField(e, f, next);
        applied.push(`${f}: ${show(now)} → ${show(next)}`);
      }
    }
    const a = { ...(e.metadata.annotations ?? {}) };
    for (const k of [A.pcfVersion, A.modelVersion, A.pcfElementId]) {
      if (d.annotations[k] && a[k] !== d.annotations[k]) {
        if (a[k]) applied.push(`${k}: ${a[k]} → ${d.annotations[k]}`);
        a[k] = d.annotations[k];
      }
    }
    if (a[A.deprecated]) {
      delete a[A.deprecated];
      applied.push('back in the file: no longer deprecated');
    }
    const hashChanged = a[A.hash] !== hash;
    a[A.hash] = hash;
    e.metadata.annotations = a;
    if (applied.length) {
      counts.changed++;
      changes.push({ kind: 'changed', id: idOf(d), title: d.title, what: applied.join('; '), ...about(d) });
    } else if (!changes.some(c => c.kind === 'review' && c.id === idOf(d))) counts.unchanged++;
    if (applied.length || hashChanged) touched.add(match.file);
  }

  // gone from the file: kept, marked deprecated
  if (o.goneFamily) {
    for (const [k, { entity: e, file }] of byKey) {
      if (!k.startsWith(`${o.goneFamily}:`) || keys.has(k) || e.metadata.annotations?.[A.adoptedFrom]) continue;
      counts.gone++;
      if (e.metadata.annotations?.[A.deprecated]) continue;
      e.metadata.annotations = { ...(e.metadata.annotations ?? {}), [A.deprecated]: o.today };
      touched.add(file);
      let type: EntityType = e.spec?.parentProcess ? 'subprocess' : 'process';
      if (e.kind === 'Domain') type = e.spec?.subdomainOf ? 'subdomain' : 'domain';
      const id = e.metadata.annotations?.[A.pcfId] ?? e.metadata.annotations?.[A.modelId] ?? k.replace(/^(apqc:e:|apqc:|model:)/, '');
      changes.push({ kind: 'review', id, title: e.metadata.title ?? e.metadata.name, what: 'no longer in the file: kept and marked deprecated', type });
    }
  }

  const out: CurrentFile[] = [];
  let referenceModel: string | undefined;
  if (o.model) {
    const path = `${o.dir}/reference-model.yaml`;
    const file = files.find(f => f.docs.some(x => x.kind === 'ReferenceModel'));
    const old = file?.docs.find(x => x.kind === 'ReferenceModel');
    const m: ModelEntity = JSON.parse(JSON.stringify(o.model));
    if (old) {
      m.metadata = { ...old.metadata, title: m.metadata.title ?? old.metadata.title, name: old.metadata.name, annotations: { ...(old.metadata.annotations ?? {}), ...(m.metadata.annotations ?? {}) } };
      m.spec = { ...(old.spec ?? {}), ...(m.spec ?? {}) };
    }
    referenceModel = `referencemodel:${m.metadata.namespace ?? 'default'}/${m.metadata.name}`;
    const docs = file ? file.docs.map(x => (x === old ? tidy(m) : x)) : [tidy(m)];
    out.push({ path: file?.path ?? path, text: render(docs) });
    if (file) touched.delete(file);
  }
  for (const f of touched) out.push({ path: f.path, text: render(f.docs.map(x => (x.kind === 'Domain' || x.kind === 'BusinessProcess' ? tidy(x) : x))) });
  for (const a of added) out.push({ path: a.path, text: render([a.entity]) });
  return { files: out, counts, changes, referenceModel };
}
