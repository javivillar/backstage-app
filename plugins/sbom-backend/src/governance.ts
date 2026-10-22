import { CatalogClient } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';
import { FactRetriever, FactRetrieverContext, TechInsightFact } from '@backstage-community/plugin-tech-insights-node';

/**
 * Facts of the scorecard "Quality & Security" (Tech Insights) about the data governance of an application: the result
 * of the daily check of datahub-oneke (refresquito-services, files/ingest/refresquito_check.py), which it writes on the
 * data product of the application in DataHub (custom property refresquito.governance). Read with the Reader token of
 * the DataHub plugin (datahub.baseUrl, datahub.token). An application is a Component with the annotation
 * datahub.io/data-product. See DATA-GOVERNANCE.md of refresquito-services.
 */

export const ANNOTATION_DATA_PRODUCT = 'datahub.io/data-product';
export const GOVERNANCE = 'refresquito.governance';

/** What the daily check writes on a data product. */
export interface GovernanceResult {
  checkedAt?: string;
  assets?: number;
  unclassified?: number;
  aboveCeiling?: number;
  belowUpstream?: number;
  exceptionExpired?: number;
  exceptionExpiring?: number;
  exceptionsInForce?: number;
  contractChecks?: number;
  contractsFailing?: number;
  ok?: boolean;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : -1);

/** The facts of one application; -1: not reported (no check yet). */
export function governanceFacts(result: GovernanceResult | undefined, now: Date = new Date()) {
  const checkedAt = result?.checkedAt ? new Date(result.checkedAt) : undefined;
  const ageHours = checkedAt && !Number.isNaN(checkedAt.getTime()) ? (now.getTime() - checkedAt.getTime()) / 3_600_000 : -1;
  return {
    governanceChecked: !!result && ageHours >= 0 && ageHours <= 48,
    governanceCheckedAt: result?.checkedAt ?? '',
    dataAssets: count(result?.assets),
    unclassifiedAssets: count(result?.unclassified),
    aboveCeilingAssets: count(result?.aboveCeiling),
    belowUpstreamAssets: count(result?.belowUpstream),
    expiredExceptions: count(result?.exceptionExpired),
    expiringExceptions: count(result?.exceptionExpiring),
    exceptionsInForce: count(result?.exceptionsInForce),
    contractChecks: count(result?.contractChecks),
    contractsFailing: count(result?.contractsFailing),
  };
}

/** The result on a data product, as DataHub's GraphQL answers it; undefined when none. */
interface GraphQLAnswer {
  data?: { dataProduct?: { properties?: { customProperties?: Array<{ key: string; value: string }> } } | null };
}

export function readResult(answer: unknown): GovernanceResult | undefined {
  const props = (answer as GraphQLAnswer | undefined)?.data?.dataProduct?.properties?.customProperties ?? [];
  const raw = props.find(p => p.key === GOVERNANCE)?.value;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as GovernanceResult;
  } catch {
    return undefined;
  }
}

export const governanceFactRetriever: FactRetriever = {
  id: 'refresquitoDataGovernanceFactRetriever',
  version: '0.1.0',
  title: 'Data governance of the application',
  description: 'The daily check of the data governance of the platform (DataHub) on the data product of the application',
  entityFilter: [{ kind: 'component' }],
  schema: {
    governanceChecked: { type: 'boolean', description: 'The daily check of DataHub ran on its data product in the last 48 hours' },
    governanceCheckedAt: { type: 'string', description: 'When the daily check last ran on it' },
    dataAssets: { type: 'integer', description: 'Assets of its data product in DataHub (tables, buckets, APIs, processes, flows, sites...); -1: not reported' },
    unclassifiedAssets: { type: 'integer', description: 'Assets without a classification; -1: not reported' },
    aboveCeilingAssets: { type: 'integer', description: 'Assets above the ceiling of the cluster; -1: not reported' },
    belowUpstreamAssets: { type: 'integer', description: 'Assets below what they read, without an exception in force; -1: not reported' },
    expiredExceptions: { type: 'integer', description: 'Classification exceptions past their date; -1: not reported' },
    expiringExceptions: { type: 'integer', description: 'Classification exceptions expiring within 30 days; -1: not reported' },
    exceptionsInForce: { type: 'integer', description: 'Approved classification exceptions in force; -1: not reported' },
    contractChecks: { type: 'integer', description: 'Checks of its data contracts; -1: not reported' },
    contractsFailing: { type: 'integer', description: 'Checks of its data contracts whose last run failed; -1: not reported' },
  },
  async handler(ctx: FactRetrieverContext): Promise<TechInsightFact[]> {
    const { discovery, auth, logger, config } = ctx;
    const dh = config.getOptionalConfig('datahub');
    const baseUrl = dh?.getOptionalString('baseUrl')?.replace(/\/$/, '');
    const token = dh?.getOptionalString('token');
    if (!baseUrl || !token) {
      logger.info('tech-insights: datahub.baseUrl or datahub.token is not set: no facts of data governance');
      return [];
    }
    const credentials = await auth.getOwnServiceCredentials();
    const { token: catalogToken } = await auth.getPluginRequestToken({ onBehalfOf: credentials, targetPluginId: 'catalog' });
    const catalog = new CatalogClient({ discoveryApi: discovery, fetchApi: { fetch } });
    const { items } = await catalog.getEntities({ filter: { kind: 'component' } }, { token: catalogToken });
    const apps = items.filter((e: Entity) => !!e.metadata.annotations?.[ANNOTATION_DATA_PRODUCT]);
    const facts: TechInsightFact[] = [];
    for (const entity of apps) {
      const urn = entity.metadata.annotations![ANNOTATION_DATA_PRODUCT];
      let result: GovernanceResult | undefined;
      try {
        const res = await fetch(`${baseUrl}/api/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            query: 'query($u:String!){ dataProduct(urn:$u){ properties { customProperties { key value } } } }',
            variables: { u: urn },
          }),
        });
        if (res.ok) result = readResult(await res.json());
        else logger.warn(`tech-insights: DataHub answered ${res.status} for ${urn}`);
      } catch (e) {
        logger.warn(`tech-insights: DataHub did not answer for ${urn}: ${e}`);
      }
      facts.push({
        entity: { namespace: entity.metadata.namespace ?? 'default', kind: entity.kind, name: entity.metadata.name },
        facts: governanceFacts(result),
      });
    }
    return facts;
  },
};
