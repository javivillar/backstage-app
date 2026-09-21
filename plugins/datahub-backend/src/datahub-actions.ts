import { randomUUID } from 'crypto';
import { Config } from '@backstage/config';
import { UserInfoService } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { DataBrief } from './brief';
import { datahubSettings } from './datahubClient';
import { callerFrom, requireWriteAccess } from './datahubAuthz';
import { assetUrl } from './governance';
import { deprecateAsset, extendProduct, registerBrief } from './register';

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
