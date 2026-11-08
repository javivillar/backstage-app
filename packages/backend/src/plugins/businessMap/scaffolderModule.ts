import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { createTemplateAction, scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { copyDrafts, type CurrentFile, plan } from './importModel';
import { GitHubFiles } from '../clusterVms';
import { currentFiles, dirOf, type ImportDeps, type ImportInput, modelFromCatalog, NAMESPACE, prepare, previewOf } from './prepareImport';

/**
 * Scaffolder actions of the business map (the templates Import business model and Adopt reference model):
 *   refresquito:business-model:preview  what an import would do, without writing anything
 *   refresquito:business-model:import   writes catalog/business-map/<namespace>/*.yaml into the workspace
 *   refresquito:business-model:adopt    copies level-1 categories of a ReferenceModel into a customer namespace
 *   refresquito:business-model:pull-request  the files written, as ONE commit and a pull request on refresquito-services
 * (publish:github:pull-request makes a request per file, too slow for thousands of entities). The current files
 * of the namespace are read from its main branch (the GitHub token of the backend) for the reimport rules. What they read
 * and plan is prepareImport.ts, shared with the route POST /api/business-map/import/preview (previewRouter.ts).
 */

type Deps = ImportDeps;

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
        source: z => z.enum(['apqc', 'template', 'own', 'bia']).describe('apqc, the Refresquito template, an own layout, or bia (the filled sheet of a business impact analysis: updates only)'),
        file: z => z.string().describe('The uploaded file, a data URL (base64)'),
        fileName: z => z.string().optional(),
        sheet: z => z.union([z.string(), z.number()]).optional().describe('The sheet of an .xlsx, by name or number'),
        namespace: z => z.string().describe('The customer namespace (e.g. occar-a400m)'),
        owner: z => z.string().optional().describe('Owner of the domains and of the processes without one'),
        mapping: z => z.record(z.string()).optional().describe('Column (header name or letter) of id, title, description, parent, level, owner, criticality, rpo, rto, retention, applications'),
        valueMapping: z => z.object({ criticality: z.record(z.string()).optional() }).optional(),
        keepFrom: z => z.string().optional().describe('A ReferenceModel whose support categories to keep'),
        industry: z => z.string().optional(),
        version: z => z.string().optional(),
        skipErrors: z => z.boolean().optional().describe('Import without the rows that have errors'),
      },
    },
    async handler(ctx) {
      const input = ctx.input as ImportInput;
      if (!write) {
        const p = await previewOf(input, deps, await ctx.getInitiatorCredentials(), ctx.user?.ref);
        ctx.output('counts', p.counts);
        ctx.output('errors', p.errors);
        ctx.output('warnings', p.warnings);
        ctx.output('changes', p.changes);
        ctx.logger.info(`business model ${input.namespace}: ${JSON.stringify(p.counts)}, ${p.errors.length} errors, ${p.warnings.length} warnings`);
        return;
      }
      const { parsed, planned } = await prepare(input, deps, await ctx.getInitiatorCredentials(), ctx.user?.ref, true);
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
    description: 'Copies level-1 categories of a ReferenceModel (their subdomains, processes and sub-processes) into a customer namespace, keeping apqc.org/pcf-id.',
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

/** The pull request of what import or adopt wrote: every file of catalog/business-map/<namespace>/ in one commit. */
export function createPullRequestAction(deps: Deps) {
  return createTemplateAction({
    id: 'refresquito:business-model:pull-request',
    description: 'Opens a pull request on refresquito-services with the files of catalog/business-map/<namespace>/ of the workspace, in one commit.',
    schema: {
      input: {
        namespace: z => z.string().describe('The customer namespace'),
        branchName: z => z.string().describe('Prefix of the branch (a suffix makes it unique)'),
        title: z => z.string(),
        description: z => z.string().optional(),
      },
      output: {
        remoteUrl: z => z.string(),
        pullRequestNumber: z => z.number(),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      if (!NAMESPACE.test(input.namespace)) throw new Error(`${input.namespace} is not a namespace (lowercase letters, digits and "-").`);
      const dir = dirOf(input.namespace);
      const names = (await readdir(join(ctx.workspacePath, dir))).filter(n => /\.ya?ml$/.test(n));
      if (!names.length) throw new Error(`Nothing written in ${dir}: nothing to propose.`);
      const changes = await Promise.all(names.map(async n => ({ path: `${dir}/${n}`, text: await readFile(join(ctx.workspacePath, dir, n), 'utf8') })));
      const token = deps.config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token');
      const repo = deps.config.getOptionalString('businessMap.repo') ?? deps.config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services';
      const gh = new GitHubFiles(repo, deps.config.getOptionalString('businessMap.branch') ?? 'main', token);
      const branch = `${input.branchName.replace(/[^A-Za-z0-9._/-]/g, '-')}-${Date.now().toString(36)}`;
      ctx.logger.info(`business model ${input.namespace}: ${changes.length} files in one commit on ${repo} ${branch}`);
      const pr = await gh.pullRequestInOneCommit(branch, input.title, input.description ?? '', changes);
      ctx.output('remoteUrl', pr.url);
      ctx.output('pullRequestNumber', pr.number);
      ctx.logger.info(`business model ${input.namespace}: pull request #${pr.number} ${pr.url}`);
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
        scaffolder.addActions(createPreviewAction(deps), createImportAction(deps), createAdoptAction(deps), createPullRequestAction(deps));
      },
    });
  },
});
