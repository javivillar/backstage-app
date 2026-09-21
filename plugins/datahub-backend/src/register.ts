import { CLASSIFICATION_ORDER, DataBrief, Vocabulary, normalizeBrief, productUrn, validateBrief } from './brief';
import { DatahubError, DatahubSettings, datahubQuery } from './datahubClient';
import { getAspect, softDeleteEntity, upsertProposal } from './datahubWriter';
import { PlanContext, PlannedType, Proposal, buildPlan } from './plan';
import { Q_EXISTS, Q_PRODUCT_CORE } from './queries';
import { loadVocabulary } from './vocabulary';
import { assetTypeOf } from './urn';

// Orchestrates a registration: validate -> plan -> PREFLIGHT (never touch what
// Backstage did not create) -> write in dependency order -> undo THIS run's
// creations if something fails (BACKSTAGE-DATAHUB-DESIGN.md §5).

export class BriefError extends Error {
  constructor(readonly errors: string[]) {
    super(`The data brief is not valid:\n - ${errors.join('\n - ')}`);
  }
}
export class ConflictError extends Error {}

export interface RegisterOptions {
  ctx: PlanContext;
  /** Launcher's email: default technical owner. */
  callerEmail: string;
  /** Validate and plan, write nothing. */
  dryRun?: boolean;
  /** How long to wait before checking whether a timed-out write landed anyway (default 5000 ms). */
  settleMs?: number;
  /**
   * Called ONCE with the owners of the product if it already exists (undefined if it is new);
   * throws to refuse. This is where the per-user authorization plugs in.
   */
  authorize: (existingProductOwners: string[] | undefined) => Promise<void>;
}

export interface RegisterResult {
  runId: string;
  dryRun: boolean;
  productUrn: string;
  created: string[];
  updated: string[];
  warnings: string[];
}

interface Inspect {
  exists: boolean;
  managed: boolean;
}

const customProp = (props: Array<{ key: string; value?: string | null }> | null | undefined, key: string) =>
  props?.find(p => p.key === key)?.value ?? undefined;

async function inspect(s: DatahubSettings, type: PlannedType, urn: string): Promise<Inspect> {
  const key = type;
  const data = await datahubQuery<Record<string, { exists?: boolean; properties?: { customProperties?: Array<{ key: string; value?: string }> } } | null>>(
    s,
    Q_EXISTS[type],
    { urn },
  );
  const e = data[key];
  if (!e || e.exists === false) return { exists: false, managed: false };
  return { exists: true, managed: customProp(e.properties?.customProperties, 'managedBy') === 'backstage' };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Undoes what THIS run created. `attempted` is every proposal that was written OK plus, if a write
 * failed, that one too: after a timeout DataHub may have applied it anyway (seen live), so it is
 * checked and soft-deleted if it is there. Pre-existing (updated) assets are never touched.
 */
async function undo(s: DatahubSettings, attempted: Proposal[], created: string[], outcomeUnknown: boolean, settleMs = 5000): Promise<string[]> {
  if (outcomeUnknown) await sleep(settleMs); // let an in-flight write land before looking
  const failed: string[] = [];
  for (const p of [...attempted].reverse()) {
    if (!created.includes(p.urn)) continue;
    try {
      if (!(await inspect(s, p.entityType, p.urn)).exists) continue;
      await softDeleteEntity(s, p.entityType, p.urn);
    } catch {
      failed.push(p.urn);
    }
  }
  return failed;
}

const rollbackTail = (failed: string[]): string =>
  failed.length
    ? ` Rollback could NOT hide: ${failed.join(', ')} (ask a steward).`
    : ' Everything this run created was soft-deleted (hidden; a steward can remove it for good).';

/** Defaults the launcher expects: they are the technical owner; a steward is filled in from Confidential up (§12.3). */
export function applyDefaults(brief: DataBrief, s: Pick<DatahubSettings, 'defaultSteward'>, callerEmail: string): DataBrief {
  const b: DataBrief = { ...brief };
  if (!b.technicalOwner) b.technicalOwner = `urn:li:corpuser:${callerEmail}`;
  const max = Math.max(-1, ...b.stores.map(x => CLASSIFICATION_ORDER.indexOf(x.classification)));
  if (!b.steward && max >= CLASSIFICATION_ORDER.indexOf('Confidential')) b.steward = s.defaultSteward;
  return b;
}

async function existingProductOwners(s: DatahubSettings, urn: string): Promise<string[] | undefined> {
  const d = await datahubQuery<{ dataProduct: { exists?: boolean; ownership?: { owners?: Array<{ owner?: { urn: string } }> } } | null }>(
    s,
    Q_PRODUCT_CORE,
    { urn },
  );
  if (!d.dataProduct || d.dataProduct.exists === false) return undefined;
  return (d.dataProduct.ownership?.owners ?? []).map(o => o.owner?.urn).filter((u): u is string => !!u);
}

export async function registerBrief(s: DatahubSettings, rawBrief: DataBrief, opts: RegisterOptions): Promise<RegisterResult> {
  const brief = applyDefaults(normalizeBrief(rawBrief), s, opts.callerEmail);
  const vocab: Vocabulary = await loadVocabulary(s);
  const validation = validateBrief(brief, vocab);
  if (validation.errors.length > 0) throw new BriefError(validation.errors);
  const plan = buildPlan(brief, validation, opts.ctx);
  const pUrn = productUrn(brief);

  // Preflight: what exists, and is it ours? Anything that exists and was NOT
  // created by Backstage is somebody else's asset: refuse rather than overwrite.
  const created: string[] = [];
  const updated: string[] = [];
  for (const p of plan) {
    const st = await inspect(s, p.entityType, p.urn);
    if (st.exists && !st.managed) {
      throw new ConflictError(`${p.urn} already exists in DataHub and was not created by Backstage: it will not be touched. Register it as a NEW name or ask a steward.`);
    }
    (st.exists ? updated : created).push(p.urn);
  }

  await opts.authorize(await existingProductOwners(s, pUrn));

  if (opts.dryRun) return { runId: opts.ctx.runId, dryRun: true, productUrn: pUrn, created, updated, warnings: validation.warnings };

  const done: Proposal[] = [];
  let inFlight: Proposal | undefined;
  try {
    for (const p of plan) {
      inFlight = p;
      await upsertProposal(s, p);
      done.push(p);
      inFlight = undefined;
    }
  } catch (e) {
    const failed = await undo(s, inFlight ? [...done, inFlight] : done, created, !!inFlight, opts.settleMs);
    throw new DatahubError(`${(e as Error).message}${rollbackTail(failed)}`, e instanceof DatahubError ? e.status : 502);
  }
  return { runId: opts.ctx.runId, dryRun: false, productUrn: pUrn, created, updated, warnings: validation.warnings };
}

/** Marks/unmarks an asset Backstage manages as deprecated. Refuses anything Backstage did not create. */
export async function deprecateAsset(
  s: DatahubSettings,
  urn: string,
  note: string,
  opts: { actorEmail: string; deprecated?: boolean; authorize: (owners: string[] | undefined) => Promise<void> },
): Promise<void> {
  const type = assetTypeOf(urn);
  if (!type) throw new BriefError(['urn must be a dataset, dataProduct or dataFlow URN']);
  const st = await inspect(s, type, urn);
  if (!st.exists) throw new ConflictError(`No such asset in DataHub: ${urn}`);
  if (!st.managed) throw new ConflictError(`${urn} was not created by Backstage: only a steward can deprecate it in DataHub.`);
  await opts.authorize(await ownersOf(s, type, urn));
  await upsertProposal(s, {
    entityType: type,
    urn,
    aspects: { deprecation: { deprecated: opts.deprecated ?? true, note, actor: `urn:li:corpuser:${opts.actorEmail}` } },
  });
}

async function ownersOf(s: DatahubSettings, type: PlannedType, urn: string): Promise<string[] | undefined> {
  const v = await getAspect<{ owners?: Array<{ owner: string }> }>(s, type, urn, 'ownership');
  return v?.owners?.map(o => o.owner);
}

/**
 * Adds stores/processes to a product Backstage already manages. Only the
 * product's asset list is merged (union with what is there); nothing else of
 * the product is rewritten, so links/terms others added survive.
 */
export async function extendProduct(
  s: DatahubSettings,
  slug: string,
  additions: Pick<DataBrief, 'stores'> & Partial<Pick<DataBrief, 'processes'>>,
  opts: RegisterOptions,
): Promise<RegisterResult> {
  const pUrn = productUrn({ slug } as DataBrief);
  const core = await datahubQuery<{
    dataProduct: {
      exists?: boolean;
      properties?: { name?: string; description?: string; customProperties?: Array<{ key: string; value?: string }> };
      domain?: { domain?: { urn: string } };
      ownership?: { owners?: Array<{ ownershipType?: { urn: string }; owner?: { urn: string } }> };
      glossaryTerms?: { terms?: Array<{ term: { urn: string } }> };
      tags?: { tags?: Array<{ tag: { urn: string } }> };
    } | null;
  }>(s, Q_PRODUCT_CORE, { urn: pUrn });
  const p = core.dataProduct;
  if (!p || p.exists === false) throw new ConflictError(`No such data product: ${pUrn}`);
  if (customProp(p.properties?.customProperties, 'managedBy') !== 'backstage') {
    throw new ConflictError(`${pUrn} was not created by Backstage: it will not be touched.`);
  }
  const ownerOfType = (t: string) => p.ownership?.owners?.find(o => o.ownershipType?.urn.endsWith(t))?.owner?.urn;
  const brief: DataBrief = {
    slug,
    name: p.properties?.name ?? slug,
    description: p.properties?.description ?? slug,
    domain: p.domain?.domain?.urn ?? '',
    businessOwner: ownerOfType('business_owner') ?? '',
    technicalOwner: ownerOfType('technical_owner') ?? '',
    steward: ownerOfType('data_steward'),
    terms: p.glossaryTerms?.terms?.map(t => t.term.urn),
    tags: p.tags?.tags?.map(t => t.tag.urn),
    stores: additions.stores,
    processes: additions.processes,
    backstageEntity: customProp(p.properties?.customProperties, 'backstageEntity'),
  };
  const b = applyDefaults(normalizeBrief(brief), s, opts.callerEmail);
  const validation = validateBrief(b, await loadVocabulary(s));
  if (validation.errors.length > 0) throw new BriefError(validation.errors);
  const plan = buildPlan(b, validation, opts.ctx);
  const newAssets = plan.filter(x => x.entityType !== 'dataProduct');

  const created: string[] = [];
  const updated: string[] = [];
  for (const a of newAssets) {
    const st = await inspect(s, a.entityType, a.urn);
    if (st.exists && !st.managed) throw new ConflictError(`${a.urn} already exists in DataHub and was not created by Backstage: it will not be touched.`);
    (st.exists ? updated : created).push(a.urn);
  }
  await opts.authorize(p.ownership?.owners?.map(o => o.owner?.urn).filter((u): u is string => !!u));
  if (opts.dryRun) return { runId: opts.ctx.runId, dryRun: true, productUrn: pUrn, created, updated, warnings: validation.warnings };

  const current = await getAspect<{ assets?: Array<{ destinationUrn: string; outputPort?: boolean }> } & Record<string, unknown>>(s, 'dataProduct', pUrn, 'dataProductProperties');
  const have = current?.assets ?? [];
  const union = [...have, ...newAssets.filter(a => a.entityType !== 'dataJob').map(a => ({ destinationUrn: a.urn })).filter(a => !have.some(h => h.destinationUrn === a.destinationUrn))];

  const done: Proposal[] = [];
  let inFlight: Proposal | undefined;
  try {
    for (const a of newAssets) {
      inFlight = a;
      await upsertProposal(s, a);
      done.push(a);
      inFlight = undefined;
    }
    await upsertProposal(s, { entityType: 'dataProduct', urn: pUrn, aspects: { dataProductProperties: { ...(current ?? { name: brief.name }), assets: union } } });
  } catch (e) {
    const failed = await undo(s, inFlight ? [...done, inFlight] : done, created, !!inFlight, opts.settleMs);
    throw new DatahubError(`${(e as Error).message}${rollbackTail(failed)}`, e instanceof DatahubError ? e.status : 502);
  }
  return { runId: opts.ctx.runId, dryRun: false, productUrn: pUrn, created, updated, warnings: validation.warnings };
}
