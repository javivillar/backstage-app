import { Env, assetTypeOf, dataFlowUrn, dataJobUrn, dataProductUrn, datasetUrn, postgresDatasetUrn } from './urn';

// The "data brief": what a developer declares BEFORE writing code
// (BACKSTAGE-DATAHUB-DESIGN.md §4). This module is pure -- it only validates
// the brief against the vocabulary DataHub already has (never creates any,
// §9) and derives the URNs. Nothing here talks to DataHub.

export type Classification = 'Public' | 'Internal' | 'Confidential' | 'Restricted';
export const CLASSIFICATION_ORDER: Classification[] = ['Public', 'Internal', 'Confidential', 'Restricted'];

export type StoreKind = 'postgres' | 'kafka' | 's3' | 'alfresco-site';
export type FlowEngine = 'camunda' | 'argo' | 'activepieces';

export interface ColumnBrief {
  name: string;
  type: string;
  description?: string;
  /** Marked by the developer as personal data (§4.2 makes lawful basis etc. mandatory). */
  personal?: boolean;
}

export interface StoreBrief {
  kind: StoreKind;
  /** postgres: database, schema, table. Others: `name` (topic / bucket/prefix / site shortName). */
  database?: string;
  schema?: string;
  table?: string;
  name?: string;
  description?: string;
  columns?: ColumnBrief[];
  classification: Classification;
  retentionDays: number;
  lawfulBasis?: string;
  freshnessSlaHours?: number;
  env?: Env;
}

export interface TaskBrief {
  id: string;
  name: string;
  /** Dataset URNs, or the `ref` of a store of this same brief (see storeRef). */
  reads?: string[];
  writes?: string[];
}

export interface ProcessBrief {
  engine: FlowEngine;
  id: string;
  name: string;
  tasks: TaskBrief[];
}

export interface DataBrief {
  slug: string;
  name: string;
  description: string;
  /** All of these are URNs of things that must ALREADY exist in DataHub / Keycloak. */
  domain: string;
  businessOwner: string;
  technicalOwner: string;
  steward?: string;
  stores: StoreBrief[];
  processes?: ProcessBrief[];
  terms?: string[];
  tags?: string[];
  links?: Array<{ url: string; description: string }>;
  /** Backstage entity ref that owns this brief, e.g. component:default/pedidos-web. */
  backstageEntity?: string;
}

/** What DataHub already has (from GET /vocabulary). The brief may only pick from it. */
export interface Vocabulary {
  domains: Array<{ urn: string }>;
  glossaryTerms: Array<{ urn: string }>;
  tags: Array<{ urn: string }>;
  structuredProperties: Array<{ qualifiedName: string; allowedValues: Array<string | number | undefined> }>;
}

export interface Validation {
  errors: string[];
  warnings: string[];
  personalData: boolean;
  /** Highest classification among the stores (drives the steward rule). */
  maxClassification?: Classification;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PERSONAL_TERM = 'urn:li:glossaryTerm:personal-data';
const OWNER_URN = /^urn:li:(corpuser|corpGroup):[^\s]+$/;

/** The stable handle other parts of the brief use to point at one of its stores. */
export function storeRef(s: StoreBrief): string {
  if (s.kind === 'postgres') return `postgres:${s.database}.${s.schema}.${s.table}`;
  return `${s.kind}:${s.name}`;
}

export function storeUrn(s: StoreBrief): string {
  const env = s.env ?? 'PROD';
  switch (s.kind) {
    case 'postgres':
      return postgresDatasetUrn(s.database ?? '', s.schema ?? '', s.table ?? '', env);
    case 'kafka':
      return datasetUrn('kafka', s.name ?? '', env);
    case 's3':
      return datasetUrn('s3', s.name ?? '', env);
    case 'alfresco-site':
      return datasetUrn('alfresco', `site/${s.name ?? ''}`, env);
    default:
      throw new Error(`Unknown store kind "${(s as StoreBrief).kind}"`);
  }
}

export const productUrn = (b: DataBrief): string => dataProductUrn(b.slug);
export const flowUrnOf = (p: ProcessBrief): string => dataFlowUrn(p.engine, p.id);
export const jobUrnOf = (p: ProcessBrief, t: TaskBrief): string => dataJobUrn(flowUrnOf(p), t.id);

function classIndex(c: string): number {
  return CLASSIFICATION_ORDER.indexOf(c as Classification);
}

/** Resolves a task endpoint: a `ref` of this brief's stores, or an existing dataset URN. */
export function resolveEndpoint(brief: DataBrief, endpoint: string): { urn: string; own: boolean } | undefined {
  const own = brief.stores.find(s => storeRef(s) === endpoint);
  if (own) return { urn: storeUrn(own), own: true };
  return assetTypeOf(endpoint) === 'dataset' ? { urn: endpoint, own: false } : undefined;
}

export function validateBrief(brief: DataBrief, vocab: Vocabulary): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);

  if (!SLUG.test(brief.slug ?? '')) err('slug must be lowercase letters/digits separated by single dashes');
  if (!brief.name?.trim()) err('name is required');
  if (!brief.description?.trim()) err('description is required');

  // --- vocabulary: choose, never invent (§9) -------------------------------
  const has = (list: Array<{ urn: string }>, urn: string) => list.some(x => x.urn === urn);
  if (!has(vocab.domains, brief.domain)) err(`domain ${brief.domain} does not exist in DataHub (domains are managed by stewards)`);
  for (const t of brief.terms ?? []) if (!has(vocab.glossaryTerms, t)) err(`glossary term ${t} does not exist in DataHub`);
  for (const t of brief.tags ?? []) if (!has(vocab.tags, t)) err(`tag ${t} does not exist in DataHub`);
  const allowed = (name: string) => vocab.structuredProperties.find(p => p.qualifiedName === name)?.allowedValues ?? [];

  // --- people -------------------------------------------------------------
  for (const [label, urn] of [
    ['businessOwner', brief.businessOwner],
    ['technicalOwner', brief.technicalOwner],
    ['steward', brief.steward],
  ] as const) {
    if (urn !== undefined && !OWNER_URN.test(urn)) err(`${label} must be a urn:li:corpuser / urn:li:corpGroup URN`);
  }
  if (!brief.businessOwner) err('businessOwner is required');
  if (!brief.technicalOwner) err('technicalOwner is required');

  // --- stores -------------------------------------------------------------
  if (!brief.stores?.length) err('at least one store (database, topic, bucket prefix or Alfresco site) is required');
  const seen = new Set<string>();
  let personalData = false;
  let maxClass = -1;
  for (const s of brief.stores ?? []) {
    let label = `store ${s.kind}`;
    try {
      const urn = storeUrn(s);
      label = `store ${urn}`;
      if (seen.has(urn)) err(`${label} is declared twice`);
      seen.add(urn);
    } catch (e) {
      err(`${label}: ${(e as Error).message}`);
      continue;
    }
    const cls = classIndex(s.classification);
    if (cls < 0) err(`${label}: classification must be one of ${CLASSIFICATION_ORDER.join(', ')}`);
    else if (!allowed('refresquito.data_classification').includes(s.classification)) {
      err(`${label}: classification "${s.classification}" is not an allowed value of refresquito.data_classification`);
    }
    maxClass = Math.max(maxClass, cls);
    if (!Number.isFinite(s.retentionDays) || s.retentionDays <= 0) err(`${label}: retentionDays must be a number > 0`);
    if (s.freshnessSlaHours !== undefined && !(s.freshnessSlaHours > 0)) err(`${label}: freshnessSlaHours must be > 0`);
    const personal = (s.columns ?? []).some(c => c.personal);
    if (personal) {
      personalData = true;
      if (!s.lawfulBasis) err(`${label}: has personal-data columns, so lawfulBasis (GDPR) is required`);
      if (cls < classIndex('Confidential')) err(`${label}: has personal-data columns, so classification must be Confidential or Restricted`);
    }
    if (s.lawfulBasis && !allowed('refresquito.lawful_basis').includes(s.lawfulBasis)) {
      err(`${label}: lawfulBasis "${s.lawfulBasis}" is not an allowed value of refresquito.lawful_basis`);
    }
    for (const c of s.columns ?? []) if (!c.name?.trim() || !c.type?.trim()) err(`${label}: every column needs a name and a type`);
  }
  if (personalData && !(brief.terms ?? []).includes(PERSONAL_TERM)) {
    warnings.push(`personal data declared: the glossary term ${PERSONAL_TERM} will be added automatically`);
  }
  if (personalData && !has(vocab.glossaryTerms, PERSONAL_TERM)) err(`glossary term ${PERSONAL_TERM} does not exist in DataHub, cannot flag personal data`);

  // --- steward rule (§4.1 table: required from Confidential up) -----------
  if (maxClass >= classIndex('Confidential') && !brief.steward) {
    err('a data steward is required when any store is Confidential or Restricted');
  }

  // --- processes and planned lineage --------------------------------------
  for (const p of brief.processes ?? []) {
    if (!['camunda', 'argo', 'activepieces'].includes(p.engine)) err(`process ${p.id}: engine must be camunda, argo or activepieces`);
    const jobIds = new Set<string>();
    for (const t of p.tasks ?? []) {
      if (jobIds.has(t.id)) err(`process ${p.id}: task id "${t.id}" is repeated`);
      jobIds.add(t.id);
      for (const [kind, list] of [['reads', t.reads], ['writes', t.writes]] as const) {
        for (const e of list ?? []) {
          const r = resolveEndpoint(brief, e);
          if (!r) err(`process ${p.id} task ${t.id} ${kind}: "${e}" is neither a store of this brief nor a dataset URN`);
          else if (kind === 'writes' && !r.own) {
            warnings.push(`process ${p.id} task ${t.id} writes to ${r.urn}, which this product does not own (possible ownership conflict)`);
          }
        }
      }
    }
  }
  const lineageDeclared = (brief.processes ?? []).some(p => p.tasks.some(t => (t.reads?.length ?? 0) + (t.writes?.length ?? 0) > 0));
  if ((brief.processes?.length ?? 0) > 0 && !lineageDeclared) warnings.push('processes declare no reads/writes, so no planned lineage will be registered');

  return { errors, warnings, personalData, maxClassification: maxClass >= 0 ? CLASSIFICATION_ORDER[maxClass] : undefined };
}
