import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { coreServices, createBackendModule, type BackstageCredentials } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { catalogServiceRef, type CatalogService } from '@backstage/plugin-catalog-node';
import { createTemplateAction, scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { parseAllDocuments } from 'yaml';
import { GitHubFiles } from '../clusterVms';
import {
  A,
  API_VERSION,
  copyDrafts,
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
import { readUpload, type Sheet } from './sheets';

/**
 * Scaffolder actions of the business map (the templates Import business model and Adopt reference model):
 *   refresquito:business-model:preview  what an import would do, without writing anything
 *   refresquito:business-model:import   writes catalog/business-map/<namespace>/*.yaml into the workspace
 *   refresquito:business-model:adopt    copies level-1 categories of a ReferenceModel into a customer namespace
 * The next step of the template publishes the workspace as a pull request on refresquito-services. The current files
 * of the namespace are read from its main branch (the GitHub token of the backend) for the reimport rules.
 */

const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const dirOf = (namespace: string) => `catalog/business-map/${namespace}`;

type ImportInput = {
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

type Deps = { config: Config; catalog: CatalogService };

/** The files of a namespace's folder in refresquito-services main ([] when it does not exist yet). */
async function currentFiles(config: Config, namespace: string): Promise<CurrentFile[]> {
  const token = config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token');
  const repo = config.getOptionalString('businessMap.repo') ?? config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services';
  const gh = new GitHubFiles(repo, config.getOptionalString('businessMap.branch') ?? 'main', token);
  const list = (await gh.list(dirOf(namespace))).filter(f => /\.ya?ml$/.test(f.name));
  return Promise.all(list.map(async f => ({ path: f.path, text: (await gh.get(f.path)).text })));
}

const refOf = (e: { kind: string; metadata: { name: string; namespace?: string } }) => `${e.kind}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`.toLowerCase();

/** A ReferenceModel of the catalog and the Domains and BusinessProcesses of its namespace. */
async function modelFromCatalog(catalog: CatalogService, credentials: BackstageCredentials, ref: string) {
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
async function prepare(input: ImportInput, deps: Deps, credentials: BackstageCredentials, user: string | undefined, strict: boolean) {
  if (!NAMESPACE.test(input.namespace)) throw new Error(`${input.namespace} is not a namespace (lowercase letters, digits and "-").`);
  const warnings: Issue[] = [];
  let current: CurrentFile[] = [];
  try {
    current = await currentFiles(deps.config, input.namespace);
  } catch (e) {
    // an import that cannot see the current files would overwrite them: only the preview goes on
    if (strict) throw new Error(`Cannot read ${dirOf(input.namespace)} of refresquito-services: ${(e as Error).message}`);
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

  const upload = readUpload(input.file, input.fileName);
  const sheet = pickSheet(upload.sheets, { ...input, mapping });
  const [groups, others] = await Promise.all([
    deps.catalog.getEntities({ filter: { kind: 'group' }, fields: ['kind', 'metadata.name', 'metadata.namespace'] }, { credentials }),
    deps.catalog.getEntities({ filter: [{ kind: 'system' }, { kind: 'component' }, { kind: 'resource' }], fields: ['kind', 'metadata.name', 'metadata.namespace'] }, { credentials }),
  ]);
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
  return { parsed, planned, warnings: [...warnings, ...parsed.warnings] };
}

async function writeAll(workspace: string, files: CurrentFile[]) {
  for (const f of files) {
    const target = join(workspace, f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.text, 'utf8');
  }
}

/** preview and import: the same input (preview ignores skipErrors); preview answers, import writes. */
function createImportLikeAction(deps: Deps, write: boolean) {
  return createTemplateAction({
    id: write ? 'refresquito:business-model:import' : 'refresquito:business-model:preview',
    description: write
      ? 'Writes the Domains, BusinessProcesses and ReferenceModel of a business model file into the workspace (catalog/business-map/<namespace>/), by the reimport rules.'
      : 'Reads a business model file (APQC PCF, the Refresquito template or an own layout) and says what an import would do. Writes nothing.',
    schema: {
      input: {
        source: z => z.enum(['apqc', 'template', 'own']).describe('apqc, the Refresquito template, or an own layout'),
        file: z => z.string().describe('The uploaded file, a data URL (base64)'),
        fileName: z => z.string().optional(),
        sheet: z => z.union([z.string(), z.number()]).optional().describe('The sheet of an .xlsx, by name or number'),
        namespace: z => z.string().describe('The customer namespace (e.g. occar-a400m)'),
        owner: z => z.string().optional().describe('Owner of the domains and of the processes without one'),
        mapping: z => z.record(z.string()).optional().describe('Column (header name or letter) of id, title, parent, level, owner, criticality, rpo, rto, retention, applications'),
        valueMapping: z => z.object({ criticality: z.record(z.string()).optional() }).optional(),
        keepFrom: z => z.string().optional().describe('A ReferenceModel whose support categories to keep'),
        industry: z => z.string().optional(),
        version: z => z.string().optional(),
        skipErrors: z => z.boolean().optional().describe('Import without the rows that have errors'),
      },
    },
    async handler(ctx) {
      const input = ctx.input as ImportInput;
      const { parsed, planned, warnings } = await prepare(input, deps, await ctx.getInitiatorCredentials(), ctx.user?.ref, write);
      if (!write) {
        ctx.output('counts', planned.counts);
        ctx.output('errors', parsed.errors);
        ctx.output('warnings', warnings);
        ctx.output('changes', planned.changes);
        ctx.logger.info(`business model ${input.namespace}: ${JSON.stringify(planned.counts)}, ${parsed.errors.length} errors, ${warnings.length} warnings`);
        return;
      }
      if (parsed.errors.length && !input.skipErrors) {
        const first = parsed.errors.slice(0, 10).map(e => (e.row ? `row ${e.row}: ${e.message}` : e.message));
        throw new Error(`The file has ${parsed.errors.length} errors (or import skipping them):\n${first.join('\n')}`);
      }
      await writeAll(ctx.workspacePath, planned.files);
      ctx.output('files', planned.files.map(f => f.path));
      ctx.output('referenceModel', planned.referenceModel ?? '');
      ctx.logger.info(`business model ${input.namespace}: wrote ${planned.files.length} files`);
    },
  });
}

export const createPreviewAction = (deps: Deps) => createImportLikeAction(deps, false);
export const createImportAction = (deps: Deps) => createImportLikeAction(deps, true);

export function createAdoptAction(deps: Deps) {
  return createTemplateAction({
    id: 'refresquito:business-model:adopt',
    description: 'Copies level-1 categories of a ReferenceModel (their subdomains and processes) into a customer namespace, keeping apqc.org/pcf-id.',
    schema: {
      input: {
        model: z => z.string().describe('The ReferenceModel (referencemodel:default/<name>)'),
        categories: z => z.array(z.string()).describe('Level-1 IDs (or names) of the categories to adopt'),
        namespace: z => z.string().describe('The customer namespace'),
        owner: z => z.string().describe('Owner group of what is copied'),
      },
    },
    async handler(ctx) {
      const input = ctx.input;
      if (!NAMESPACE.test(input.namespace)) throw new Error(`${input.namespace} is not a namespace (lowercase letters, digits and "-").`);
      const m = await modelFromCatalog(deps.catalog, await ctx.getInitiatorCredentials(), input.model);
      const drafts = copyDrafts(m.entities, input.categories, { owner: input.owner, from: m.ref });
      if (!drafts.length) throw new Error(`None of ${input.categories.join(', ')} is a level-1 category of ${m.ref}.`);
      const current = await currentFiles(deps.config, input.namespace);
      const planned = plan(drafts, current, { namespace: input.namespace, dir: dirOf(input.namespace), today: new Date().toISOString().slice(0, 10) });
      await writeAll(ctx.workspacePath, planned.files);
      ctx.output('files', planned.files.map(f => f.path));
      ctx.output('counts', planned.counts);
      ctx.output('changes', planned.changes);
      ctx.logger.info(`adopted ${input.categories.join(', ')} of ${m.ref} into ${input.namespace}: ${planned.files.length} files`);
    },
  });
}

export const businessMapScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'business-map',
  register(env) {
    env.registerInit({
      deps: { scaffolder: scaffolderActionsExtensionPoint, config: coreServices.rootConfig, catalog: catalogServiceRef },
      async init({ scaffolder, config, catalog }) {
        const deps = { config, catalog };
        scaffolder.addActions(createPreviewAction(deps), createImportAction(deps), createAdoptAction(deps));
      },
    });
  },
});
