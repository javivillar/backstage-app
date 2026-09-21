// Phase 3 (BACKSTAGE-DATAHUB-DESIGN.md §10): "who is affected if this asset changes?", from DataHub's
// DOWNSTREAM lineage. Pure: turns the raw searchAcrossLineage result into the summary the UI and the
// scaffolder action show. No I/O here (impact.test.ts).

export const CRITICAL_TAG = 'urn:li:tag:dq-critical';

export interface RawImpactEntity {
  urn: string;
  type: string;
  name?: string | null;
  properties?: { name?: string | null } | null;
  platform?: { name?: string | null } | null;
  ownership?: { owners?: Array<{ owner?: { urn: string } | null }> | null } | null;
  tags?: { tags?: Array<{ tag: { urn: string } }> | null } | null;
}

export interface RawImpactResult {
  total: number;
  searchResults: Array<{ degree: number; entity: RawImpactEntity }>;
}

export interface ImpactItem {
  urn: string;
  type: string;
  name: string;
  platform?: string;
  /** Lineage hops away from the changed asset (1 = direct consumer). */
  degree: number;
  critical: boolean;
  owners: string[];
}

export interface Impact {
  urn: string;
  total: number;
  /** How many results the query returned (total can be larger than the page fetched). */
  fetched: number;
  truncated: boolean;
  byType: Record<string, number>;
  /** Assets tagged dq-critical (data-quality assertions gate downstream reports on them). */
  critical: number;
  directConsumers: number;
  maxDegree: number;
  /** Everyone owning an affected asset: the people/groups to notify. */
  owners: string[];
  items: ImpactItem[];
}

const TYPE_LABEL: Record<string, string> = {
  DATASET: 'dataset',
  DATA_FLOW: 'dataFlow',
  DATA_JOB: 'dataJob',
  DASHBOARD: 'dashboard',
  CHART: 'chart',
  DATA_PRODUCT: 'dataProduct',
};

export function summarizeImpact(urn: string, raw: RawImpactResult, itemLimit = 25): Impact {
  const items: ImpactItem[] = raw.searchResults.map(r => {
    const e = r.entity;
    const owners = (e.ownership?.owners ?? []).map(o => o.owner?.urn).filter((u): u is string => !!u);
    return {
      urn: e.urn,
      type: TYPE_LABEL[e.type] ?? e.type.toLowerCase(),
      name: e.name ?? e.properties?.name ?? e.urn,
      platform: e.platform?.name ?? undefined,
      degree: r.degree,
      critical: (e.tags?.tags ?? []).some(t => t.tag.urn === CRITICAL_TAG),
      owners,
    };
  });
  const byType: Record<string, number> = {};
  for (const i of items) byType[i.type] = (byType[i.type] ?? 0) + 1;
  // Closest consumers first, critical ones ahead of the rest at the same distance.
  const sorted = [...items].sort((a, b) => a.degree - b.degree || Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name));
  return {
    urn,
    total: raw.total,
    fetched: items.length,
    truncated: raw.total > items.length,
    byType,
    critical: items.filter(i => i.critical).length,
    directConsumers: items.filter(i => i.degree === 1).length,
    maxDegree: items.reduce((m, i) => Math.max(m, i.degree), 0),
    owners: [...new Set(items.flatMap(i => i.owners))].sort(),
    items: sorted.slice(0, itemLimit),
  };
}

/** One human line for logs / template output. */
export function impactHeadline(i: Impact): string {
  if (i.total === 0) return 'No downstream assets depend on this one (per DataHub lineage).';
  const parts = Object.entries(i.byType).map(([t, n]) => `${n} ${t}`);
  const crit = i.critical ? `, ${i.critical} marked dq-critical` : '';
  return `${i.total} downstream asset${i.total === 1 ? '' : 's'} affected (${parts.join(', ')}${crit}); ${i.owners.length} owner${i.owners.length === 1 ? '' : 's'} to notify.`;
}
