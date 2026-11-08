import type { Criticality } from '../../businessMap';

/**
 * The forms of the business map in the console (ImportModelPage, AdoptModelPage, ProcessFormPage), without React:
 * the values each one sends to its template of backstage-templates (business-model-import, business-model-adopt,
 * business-process-new, business-process-edit: the same names and shapes as their parameters), what is still wrong
 * in a form (a message key per field), the slug of a title, and the preview of an import (the same body and answer
 * as POST /api/business-map/import/preview, packages/backend businessMap/previewRouter.ts). The templates stay the
 * guard: they check the groups and the files again.
 */

/** The groups that may change the business map (the templates refuse anybody else). */
export const BUSINESS_MAP_WRITERS = ['group:default/business-architect', 'group:default/backstage-admin'];
/** Whether someone with these ownership refs may run the templates of the business map. */
export const mayChangeMap = (ownershipEntityRefs: string[]) => ownershipEntityRefs.some(r => BUSINESS_MAP_WRITERS.includes(r.toLowerCase()));

export const NAMESPACE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const OVERRIDE = /^([0-9]+(m|h|d|y))?$/;
export const PROCESS_NAME = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
export const PROCESS_KEY = /^([A-Za-z_][A-Za-z0-9_.-]*)?$/;
const INDUSTRY = /^([a-z0-9][a-z0-9-]*)?$/;
const VERSION = /^[0-9]+(\.[0-9]+)*$/;
const CATEGORY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Problems of a form: field → message key (with vars). Empty when it can be sent. */
export type Problems = Record<string, { key: string; vars?: Record<string, string | number> }>;
const has = (p: Problems) => Object.keys(p).length > 0;
export { has as hasProblems };

/** A ref with kind and namespace, lowercase: group:default/x. */
export function normRef(ref: string, defaultKind: string, defaultNamespace = 'default'): string {
  const r = ref.trim().toLowerCase();
  const withKind = r.includes(':') ? r : `${defaultKind}:${r}`;
  const kind = withKind.slice(0, withKind.indexOf(':'));
  const rest = withKind.slice(withKind.indexOf(':') + 1);
  return `${kind}:${rest.includes('/') ? rest : `${defaultNamespace}/${rest}`}`;
}

/** The name of an entity made of a title, as the template wants it: a-z 0-9 and "-", 2 to 63 characters. */
export function slugOf(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return s.length >= 2 ? s : '';
}

// ---------------------------------------------------------------- import

export type ImportSource = 'apqc' | 'template' | 'own';
export const IMPORT_SOURCES: ImportSource[] = ['apqc', 'template', 'own'];
export const MAPPING_FIELDS = ['id', 'title', 'parent', 'level', 'owner', 'criticality', 'rpo', 'rto', 'retention', 'applications'] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];
export const REQUIRED_MAPPING: MappingField[] = ['id', 'title'];
export const IMPORT_STEPS = ['source', 'mapping', 'preview'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export type ImportForm = {
  source: ImportSource;
  /** the file as a data URL with its name (data:<type>;name=<file>;base64,...), as the classic form sends it */
  file?: string;
  fileName?: string;
  fileSize?: number;
  sheet: string;
  namespace: string;
  owner: string;
  keepFrom: string;
  industry: string;
  version: string;
  mapping: Partial<Record<MappingField, string>>;
  /** the values of the criticality column and what each one means */
  criticalityValues: Array<{ value: string; means: Criticality | '' }>;
  skipErrors: boolean;
};

export const emptyImport = (namespace = ''): ImportForm => ({
  source: 'template',
  sheet: '',
  namespace,
  owner: '',
  keepFrom: '',
  industry: '',
  version: '7.4',
  mapping: {},
  criticalityValues: [],
  skipErrors: false,
});

/** The data URL of the browser with the name of the file in it, the way rjsf does (the template reads it from there). */
export function withFileName(dataUrl: string, name: string): string {
  if (dataUrl.includes(';name=')) return dataUrl;
  const at = dataUrl.indexOf(';base64,');
  const named = `;name=${encodeURIComponent(name)}`;
  if (at >= 0) return `${dataUrl.slice(0, at)}${named}${dataUrl.slice(at)}`;
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? `${dataUrl.slice(0, comma)}${named}${dataUrl.slice(comma)}` : dataUrl;
}

/** The headers of a CSV (its first line, split on ; or ,), to suggest the columns of an own layout. */
export function csvHeaders(text: string): string[] {
  const line = text.replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim()) ?? '';
  const sep = (line.match(/;/g) ?? []).length > (line.match(/,/g) ?? []).length ? ';' : ',';
  return line
    .split(sep)
    .map(h => h.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter(Boolean);
}

/** The column mapping without empty entries (the mapping counts only for an own layout). */
function mappingOf(form: ImportForm): Record<string, string> {
  return Object.fromEntries(Object.entries(form.mapping).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v));
}
function valueMappingOf(form: ImportForm): { criticality: Record<string, string> } | undefined {
  const rows = form.criticalityValues.filter(r => r.value.trim() && r.means);
  return rows.length ? { criticality: Object.fromEntries(rows.map(r => [r.value.trim(), r.means])) } : undefined;
}

/** The body of the preview route (the input of refresquito:business-model:preview); undefined without file or namespace. */
export type PreviewBody = {
  source: ImportSource;
  file: string;
  namespace: string;
  fileName?: string;
  sheet?: string;
  owner?: string;
  mapping?: Record<string, string>;
  valueMapping?: { criticality: Record<string, string> };
  keepFrom?: string;
  industry?: string;
  version?: string;
};

export function previewBody(form: ImportForm): PreviewBody | undefined {
  if (!form.file || !NAMESPACE.test(form.namespace)) return undefined;
  const body: PreviewBody = { source: form.source, file: form.file, namespace: form.namespace };
  if (form.fileName) body.fileName = form.fileName;
  if (form.sheet.trim()) body.sheet = form.sheet.trim();
  if (form.owner) body.owner = form.owner;
  if (form.keepFrom) body.keepFrom = form.keepFrom;
  if (form.source === 'apqc') {
    if (form.industry.trim()) body.industry = form.industry.trim();
    if (form.version.trim()) body.version = form.version.trim();
  }
  if (form.source === 'own') {
    const mapping = mappingOf(form);
    if (Object.keys(mapping).length) body.mapping = mapping;
    const vm = valueMappingOf(form);
    if (vm) body.valueMapping = vm;
  }
  return body;
}

/** A short fingerprint of a preview request: the file by its length and end (a data URL of MB), the rest as it is. */
export function previewKey(body: PreviewBody): string {
  const { file, ...rest } = body;
  const others: Record<string, unknown> = rest;
  return `${file.length}:${file.slice(-48)}:${JSON.stringify(Object.keys(others).sort().map(k => [k, others[k]]))}`;
}

export type Issue = { row?: number; message: string };
export type Change = { kind: 'new' | 'changed' | 'review'; id: string; title: string; what: string };
export type Counts = { domains: number; subdomains: number; new: number; changed: number; gone: number; unchanged: number };
/** compact: an .xlsx, its sheet read as a small CSV data URL, what the template gets instead of the workbook. */
export type Preview = { counts: Counts; errors: Issue[]; warnings: Issue[]; changes: Change[]; compact?: string };
/** The preview of one request (key) as the page holds it. */
export type PreviewState = { key: string; state: 'loading' | 'done' | 'failed'; preview?: Preview; error?: string };

/** What a step of the import still needs. */
export function importProblems(form: ImportForm, step: ImportStep): Problems {
  const p: Problems = {};
  if (step === 'source') {
    if (!form.file) p.file = { key: 'bmf.err.file' };
    if (!NAMESPACE.test(form.namespace)) p.namespace = { key: 'bmf.err.namespace' };
    if (form.source === 'apqc') {
      if (!VERSION.test(form.version.trim())) p.version = { key: 'bmf.err.version' };
      if (!INDUSTRY.test(form.industry.trim())) p.industry = { key: 'bmf.err.industry' };
    }
  }
  if (step === 'mapping' && form.source === 'own') {
    for (const f of REQUIRED_MAPPING) if (!(form.mapping[f] ?? '').trim()) p[`mapping.${f}`] = { key: 'bmf.err.column' };
    form.criticalityValues.forEach((r, i) => {
      if (r.value.trim() && !r.means) p[`value.${i}`] = { key: 'bmf.err.means' };
    });
  }
  return p;
}

/** The first step with a problem, for "Create" from the last step; undefined when every step is fine. */
export function firstBadStep(form: ImportForm): ImportStep | undefined {
  return IMPORT_STEPS.find(s => has(importProblems(form, s)));
}

/**
 * Why the import cannot run yet (a message key), or undefined: the preview is not there or is of other values, it
 * failed, or the file has errors and "skip the rows with errors" is not ticked. The import action checks it again.
 */
export function importBlocker(form: ImportForm, preview: PreviewState | undefined): { key: string; vars?: Record<string, number> } | undefined {
  const body = previewBody(form);
  if (!body) return { key: 'bmf.block.missing' };
  if (!preview || preview.key !== previewKey(body) || preview.state === 'loading') return { key: 'bmf.block.wait' };
  if (preview.state === 'failed' || !preview.preview) return { key: 'bmf.block.failed' };
  const n = preview.preview.errors.length;
  if (n > 0 && !form.skipErrors) return { key: 'bmf.block.errors', vars: { n } };
  return undefined;
}

/** The compact sheet of the preview, when it is the preview of these values. */
function compactOf(form: ImportForm, preview: PreviewState | undefined): string | undefined {
  const body = previewBody(form);
  return body && preview?.key === previewKey(body) ? preview.preview?.compact : undefined;
}

/** The values of the template business-model-import: its parameters, page by page. */
export function importValues(form: ImportForm, preview: PreviewState | undefined): Record<string, unknown> {
  const v: Record<string, unknown> = {
    source: form.source,
    // the sheet of an .xlsx as the preview read it (a small CSV that names the sheet): a workbook in base64 can pass the
    // 10 MB the scaffolder takes
    file: compactOf(form, preview) ?? form.file ?? '',
    sheet: compactOf(form, preview) ? '' : form.sheet.trim(),
    namespace: form.namespace,
    skipErrors: form.skipErrors,
    // the value of the form field BusinessModelPreview of the classic form: a short summary of the preview
    preview: preview
      ? { state: preview.state, key: preview.key, errors: preview.preview?.errors.length ?? 0, warnings: preview.preview?.warnings.length ?? 0 }
      : {},
  };
  if (form.owner) v.owner = form.owner;
  if (form.keepFrom) v.keepFrom = form.keepFrom;
  if (form.source === 'apqc') {
    v.industry = form.industry.trim();
    v.version = form.version.trim();
  }
  if (form.source === 'own') {
    v.mapping = mappingOf(form);
    const vm = valueMappingOf(form);
    if (vm) v.valueMapping = vm;
  }
  return v;
}

export type Card = { value: string; key: string; vars?: Record<string, number>; positive?: boolean };

/** The figures of a preview as the cards of the mockup (domains, new, changed, no longer in the file, unchanged). */
export function cardsOf(c: Counts): Card[] {
  return [
    { value: String(c.domains), key: 'bmf.card.domains', vars: { n: c.subdomains } },
    { value: `+ ${c.new}`, key: 'bmf.card.new', positive: c.new > 0 },
    { value: `~ ${c.changed}`, key: 'bmf.card.changed' },
    { value: `− ${c.gone}`, key: 'bmf.card.gone' },
    { value: String(c.unchanged), key: 'bmf.card.unchanged' },
  ];
}

/** The changes shown in the table: the reviews and changes first (what needs reading), then the new ones; at most n. */
export function shownChanges(changes: Change[], n = 25): { rows: Change[]; total: number } {
  const order: Record<Change['kind'], number> = { review: 0, changed: 1, new: 2 };
  const rows = [...changes].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, n);
  return { rows, total: changes.length };
}

// ---------------------------------------------------------------- adopt

/** An entity of the catalog as the forms read it (only the fields they ask for). */
export type LiteEntity = {
  kind: string;
  metadata: { name: string; namespace?: string; title?: string; annotations?: Record<string, string> };
  spec?: Record<string, unknown>;
};

export const refOf = (e: LiteEntity) => `${e.kind}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`.toLowerCase();
const titleOf = (e: LiteEntity) => e.metadata.title ?? e.metadata.name;
/** The name part of a ref of the same namespace (domain:ns/x, ns/x or x → x). */
const localName = (ref: unknown) => (typeof ref === 'string' ? ref.slice(ref.indexOf('/') + 1).replace(/^[^:]*:/, '').toLowerCase() : '');

export type Category = { id: string; title: string; subdomains: number; processes: number };

/** The ID of a level-1 domain the adopt action takes: its APQC ID, its model ID, else its name. */
const categoryId = (e: LiteEntity) => e.metadata.annotations?.['apqc.org/pcf-id'] ?? e.metadata.annotations?.['refresquito.io/model-id'] ?? e.metadata.name;

/** The level-1 Domains of a reference model (the Domains and BusinessProcesses of its namespace), with their sizes. */
export function categoriesOf(entities: LiteEntity[]): Category[] {
  const domains = entities.filter(e => e.kind.toLowerCase() === 'domain');
  const parentOf = new Map(domains.map(d => [d.metadata.name.toLowerCase(), localName(d.spec?.subdomainOf)]));
  const rootOf = (name: string): string => {
    const seen = new Set<string>();
    let at = name;
    while (parentOf.get(at) && !seen.has(at)) {
      seen.add(at);
      at = parentOf.get(at) ?? at;
    }
    return at;
  };
  const tops = domains.filter(d => !localName(d.spec?.subdomainOf));
  const processes = entities.filter(e => e.kind.toLowerCase() === 'businessprocess');
  return tops
    .map(top => {
      const me = top.metadata.name.toLowerCase();
      return {
        id: categoryId(top),
        title: titleOf(top),
        subdomains: domains.filter(d => d !== top && rootOf(d.metadata.name.toLowerCase()) === me).length,
        processes: processes.filter(p => rootOf(localName(p.spec?.domain)) === me).length,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** The support categories a model declares (spec.supportCategories), else (APQC) the level-1 IDs from 7 on. */
export function supportIds(model: LiteEntity | undefined, categories: Category[]): string[] {
  const declared = model?.spec?.supportCategories;
  if (Array.isArray(declared)) return declared.map(String);
  if (model?.spec?.source !== 'apqc') return [];
  return categories.map(c => c.id).filter(id => Number(id.split('.')[0]) >= 7);
}

export type AdoptForm = { model: string; categories: string[]; namespace: string; owner: string };

export function adoptProblems(form: AdoptForm): Problems {
  const p: Problems = {};
  if (!form.model) p.model = { key: 'bmf.err.model' };
  if (!form.categories.length) p.categories = { key: 'bmf.err.categories' };
  else if (form.categories.some(c => !CATEGORY.test(c))) p.categories = { key: 'bmf.err.category' };
  if (!NAMESPACE.test(form.namespace)) p.namespace = { key: 'bmf.err.namespace' };
  if (!form.owner) p.owner = { key: 'bmf.err.owner' };
  return p;
}

/** The values of the template business-model-adopt. */
export const adoptValues = (form: AdoptForm) => ({ model: form.model, categories: [...new Set(form.categories)], namespace: form.namespace, owner: form.owner });

/** What the pull request of an adoption adds: the picked categories, their subdomains and processes. */
export function adoptTotals(categories: Category[], picked: string[]) {
  const on = categories.filter(c => picked.includes(c.id));
  return { domains: on.length, subdomains: on.reduce((n, c) => n + c.subdomains, 0), processes: on.reduce((n, c) => n + c.processes, 0) };
}

// ---------------------------------------------------------------- process

export type ProcessMode = 'new' | 'edit';
export type ProcessForm = {
  title: string;
  name: string;
  /** whether the name still follows the title (new only) */
  nameFromTitle: boolean;
  description: string;
  namespace: string;
  domain: string;
  owner: string;
  criticality: Criticality;
  rpo: string;
  rto: string;
  retention: string;
  dependsOn: string[];
  processKey: string;
};

export const emptyProcess = (domain = ''): ProcessForm => ({
  title: '',
  name: '',
  nameFromTitle: true,
  description: '',
  namespace: domain ? normRef(domain, 'domain').split(':')[1].split('/')[0] : '',
  domain: domain ? normRef(domain, 'domain') : '',
  owner: '',
  criticality: 'standard',
  rpo: '',
  rto: '',
  retention: '',
  dependsOn: [],
  processKey: '',
});

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const CRITS: Criticality[] = ['critical', 'important', 'standard'];

/** The form of Edit business process, from the process as the catalog has it (its own overrides, not the defaults). */
export function processFormOf(e: LiteEntity): ProcessForm {
  const ns = e.metadata.namespace ?? 'default';
  const spec = e.spec ?? {};
  const crit = str(spec.criticality) as Criticality;
  return {
    title: titleOf(e),
    name: e.metadata.name,
    nameFromTitle: false,
    description: str((e.metadata as { description?: unknown }).description),
    namespace: ns,
    domain: str(spec.domain) ? normRef(str(spec.domain), 'domain', ns) : '',
    owner: str(spec.owner) ? normRef(str(spec.owner), 'group') : '',
    criticality: CRITS.includes(crit) ? crit : 'standard',
    rpo: str(spec.rpo),
    rto: str(spec.rto),
    retention: str(spec.retention),
    // without a namespace, what a process depends on is in default (the business services live there)
    dependsOn: Array.isArray(spec.dependsOn) ? (spec.dependsOn as unknown[]).filter((d): d is string => typeof d === 'string').map(d => normRef(d, 'system')) : [],
    processKey: e.metadata.annotations?.['refresquito.io/process-key'] ?? '',
  };
}

/**
 * Whether the process is kept in a file of its own (catalog/business-map/<namespace>/process-<name>.yaml): only those
 * can be edited by the template; an imported or adopted one is changed by its next import.
 */
export function inOwnFile(e: LiteEntity): boolean {
  const at = e.metadata.annotations?.['backstage.io/managed-by-location'] ?? '';
  return at.includes(`/catalog/business-map/${e.metadata.namespace ?? 'default'}/process-${e.metadata.name}.yaml`);
}

/** A change of the title: the name follows it while it was not typed by hand (new only). */
export function withTitle(form: ProcessForm, title: string): ProcessForm {
  return form.nameFromTitle ? { ...form, title, name: slugOf(title) } : { ...form, title };
}

export function processProblems(form: ProcessForm, mode: ProcessMode): Problems {
  const p: Problems = {};
  if (!form.title.trim()) p.title = { key: 'bmf.err.title' };
  else if (form.title.includes('"')) p.title = { key: 'bmf.err.quote' };
  else if (form.title.length > 120) p.title = { key: 'bmf.err.long', vars: { n: 120 } };
  if (mode === 'new' && !PROCESS_NAME.test(form.name)) p.name = { key: 'bmf.err.name' };
  if (form.description.length > 300) p.description = { key: 'bmf.err.long', vars: { n: 300 } };
  if (!form.domain) p.domain = { key: 'bmf.err.domain' };
  if (!form.owner) p.owner = { key: 'bmf.err.owner' };
  for (const f of ['rpo', 'rto', 'retention'] as const) if (!OVERRIDE.test(form[f].trim())) p[f] = { key: 'bmf.err.duration' };
  if (!PROCESS_KEY.test(form.processKey.trim())) p.processKey = { key: 'bmf.err.processKey' };
  return p;
}

/** The values of the template business-process-new (mode new) or business-process-edit (mode edit, of processRef). */
export function processValues(form: ProcessForm, mode: ProcessMode, processRef?: string): Record<string, unknown> {
  const common = {
    title: form.title.trim(),
    description: form.description.trim(),
    domain: form.domain,
    owner: form.owner,
    processKey: form.processKey.trim(),
    criticality: form.criticality,
    rpo: form.rpo.trim(),
    rto: form.rto.trim(),
    retention: form.retention.trim(),
    dependsOn: [...new Set(form.dependsOn)],
  };
  return mode === 'new' ? { ...common, name: form.name } : { process: processRef ?? '', ...common };
}

/** The template of a mode. */
export const processTemplate = (mode: ProcessMode) => (mode === 'new' ? 'business-process-new' : 'business-process-edit');

/** A Domain as an option of the domain picker: its title, under the title of its parent when it is a subdomain. */
export function domainOptions(domains: LiteEntity[], namespace: string): Array<{ ref: string; label: string; depth: number }> {
  const mine = domains.filter(d => (d.metadata.namespace ?? 'default') === namespace);
  const byName = new Map(mine.map(d => [d.metadata.name.toLowerCase(), d]));
  const chain = (d: LiteEntity): LiteEntity[] => {
    const out: LiteEntity[] = [];
    for (let at: LiteEntity | undefined = d; at && !out.includes(at); at = byName.get(localName(at.spec?.subdomainOf))) out.unshift(at);
    return out;
  };
  return mine
    .map(d => {
      const c = chain(d);
      return { ref: refOf(d), label: c.map(titleOf).join(' › '), depth: c.length - 1 };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The customers (namespaces) that have business-area Domains, sorted. */
export const namespacesOf = (domains: LiteEntity[]) => [...new Set(domains.map(d => d.metadata.namespace ?? 'default'))].sort();
