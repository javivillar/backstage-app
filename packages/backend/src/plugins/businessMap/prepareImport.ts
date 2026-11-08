import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { parseAllDocuments } from 'yaml';
import {
  A,
  API_VERSION,
  type Change,
  copyDrafts,
  type Counts,
  type CurrentFile,
  type Draft,
  hasHeader,
  type Issue,
  type Mapping,
  type ModelEntity,
  normRef,
  parseRows,
  plan,
  type Planned,
  slug,
  type Source,
  supportCategories,
  type ValueMapping,
} from './importModel';
import { pickBiaSheet, planBia } from './biaModel';
import { readFolder } from './githubFolder';
import { compactSheet, readUpload, type Sheet } from './sheets';
import { resolveUpload, stageUpload } from './uploads';

/**
 * What an import of a business model reads and plans, shared by the scaffolder actions (scaffolderModule.ts:
 * preview, import, adopt) and the route POST /api/business-map/import/preview (previewRouter.ts) that the form field
 * BusinessModelPreview of the template Import business model calls: the same input, the same answer.
 */

export const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
export const dirOf = (namespace: string) => `catalog/business-map/${namespace}`;

export type ImportInput = {
  source: Source;
  file: string;
  fileName?: string;
  sheet?: string | number;
  namespace: string;
  owner?: string;
  mapping?: Mapping;
  valueMapping?: ValueMapping;
  keepFrom?: string;
  industry?: string;
  version?: string;
  skipErrors?: boolean;
};

export type ImportDeps = { config: Config; catalog: CatalogService };

/** The files of a namespace's folder in refresquito-services main ([] when it does not exist yet). */
export async function currentFiles(config: Config, namespace: string, fetchFn: typeof fetch = fetch): Promise<CurrentFile[]> {
  const token = config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token');
  const repo = config.getOptionalString('businessMap.repo') ?? config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services';
  const branch = config.getOptionalString('businessMap.branch') ?? 'main';
  // GraphQL for the whole folder: the tree in one query, the text in batches (githubFolder.ts, shared with the entity provider of the catalog)
  return readFolder({ repo, branch, token }, dirOf(namespace), 1, fetchFn);
}

const refOf = (e: { kind: string; metadata: { name: string; namespace?: string } }) => `${e.kind}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`.toLowerCase();

/** A ReferenceModel of the catalog and the Domains and BusinessProcesses of its namespace. */
export async function modelFromCatalog(catalog: CatalogService, credentials: BackstageCredentials, ref: string) {
  const model = (await catalog.getEntityByRef(normRef(ref, 'referencemodel'), { credentials })) as ModelEntity | undefined;
  const ns = model?.spec?.namespace;
  if (!model || typeof ns !== 'string') throw new Error(`There is no ReferenceModel ${ref} in the catalog.`);
  const { items } = await catalog.getEntities(
    { filter: [{ kind: 'domain', 'metadata.namespace': ns }, { kind: 'businessprocess', 'metadata.namespace': ns }] },
    { credentials },
  );
  return { model, entities: items as ModelEntity[], ref: refOf(model) };
}

/** The sheet to read: the one named or numbered, else the first with the header of the source (APQC: "Combined"). */
function pickSheet(sheets: Sheet[], input: ImportInput): Sheet {
  if (input.sheet !== undefined && input.sheet !== '') {
    const n = Number(input.sheet);
    const s = Number.isInteger(n) && n > 0 ? sheets[n - 1] : sheets.find(x => x.name.toLowerCase() === String(input.sheet).toLowerCase());
    if (!s) throw new Error(`There is no sheet ${input.sheet}: ${sheets.map(x => x.name).join(', ')}.`);
    return s;
  }
  const fits = sheets.filter(s => hasHeader(s.rows, input.source, input.mapping));
  return fits.find(s => input.source === 'apqc' && s.name.toLowerCase() === 'combined') ?? fits[0] ?? sheets[0];
}

/** Everything an import needs, read and planned: what preview shows and import writes. */
export async function prepare(input: ImportInput, deps: ImportDeps, credentials: BackstageCredentials, user: string | undefined, strict: boolean) {
  if (!NAMESPACE.test(input.namespace)) throw new Error(`${input.namespace} is not a namespace (lowercase letters, digits and "-").`);
  const warnings: Issue[] = [];
  let current: CurrentFile[] = [];
  try {
    current = await currentFiles(deps.config, input.namespace);
  } catch (e) {
    // an import that cannot see the current files would overwrite them: only the preview goes on
    // the analysis only updates what is there: without the current files every row would be an error
    if (strict || input.source === 'bia') throw new Error(`Cannot read ${dirOf(input.namespace)} of refresquito-services: ${(e as Error).message}`);
    warnings.push({ message: `The current files could not be read (${(e as Error).message}): shown as a first import.` });
  }
  const oldModel = current
    .flatMap(f => parseAllDocuments(f.text).map(d => d.toJS() as ModelEntity | null))
    .find(d => d?.kind === 'ReferenceModel');
  let mapping = input.mapping;
  let valueMapping = input.valueMapping;
  const saved = oldModel?.metadata.annotations?.[A.importMapping];
  if (saved && input.source === 'own' && !mapping) {
    try {
      const m = JSON.parse(saved) as { mapping?: Mapping; valueMapping?: ValueMapping };
      mapping = m.mapping;
      valueMapping = valueMapping ?? m.valueMapping;
    } catch {
      warnings.push({ message: 'The saved column mapping of the model could not be read: give it again.' });
    }
  }

  const upload = readUpload(resolveUpload(input.file), input.fileName);
  const sheet = pickSheet(upload.sheets, { ...input, mapping });
  const [groups, others] = await Promise.all([
    deps.catalog.getEntities({ filter: { kind: 'group' }, fields: ['kind', 'metadata.name', 'metadata.namespace'] }, { credentials }),
    deps.catalog.getEntities({ filter: [{ kind: 'system' }, { kind: 'component' }, { kind: 'resource' }], fields: ['kind', 'metadata.name', 'metadata.namespace'] }, { credentials }),
  ]);
  if (input.source === 'bia') {
    // the analysis only updates what is there: no ReferenceModel, no new entity, nothing marked gone
    const biaSheet = input.sheet !== undefined && input.sheet !== '' ? sheet : pickBiaSheet(upload.sheets);
    const b = planBia(biaSheet.rows, current, {
      namespace: input.namespace,
      dir: dirOf(input.namespace),
      knownGroups: new Set(groups.items.map(refOf)),
      knownEntities: new Set(others.items.map(refOf)),
    });
    return { parsed: { drafts: [] as Draft[], errors: b.errors, warnings: b.warnings }, planned: b.planned, warnings: [...warnings, ...b.warnings], upload, sheet: biaSheet };
  }
  const parsed = parseRows(sheet.rows, {
    source: input.source,
    mapping,
    valueMapping,
    owner: input.owner,
    version: input.version,
    knownGroups: new Set(groups.items.map(refOf)),
    knownEntities: new Set(others.items.map(refOf)),
  });

  let kept: Draft[] = [];
  if (input.keepFrom) {
    const m = await modelFromCatalog(deps.catalog, credentials, input.keepFrom);
    const roots = supportCategories(m.model, m.entities);
    if (!roots.length) warnings.push({ message: `${m.ref} declares no support categories (spec.supportCategories): nothing kept from it.` });
    kept = copyDrafts(m.entities, roots, { owner: input.owner, from: m.ref });
  }

  const status = input.source === 'own' ? 'customer' : input.source;
  const industry = input.industry || 'cross-industry';
  const suffix = input.version ? `-${slug(input.version)}` : '';
  const shownVersion = input.version ? ` ${input.version}` : '';
  const apqc = input.source === 'apqc';
  const model: ModelEntity = {
    apiVersion: API_VERSION,
    kind: 'ReferenceModel',
    metadata: {
      name: apqc ? `apqc-${slug(industry)}${suffix}` : `${input.namespace}-business-model`,
      title: apqc ? `APQC PCF · ${industry}${shownVersion}` : `Business model of ${input.namespace}`,
      annotations: {
        [A.importMapping]: JSON.stringify({ source: input.source, sheet: sheet.name, mapping, valueMapping }),
        [A.lastImport]: JSON.stringify({ file: upload.fileName, date: new Date().toISOString(), by: user ?? 'unknown' }),
        ...(input.keepFrom ? { [A.keptFrom]: normRef(input.keepFrom, 'referencemodel') } : {}),
      },
    },
    spec: {
      source: status,
      ...(apqc ? { industry } : {}),
      ...(input.version ? { version: input.version } : {}),
      namespace: input.namespace,
    },
  };
  const planned: Planned = plan([...parsed.drafts, ...kept], current, {
    namespace: input.namespace,
    dir: dirOf(input.namespace),
    today: new Date().toISOString().slice(0, 10),
    goneFamily: input.source === 'apqc' ? 'apqc' : 'model',
    model,
  });
  return { parsed, planned, warnings: [...warnings, ...parsed.warnings], upload, sheet };
}

/** What a preview answers (the outputs of refresquito:business-model:preview and the body of the route). */
export type Preview = {
  counts: Counts;
  errors: Issue[];
  warnings: Issue[];
  changes: Change[];
  /** What the template gets in place of the file: a reference to the sheet read (compactSheet), held by Backstage. */
  compact?: string;
};

/** The preview of an import: nothing is written; the current files that cannot be read are a warning. */
export async function previewOf(input: ImportInput, deps: ImportDeps, credentials: BackstageCredentials, user: string | undefined): Promise<Preview> {
  const { parsed, planned, warnings, upload, sheet } = await prepare(input, deps, credentials, user, false);
  const compact = stageUpload(upload.format === 'xlsx' ? compactSheet(sheet, upload.fileName) : resolveUpload(input.file));
  return { counts: planned.counts, errors: parsed.errors, warnings, changes: planned.changes, ...(compact ? { compact } : {}) };
}

/** A bad request body of the preview route (400). */
export class InputError extends Error {}

const SOURCES: Source[] = ['apqc', 'template', 'own', 'bia'];
const optString = (v: unknown, what: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new InputError(`${what} is a string.`);
  return v;
};
const stringMap = (v: unknown, what: string): Record<string, string> | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new InputError(`${what} is an object of strings.`);
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x === undefined || x === null || x === '') continue;
    if (typeof x !== 'string') throw new InputError(`${what}.${k} is a string.`);
    out[k] = x;
  }
  return out;
};

/**
 * The body of POST /import/preview checked, as the schema of the action checks its input: source, file (a data URL)
 * and namespace required; empty optional values (what an empty form field sends) are left out.
 */
export function readImportInput(body: unknown): ImportInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!SOURCES.includes(b.source as Source)) throw new InputError('source is apqc, template, own or bia.');
  if (typeof b.file !== 'string' || !b.file) throw new InputError('file is the uploaded file, a data URL.');
  if (typeof b.namespace !== 'string' || !NAMESPACE.test(b.namespace)) throw new InputError('namespace is a namespace (lowercase letters, digits and "-").');
  let sheet: string | number | undefined;
  if (typeof b.sheet === 'number') sheet = b.sheet;
  else sheet = optString(b.sheet, 'sheet');
  const mapping = stringMap(b.mapping, 'mapping');
  const vm = b.valueMapping as Record<string, unknown> | undefined | null;
  if (vm !== undefined && vm !== null && (typeof vm !== 'object' || Array.isArray(vm))) throw new InputError('valueMapping is { criticality?: { value: critical | important | standard } }.');
  const criticality = stringMap(vm?.criticality, 'valueMapping.criticality');
  return {
    source: b.source as Source,
    file: b.file,
    fileName: optString(b.fileName, 'fileName'),
    sheet,
    namespace: b.namespace,
    owner: optString(b.owner, 'owner'),
    mapping: mapping && Object.keys(mapping).length ? (mapping as Mapping) : undefined,
    valueMapping: criticality ? { criticality } : undefined,
    keepFrom: optString(b.keepFrom, 'keepFrom'),
    industry: optString(b.industry, 'industry'),
    version: optString(b.version, 'version'),
  };
}
