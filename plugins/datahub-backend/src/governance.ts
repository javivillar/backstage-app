import { AssetType } from './urn';

// Pure functions: turn the raw DataHub GraphQL entity into the flat summary
// the UI renders, and compute the governance completeness score. No I/O here,
// so it is unit-tested (governance.test.ts).
//
// WHICH fields count and the "governed" threshold are an OPEN DECISION for the
// team (design §12.6). The defaults below are a proposal, and the threshold is
// configurable (`datahub.governedThreshold`).

export const SP_CLASSIFICATION = 'refresquito.data_classification';
export const SP_RETENTION = 'refresquito.retention_days';
export const SP_LAWFUL_BASIS = 'refresquito.lawful_basis';
export const SP_FRESHNESS = 'refresquito.freshness_sla_hours';

const OWNERSHIP_BUSINESS = 'urn:li:ownershipType:__system__business_owner';
const PERSONAL_TAGS = ['urn:li:tag:pii', 'urn:li:tag:gdpr'];

export interface RawEntity {
  urn: string;
  name?: string | null;
  platform?: { name?: string | null } | null;
  properties?: {
    name?: string | null;
    description?: string | null;
    customProperties?: Array<{ key: string; value?: string | null }> | null;
  } | null;
  editableProperties?: { description?: string | null } | null;
  ownership?: {
    owners?: Array<{
      ownershipType?: { urn: string; info?: { name?: string | null } | null } | null;
      owner?: { urn: string; username?: string | null; name?: string | null } | null;
    }> | null;
  } | null;
  domain?: { domain?: { urn: string; properties?: { name?: string | null } | null } | null } | null;
  tags?: { tags?: Array<{ tag: { urn: string; properties?: { name?: string | null } | null } }> | null } | null;
  glossaryTerms?: { terms?: Array<{ term: { urn: string; name?: string | null } }> | null } | null;
  structuredProperties?: {
    properties?: Array<{
      structuredProperty: { definition?: { qualifiedName?: string | null } | null };
      values?: Array<{ stringValue?: string | null; numberValue?: number | null }> | null;
    }> | null;
  } | null;
  deprecation?: { deprecated?: boolean | null; note?: string | null } | null;
  schemaMetadata?: { fields?: Array<{ fieldPath: string; description?: string | null }> | null } | null;
  editableSchemaMetadata?: {
    editableSchemaFieldInfo?: Array<{ fieldPath: string; description?: string | null }> | null;
  } | null;
}

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** false => the check does not apply to this asset and is not counted. */
  applicable: boolean;
  hint: string;
}

export interface Score {
  score: number;
  governed: boolean;
  threshold: number;
  checks: Check[];
}

export interface Ref {
  urn: string;
  name: string;
}

export interface Owner extends Ref {
  kind: 'user' | 'group';
  type: string;
}

export interface Summary {
  urn: string;
  type: AssetType;
  name: string;
  description?: string;
  platform?: string;
  url: string;
  domain?: Ref;
  owners: Owner[];
  tags: Ref[];
  terms: Ref[];
  classification?: string;
  retentionDays?: number;
  lawfulBasis?: string;
  freshnessSlaHours?: number;
  personalData: boolean;
  deprecated: boolean;
  deprecationNote?: string;
  managedBy?: string;
  columns?: { total: number; described: number };
  score: Score;
}

function structured(raw: RawEntity, qualifiedName: string): { s?: string; n?: number } {
  const p = raw.structuredProperties?.properties?.find(x => x.structuredProperty.definition?.qualifiedName === qualifiedName);
  const v = p?.values?.[0];
  return { s: v?.stringValue ?? undefined, n: v?.numberValue ?? undefined };
}

/** Where the DataHub UI shows an asset of each type. */
export function assetUrl(publicUrl: string, type: AssetType, urn: string): string {
  const seg = type === 'dataFlow' ? 'pipelines' : type;
  return `${publicUrl.replace(/\/$/, '')}/${seg}/${encodeURIComponent(urn)}`;
}

export function computeScore(s: Omit<Summary, 'score' | 'url'>, hasBusinessOwner: boolean, threshold: number): Score {
  const c = (id: string, label: string, ok: boolean, hint: string, applicable = true): Check => ({
    id,
    label,
    ok,
    hint,
    applicable,
  });
  const checks: Check[] = [c('description', 'Description', !!s.description?.trim(), 'Add a description that says what the asset contains and what it is for.')];
  checks.push(c('domain', 'Domain', !!s.domain, 'Assign it to a business domain.'));
  checks.push(c('owner', 'Owner', s.owners.length > 0, 'Add at least one owner (user or group).'));
  if (s.type !== 'dataFlow') {
    checks.push(c('business-owner', 'Business owner', hasBusinessOwner, 'Name who is accountable for the data from the business side.'));
    checks.push(c('vocabulary', 'Glossary term or tag', s.tags.length + s.terms.length > 0, 'Link at least one glossary term or tag.'));
  }
  if (s.type === 'dataset') {
    checks.push(c('classification', 'Data classification', !!s.classification, 'Set refresquito.data_classification (Public / Internal / Confidential / Restricted).'));
    checks.push(c('retention', 'Retention', s.retentionDays !== undefined, 'Set refresquito.retention_days.'));
    checks.push(c('lawful-basis', 'Lawful basis (GDPR)', !!s.lawfulBasis, 'Personal data needs refresquito.lawful_basis.', s.personalData));
    const cols = s.columns;
    checks.push(
      c(
        'columns',
        'Column descriptions',
        !!cols && cols.described / cols.total >= 0.5,
        'Describe at least half of the columns.',
        !!cols && cols.total > 0,
      ),
    );
  }
  const applicable = checks.filter(x => x.applicable);
  const ok = applicable.filter(x => x.ok).length;
  const score = applicable.length === 0 ? 0 : Math.round((100 * ok) / applicable.length);
  return { score, governed: score >= threshold, threshold, checks };
}

export function summarize(type: AssetType, raw: RawEntity, publicUrl: string, threshold: number): Summary {
  const props = raw.properties ?? undefined;
  const name = props?.name ?? raw.name ?? raw.urn;
  const description = raw.editableProperties?.description || props?.description || undefined;

  const owners: Owner[] = (raw.ownership?.owners ?? [])
    .filter(o => o.owner)
    .map(o => ({
      urn: o.owner!.urn,
      name: o.owner!.username ?? o.owner!.name ?? o.owner!.urn,
      kind: o.owner!.urn.startsWith('urn:li:corpGroup:') ? 'group' : 'user',
      type: o.ownershipType?.info?.name ?? 'Owner',
    }));
  const hasBusinessOwner = (raw.ownership?.owners ?? []).some(o => o.ownershipType?.urn === OWNERSHIP_BUSINESS);

  const tags = (raw.tags?.tags ?? []).map(t => ({ urn: t.tag.urn, name: t.tag.properties?.name ?? t.tag.urn }));
  const terms = (raw.glossaryTerms?.terms ?? []).map(t => ({ urn: t.term.urn, name: t.term.name ?? t.term.urn }));
  const personalData = tags.some(t => PERSONAL_TAGS.includes(t.urn)) || terms.some(t => t.urn.endsWith(':personal-data'));

  // A column counts as described if EITHER the ingested schema or the
  // editable metadata (where the UI writes, and ingestion does not overwrite --
  // design §5.1) carries a description.
  let columns: Summary['columns'];
  const fields = raw.schemaMetadata?.fields ?? [];
  if (type === 'dataset' && fields.length > 0) {
    const editable = new Map(
      (raw.editableSchemaMetadata?.editableSchemaFieldInfo ?? []).map(f => [f.fieldPath, f.description]),
    );
    columns = {
      total: fields.length,
      described: fields.filter(f => !!(editable.get(f.fieldPath) || f.description)).length,
    };
  }

  const retention = structured(raw, SP_RETENTION);
  const freshness = structured(raw, SP_FRESHNESS);
  const base = {
    urn: raw.urn,
    type,
    name,
    description,
    platform: raw.platform?.name ?? undefined,
    domain: raw.domain?.domain
      ? { urn: raw.domain.domain.urn, name: raw.domain.domain.properties?.name ?? raw.domain.domain.urn }
      : undefined,
    owners,
    tags,
    terms,
    classification: structured(raw, SP_CLASSIFICATION).s,
    retentionDays: retention.n,
    lawfulBasis: structured(raw, SP_LAWFUL_BASIS).s,
    freshnessSlaHours: freshness.n,
    personalData,
    deprecated: !!raw.deprecation?.deprecated,
    deprecationNote: raw.deprecation?.note ?? undefined,
    managedBy: props?.customProperties?.find(p => p.key === 'managedBy')?.value ?? undefined,
    columns,
  };
  return { ...base, url: assetUrl(publicUrl, type, raw.urn), score: computeScore(base, hasBusinessOwner, threshold) };
}
