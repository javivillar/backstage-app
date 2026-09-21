// Deterministic URN builders and a strict validator for the URNs that reach
// the plugin from the browser. BACKSTAGE-DATAHUB-DESIGN.md §3: a skeleton the
// plugin registers must get EXACTLY the URN the real ingestion will later
// emit, or DataHub ends up with two copies of the same asset -- so every URN
// is built here and nowhere else.

export type AssetType = 'dataset' | 'dataProduct' | 'dataFlow';

export const ASSET_TYPES: AssetType[] = ['dataset', 'dataProduct', 'dataFlow'];

export type Env = 'PROD' | 'DEV' | 'TEST';

const NAME_PART = /^[A-Za-z0-9_.\-/]+$/;

function part(label: string, value: string): string {
  if (!value || !NAME_PART.test(value)) {
    throw new Error(`Invalid ${label} "${value}": only letters, digits and _ . - / are allowed`);
  }
  return value;
}

export function datasetUrn(platform: string, name: string, env: Env = 'PROD'): string {
  return `urn:li:dataset:(urn:li:dataPlatform:${part('platform', platform)},${part('dataset name', name)},${env})`;
}

/** `<base>.<schema>.<table>` -- the naming the Postgres ingestion is expected to use (design §3, to verify). */
export function postgresDatasetUrn(database: string, schema: string, table: string, env: Env = 'PROD'): string {
  return datasetUrn('postgres', `${part('database', database)}.${part('schema', schema)}.${part('table', table)}`, env);
}

export function dataProductUrn(slug: string): string {
  return `urn:li:dataProduct:${part('data product slug', slug)}`;
}

export function dataFlowUrn(engine: string, id: string, cluster = 'prod'): string {
  return `urn:li:dataFlow:(${part('flow engine', engine)},${part('flow id', id)},${part('cluster', cluster)})`;
}

export function dataJobUrn(flowUrn: string, jobId: string): string {
  return `urn:li:dataJob:(${flowUrn},${part('job id', jobId)})`;
}

const ASSET_URN = /^urn:li:(dataset|dataProduct|dataFlow):[\x21-\x7e]+$/;

/**
 * Returns the asset type of a URN the browser sent, or undefined if it is not
 * an asset URN we serve. Deliberately strict (no whitespace, printable ASCII,
 * bounded length): the value is only ever passed to DataHub as a GraphQL
 * VARIABLE, never interpolated, but a tight allow-list keeps it that way.
 */
export function assetTypeOf(urn: string): AssetType | undefined {
  if (typeof urn !== 'string' || urn.length > 512) return undefined;
  const m = ASSET_URN.exec(urn);
  return m ? (m[1] as AssetType) : undefined;
}

/** Backstage catalog annotations that link an entity to DataHub (design §2). */
export const ANNOTATION_DATASET = 'datahub.io/dataset';
export const ANNOTATION_DATA_PRODUCT = 'datahub.io/data-product';
export const ANNOTATION_FLOW = 'datahub.io/flow';
