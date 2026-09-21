import { randomUUID } from 'crypto';
import { Config } from '@backstage/config';
import { UserInfoService } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { DataBrief } from './brief';
import { datahubSettings } from './datahubClient';
import { callerFrom, requireWriteAccess } from './datahubAuthz';
import { assetUrl } from './governance';
import { deprecateAsset, extendProduct, registerBrief } from './register';
import { datahubQuery } from './datahubClient';
import { RawImpactResult, impactHeadline, summarizeImpact } from './impact';
import { Q_IMPACT } from './queries';
import { getUserEmail } from './keycloakLookup';
import { requireDatahubAccess } from './datahubAuthz';
import { assetTypeOf } from './urn';
import { VocabularyRequestError, VocabularyRequest, requestVocabulary } from './vocabularyRequest';

// Scaffolder actions of the DataHub write path (F2). Every one re-checks who is
// asking: the plugin writes with ONE service-account token, so DataHub cannot
// tell users apart -- the per-user rule is datahubAuthz.canWrite.

interface ActionOptions {
  config: Config;
  userInfo: UserInfoService;
}

function settingsOrThrow(config: Config) {
  const s = datahubSettings(config);
  if (!s) throw new Error('The DataHub integration is not configured (datahub.baseUrl / datahub.token).');
  return s;
}

const RESULT_OUTPUT = {
  type: 'object',
  properties: {
    productUrn: { type: 'string' },
    productUrl: { type: 'string' },
    created: { type: 'array', items: { type: 'string' } },
    updated: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    dryRun: { type: 'boolean' },
  },
} as const;

interface RegisterInput {
  brief: DataBrief;
  dryRun?: boolean;
}

export function registerDataProductAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<RegisterInput>({
    id: 'datahub:register-data-product',
    description: 'Registers a data product and its datasets, flows and planned lineage in DataHub (idempotent).',
    schema: {
      input: { type: 'object', required: ['brief'], properties: { brief: { type: 'object' }, dryRun: { type: 'boolean' } } },
      output: RESULT_OUTPUT,
    },
    async handler(ctx) {
      const s = settingsOrThrow(config);
      const caller = await callerFrom(await ctx.getInitiatorCredentials(), userInfo);
      const runId = (ctx as { task?: { id?: string } }).task?.id ?? randomUUID();
      const res = await registerBrief(s, ctx.input.brief, {
        ctx: { runId, requestedBy: caller.entityRef },
        callerEmail: (await requireWriteAccess(config, caller, s, undefined)).email,
        dryRun: ctx.input.dryRun,
        authorize: async owners => {
          await requireWriteAccess(config, caller, s, owners);
        },
      });
      ctx.logger.info(`datahub:register-data-product user=${caller.entityRef} run=${runId} created=${res.created.length} updated=${res.updated.length} dryRun=${res.dryRun}`);
      ctx.output('productUrn', res.productUrn);
      ctx.output('productUrl', assetUrl(s.publicUrl, 'dataProduct', res.productUrn));
      ctx.output('created', res.created);
      ctx.output('updated', res.updated);
      ctx.output('warnings', res.warnings);
      ctx.output('dryRun', res.dryRun);
    },
  });
}

interface RegisterAssetInput {
  productSlug: string;
  stores: DataBrief['stores'];
  processes?: DataBrief['processes'];
  dryRun?: boolean;
}

export function registerAssetAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<RegisterAssetInput>({
    id: 'datahub:register-asset',
    description: 'Adds stores / processes to a data product Backstage already manages (only the asset list of the product is merged).',
    schema: {
      input: {
        type: 'object',
        required: ['productSlug', 'stores'],
        properties: { productSlug: { type: 'string' }, stores: { type: 'array' }, processes: { type: 'array' }, dryRun: { type: 'boolean' } },
      },
      output: RESULT_OUTPUT,
    },
    async handler(ctx) {
      const s = settingsOrThrow(config);
      const caller = await callerFrom(await ctx.getInitiatorCredentials(), userInfo);
      const runId = (ctx as { task?: { id?: string } }).task?.id ?? randomUUID();
      const { email } = await requireWriteAccess(config, caller, s, undefined);
      const res = await extendProduct(
        s,
        ctx.input.productSlug,
        { stores: ctx.input.stores, processes: ctx.input.processes },
        {
          ctx: { runId, requestedBy: caller.entityRef },
          callerEmail: email,
          dryRun: ctx.input.dryRun,
          authorize: async owners => {
            await requireWriteAccess(config, caller, s, owners);
          },
        },
      );
      ctx.logger.info(`datahub:register-asset user=${caller.entityRef} run=${runId} product=${res.productUrn} created=${res.created.length}`);
      ctx.output('productUrn', res.productUrn);
      ctx.output('productUrl', assetUrl(s.publicUrl, 'dataProduct', res.productUrn));
      ctx.output('created', res.created);
      ctx.output('updated', res.updated);
      ctx.output('warnings', res.warnings);
      ctx.output('dryRun', res.dryRun);
    },
  });
}

interface DeprecateInput {
  urn: string;
  note: string;
  deprecated?: boolean;
}

export function deprecateAssetAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<DeprecateInput>({
    id: 'datahub:deprecate',
    description: 'Marks (or unmarks) an asset that Backstage manages as deprecated.',
    schema: {
      input: { type: 'object', required: ['urn', 'note'], properties: { urn: { type: 'string' }, note: { type: 'string' }, deprecated: { type: 'boolean' } } },
    },
    async handler(ctx) {
      const s = settingsOrThrow(config);
      const caller = await callerFrom(await ctx.getInitiatorCredentials(), userInfo);
      const { email } = await requireWriteAccess(config, caller, s, undefined);
      await deprecateAsset(s, ctx.input.urn, ctx.input.note, {
        actorEmail: email,
        deprecated: ctx.input.deprecated,
        authorize: async owners => {
          await requireWriteAccess(config, caller, s, owners);
        },
      });
      ctx.logger.info(`datahub:deprecate user=${caller.entityRef} urn=${ctx.input.urn} deprecated=${ctx.input.deprecated ?? true}`);
    },
  });
}

interface CheckImpactInput {
  urn: string;
}

/** Read-only: who/what is downstream of an asset. Meant for a "before you change this schema" template. */
export function checkImpactAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<CheckImpactInput>({
    id: 'datahub:check-impact',
    description: 'Lists the assets downstream of a dataset (DataHub lineage) and the owners to notify. Read-only.',
    schema: {
      input: { type: 'object', required: ['urn'], properties: { urn: { type: 'string' } } },
      output: {
        type: 'object',
        properties: {
          total: { type: 'number' },
          critical: { type: 'number' },
          owners: { type: 'array', items: { type: 'string' } },
          headline: { type: 'string' },
          items: { type: 'array' },
        },
      },
    },
    async handler(ctx) {
      const s = settingsOrThrow(config);
      const caller = await callerFrom(await ctx.getInitiatorCredentials(), userInfo);
      await requireDatahubAccess(config, caller, s.accessGroups);
      if (!assetTypeOf(ctx.input.urn)) throw new Error('urn must be a dataset, dataProduct or dataFlow URN');
      const data = await datahubQuery<{ searchAcrossLineage: RawImpactResult }>(s, Q_IMPACT, { urn: ctx.input.urn, count: 100 });
      const impact = summarizeImpact(ctx.input.urn, data.searchAcrossLineage);
      ctx.logger.info(`datahub:check-impact user=${caller.entityRef} urn=${ctx.input.urn} total=${impact.total}`);
      ctx.output('total', impact.total);
      ctx.output('critical', impact.critical);
      ctx.output('owners', impact.owners);
      ctx.output('headline', impactHeadline(impact));
      ctx.output('items', impact.items);
    },
  });
}

interface RequestVocabularyInput extends VocabularyRequest {
  dryRun?: boolean;
}

/** Files a request for vocabulary that does not exist (a GitHub issue for the stewards). Open to every DataHub user. */
export function requestVocabularyAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<RequestVocabularyInput>({
    id: 'datahub:request-vocabulary',
    description: 'Asks the data stewards for a domain, glossary term, tag or allowed value that does not exist yet.',
    schema: {
      input: {
        type: 'object',
        required: ['kind', 'name', 'description', 'justification'],
        properties: {
          kind: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          justification: { type: 'string' },
          property: { type: 'string' },
          relatedProduct: { type: 'string' },
          dryRun: { type: 'boolean' },
        },
      },
      output: {
        type: 'object',
        properties: { issueUrl: { type: 'string' }, alreadyRequested: { type: 'boolean' }, title: { type: 'string' }, dryRun: { type: 'boolean' } },
      },
    },
    async handler(ctx) {
      const s = settingsOrThrow(config);
      const caller = await callerFrom(await ctx.getInitiatorCredentials(), userInfo);
      await requireDatahubAccess(config, caller, s.accessGroups);
      const email = await getUserEmail(config, caller.username);
      const { dryRun, ...req } = ctx.input;
      let res;
      try {
        res = await requestVocabulary(config, s, req, { entityRef: caller.entityRef, email }, !!dryRun);
      } catch (e) {
        if (e instanceof VocabularyRequestError) throw new Error(e.message);
        throw e;
      }
      ctx.logger.info(`datahub:request-vocabulary user=${caller.entityRef} kind=${req.kind} name=${req.name} dryRun=${res.dryRun} duplicate=${res.alreadyRequested}`);
      ctx.output('title', res.title);
      ctx.output('dryRun', res.dryRun);
      ctx.output('alreadyRequested', res.alreadyRequested);
      if (res.issueUrl) ctx.output('issueUrl', res.issueUrl);
    },
  });
}
