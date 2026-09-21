import {
  DataBrief,
  ProcessBrief,
  StoreBrief,
  Validation,
  flowUrnOf,
  jobUrnOf,
  productUrn,
  resolveEndpoint,
  storeUrn,
} from './brief';
import { AssetType } from './urn';

// Turns a VALIDATED brief into the ordered list of aspect writes that register
// it in DataHub. Pure and deterministic: the same brief + runId always yields
// the same proposals (URNs are built in urn.ts), which is what makes a re-run
// an idempotent upsert instead of a duplicate (design §5). Nothing here talks
// to DataHub -- the writer (F2, next) sends these.
//
// NOTE the aspect payloads below follow DataHub's PDL models but are NOT yet
// verified against the live 1.7 OpenAPI v3 endpoint (the batch of live writes
// was refused by the permission classifier). Each shape is exercised in the
// writer's live verification before this is relied on.

export type PlannedType = AssetType | 'dataJob';

export interface PlanContext {
  /** One id per execution, stamped on everything created so a failed run can be undone (§3, §5). */
  runId: string;
  /** Who launched the template (audit: DataHub only ever sees the service account, §7.3). */
  requestedBy: string;
}

export interface Proposal {
  entityType: PlannedType;
  urn: string;
  /** aspectName -> the aspect's `value` payload (the REST envelope is added by the writer). */
  aspects: Record<string, unknown>;
}

const OWNER_TYPES = { business: 'BUSINESS_OWNER', technical: 'TECHNICAL_OWNER', steward: 'DATA_STEWARD' } as const;
/** Written with every proposal so re-registering an asset that a rollback soft-deleted brings it back. */
const LIVE = { removed: false };
const PII_TAGS = ['urn:li:tag:pii', 'urn:li:tag:gdpr'];
const PERSONAL_TERM = 'urn:li:glossaryTerm:personal-data';
const SUBTYPE: Record<StoreBrief['kind'], string> = { postgres: 'Table', kafka: 'Topic', s3: 'Prefix', 'alfresco-site': 'Site' };

function marker(brief: DataBrief, ctx: PlanContext): Record<string, string> {
  return {
    managedBy: 'backstage',
    ...(brief.backstageEntity ? { backstageEntity: brief.backstageEntity } : {}),
    runId: ctx.runId,
    requestedBy: ctx.requestedBy,
  };
}

function owners(brief: DataBrief) {
  const list: Array<{ owner: string; type: string }> = [
    { owner: brief.businessOwner, type: OWNER_TYPES.business },
    { owner: brief.technicalOwner, type: OWNER_TYPES.technical },
  ];
  if (brief.steward) list.push({ owner: brief.steward, type: OWNER_TYPES.steward });
  return { owners: list };
}

const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];

function structuredValues(s: StoreBrief, lawfulBasisAllowed: boolean) {
  const props: Array<{ propertyUrn: string; values: Array<Record<string, string | number>> }> = [
    { propertyUrn: 'urn:li:structuredProperty:refresquito.data_classification', values: [{ string: s.classification }] },
    { propertyUrn: 'urn:li:structuredProperty:refresquito.retention_days', values: [{ double: s.retentionDays }] },
  ];
  if (s.lawfulBasis && lawfulBasisAllowed) {
    props.push({ propertyUrn: 'urn:li:structuredProperty:refresquito.lawful_basis', values: [{ string: s.lawfulBasis }] });
  }
  if (s.freshnessSlaHours !== undefined) {
    props.push({ propertyUrn: 'urn:li:structuredProperty:refresquito.freshness_sla_hours', values: [{ double: s.freshnessSlaHours }] });
  }
  return { properties: props };
}

function platformUrnOf(datasetUrnValue: string): string {
  const m = /dataPlatform:([^,]+),/.exec(datasetUrnValue);
  if (!m) throw new Error(`Not a dataset URN: ${datasetUrnValue}`);
  return `urn:li:dataPlatform:${m[1]}`;
}

function datasetProposal(brief: DataBrief, s: StoreBrief, ctx: PlanContext): Proposal {
  const urn = storeUrn(s);
  const hasPersonal = (s.columns ?? []).some(c => c.personal);
  const terms = uniq([...(brief.terms ?? []), ...(hasPersonal ? [PERSONAL_TERM] : [])]);
  const aspects: Record<string, unknown> = {
    datasetProperties: {
      name: s.kind === 'postgres' ? (s.table as string) : (s.name as string),
      ...(s.description ? { description: s.description } : {}),
      customProperties: marker(brief, ctx),
    },
    subTypes: { typeNames: [SUBTYPE[s.kind]] },
    domains: { domains: [brief.domain] },
    ownership: owners(brief),
    structuredProperties: structuredValues(s, true),
  };
  if (brief.tags?.length) aspects.globalTags = { tags: brief.tags.map(tag => ({ tag })) };
  if (terms.length) aspects.glossaryTerms = { terms: terms.map(urnOfTerm => ({ urn: urnOfTerm })), auditStamp: { time: 0, actor: 'urn:li:corpuser:datahub' } };
  if (s.columns?.length) {
    // Skeleton of the columns (the ingestion will later REPLACE schemaMetadata) ...
    aspects.schemaMetadata = {
      schemaName: s.kind === 'postgres' ? (s.table as string) : (s.name as string),
      platform: platformUrnOf(urn),
      version: 0,
      hash: '',
      platformSchema: { 'com.linkedin.schema.OtherSchema': { rawSchema: '' } },
      fields: s.columns.map(c => ({
        fieldPath: c.name,
        nativeDataType: c.type,
        type: { type: { 'com.linkedin.schema.StringType': {} } },
        ...(c.description ? { description: c.description } : {}),
      })),
    };
    // ... so descriptions and PII tags go in the EDITABLE aspect, which ingestion does not overwrite (§5.1).
    aspects.editableSchemaMetadata = {
      editableSchemaFieldInfo: s.columns
        .filter(c => c.description || c.personal)
        .map(c => ({
          fieldPath: c.name,
          ...(c.description ? { description: c.description } : {}),
          ...(c.personal ? { globalTags: { tags: PII_TAGS.map(tag => ({ tag })) } } : {}),
        })),
    };
  }
  return { entityType: 'dataset', urn, aspects: { ...aspects, status: LIVE } };
}

function flowProposals(brief: DataBrief, p: ProcessBrief, ctx: PlanContext): Proposal[] {
  const flow: Proposal = {
    entityType: 'dataFlow',
    urn: flowUrnOf(p),
    aspects: {
      dataFlowInfo: { name: p.name, customProperties: marker(brief, ctx) },
      status: LIVE,
      domains: { domains: [brief.domain] },
      ownership: owners(brief),
    },
  };
  const jobs: Proposal[] = p.tasks.map(t => {
    const ins = (t.reads ?? []).map(e => resolveEndpoint(brief, e)!.urn);
    const outs = (t.writes ?? []).map(e => resolveEndpoint(brief, e)!.urn);
    return {
      entityType: 'dataJob' as const,
      urn: jobUrnOf(p, t),
      aspects: {
        dataJobInfo: { name: t.name, type: { string: 'BACKSTAGE' }, customProperties: marker(brief, ctx) },
        status: LIVE,
        // The inputs/outputs of the jobs ARE the planned lineage (design §4.3).
        dataJobInputOutput: { inputDatasets: uniq(ins), outputDatasets: uniq(outs) },
        domains: { domains: [brief.domain] },
        ownership: owners(brief),
      },
    };
  });
  return [flow, ...jobs];
}

/**
 * Ordered so every referenced entity exists before something points at it:
 * datasets, then flows and their jobs, and the product LAST (it lists them as
 * assets). Undo walks it in reverse (undoOrder).
 */
export function buildPlan(brief: DataBrief, validation: Pick<Validation, 'errors' | 'personalData'>, ctx: PlanContext): Proposal[] {
  if (validation.errors.length > 0) {
    throw new Error(`Refusing to plan an invalid brief: ${validation.errors.join('; ')}`);
  }
  const datasets = brief.stores.map(s => datasetProposal(brief, s, ctx));
  const flows = (brief.processes ?? []).flatMap(p => flowProposals(brief, p, ctx));

  const links = [
    ...(brief.links ?? []),
    ...(brief.backstageEntity ? [{ url: `entity:${brief.backstageEntity}`, description: 'Backstage' }] : []),
  ];
  const product: Proposal = {
    entityType: 'dataProduct',
    urn: productUrn(brief),
    aspects: {
      dataProductProperties: {
        name: brief.name,
        description: brief.description,
        customProperties: marker(brief, ctx),
        assets: [...datasets, ...flows.filter(f => f.entityType === 'dataFlow')].map(a => ({ destinationUrn: a.urn })),
      },
      domains: { domains: [brief.domain] },
      ownership: owners(brief),
      status: LIVE,
      ...(brief.tags?.length ? { globalTags: { tags: brief.tags.map(tag => ({ tag })) } } : {}),
      ...(brief.terms?.length ? { glossaryTerms: { terms: brief.terms.map(t => ({ urn: t })), auditStamp: { time: 0, actor: 'urn:li:corpuser:datahub' } } } : {}),
      ...(links.length
        ? {
            institutionalMemory: {
              elements: links.map(l => ({ url: l.url, description: l.description, createStamp: { time: 0, actor: 'urn:li:corpuser:datahub' } })),
            },
          }
        : {}),
    },
  };
  return [...datasets, ...flows, product];
}

/** URNs to delete, most-dependent first, when a run fails half way (only what THIS run created). */
export function undoOrder(plan: Proposal[]): string[] {
  return [...plan].reverse().map(p => p.urn);
}
