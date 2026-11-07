import { parse as parseYaml } from 'yaml';
import { DatahubSettings, datahubQuery } from './datahubClient';
import { assetUrl } from './governance';

// The Data tab of the console for one deployment of a business application (GET /application).
// pro: what DataHub catalogues of its data product (live). dev / pre: DataHub catalogues only pro
// (DATA-GOVERNANCE.md), so the tab shows what the application DECLARES: the block `datahub` of its
// deployment file and `platform/datahub.yaml` of its repository, read from GitHub. The comparison
// with the real schema of a dev database is not done here (schemaCompared: false).

export const MAX_ENTITIES = 200;

// ---------------------------------------------------------------- pure parsing (unit tested)

export interface Governance {
  ok?: boolean;
  assets?: number;
  unclassified?: number;
  aboveCeiling?: number;
  belowUpstream?: number;
  contractChecks?: number;
  contractsFailing?: number;
  exceptionsInForce?: number;
  exceptionExpiring?: number;
  exceptionExpired?: number;
  checkedAt?: string;
}

function json<T>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** customProperty refresquito.governance of the data product (the daily check of datahub-oneke). */
export function parseGovernance(text: string | undefined): Governance | undefined {
  const g = json<Record<string, unknown>>(text);
  if (!g) return undefined;
  const n = (k: string) => (typeof g[k] === 'number' ? (g[k] as number) : undefined);
  return {
    ok: typeof g.ok === 'boolean' ? g.ok : undefined,
    assets: n('assets'),
    unclassified: n('unclassified'),
    aboveCeiling: n('aboveCeiling'),
    belowUpstream: n('belowUpstream'),
    contractChecks: n('contractChecks'),
    contractsFailing: n('contractsFailing'),
    exceptionsInForce: n('exceptionsInForce'),
    exceptionExpiring: n('exceptionExpiring'),
    exceptionExpired: n('exceptionExpired'),
    checkedAt: typeof g.checkedAt === 'string' ? g.checkedAt : undefined,
  };
}

/** customProperty refresquito.applied: the assertion urns of its data contracts. */
export function contractAssertions(text: string | undefined): string[] {
  const a = json<{ contracts?: unknown[] }>(text);
  return (a?.contracts ?? []).filter((u): u is string => typeof u === 'string' && u.startsWith('urn:li:assertion:'));
}

export interface Profile {
  rows?: number;
  measuredAt?: string;
  columns: Record<string, { distinct?: number; nulls?: number; max?: string }>;
}

/** customProperty refresquito.profile of a table (measured by the provisioner once an hour). */
export function parseProfile(text: string | undefined): Profile | undefined {
  const p = json<{ rows?: number; measuredAt?: string; columns?: Profile['columns'] }>(text);
  if (!p) return undefined;
  return { rows: p.rows, measuredAt: p.measuredAt, columns: p.columns ?? {} };
}

export interface DeclaredColumn {
  table: string;
  column: string;
  terms: string[];
  classification?: string;
}

export interface Declarations {
  tables: Array<{ name: string; terms: string[]; columns: DeclaredColumn[]; contract: boolean }>;
  sites: string[];
  processes: string[];
  contracts: string[];
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
function keys(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : String((x as { name?: unknown })?.name ?? ''))).filter(Boolean);
  if (v && typeof v === 'object') return Object.keys(v);
  return [];
}

/** platform/datahub.yaml (format: refresquito-services, charts/python-app-oneke/INSTALL.md, "Block datahub"). */
export function parseDeclarations(text: string | undefined): Declarations | undefined {
  if (!text) return undefined;
  let doc: Record<string, unknown>;
  try {
    doc = (parseYaml(text) ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const contracts = keys(doc.contracts);
  const tables = Object.entries((doc.tables ?? {}) as Record<string, Record<string, unknown> | null>).map(([name, t]) => ({
    name,
    terms: strs(t?.terms),
    contract: contracts.includes(name),
    columns: Object.entries((t?.columns ?? {}) as Record<string, Record<string, unknown> | null>).map(([column, c]) => ({
      table: name,
      column,
      terms: strs(c?.terms),
      classification: typeof c?.classification === 'string' ? c.classification : undefined,
    })),
  }));
  return { tables, sites: keys(doc.sites), processes: keys(doc.processes), contracts };
}

export interface PersonalKind {
  kind: string;
  count: number;
  examples: string[];
}

/** Columns with a glossary term PersonalData.*, by kind (the GDPR view). */
export function personalData(columns: DeclaredColumn[]): PersonalKind[] {
  const by = new Map<string, string[]>();
  for (const c of columns) {
    for (const term of c.terms.filter(t => t.startsWith('PersonalData.'))) {
      by.set(term, [...(by.get(term) ?? []), `${c.table}.${c.column}`]);
    }
  }
  return [...by.entries()]
    .map(([kind, cols]) => ({ kind, count: cols.length, examples: cols.slice(0, 3) }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export interface DeclaredStats {
  tables: number;
  columns: number;
  confidentialColumns: number;
  personalColumns: number;
  personal: PersonalKind[];
  contractTables: string[];
  terms: string[];
}

export function declarationStats(d: Declarations): DeclaredStats {
  const columns = d.tables.flatMap(t => t.columns);
  const personal = personalData(columns);
  const terms = new Set<string>();
  d.tables.forEach(t => t.terms.forEach(x => terms.add(x)));
  columns.forEach(c => c.terms.forEach(x => terms.add(x)));
  return {
    tables: d.tables.length,
    columns: columns.length,
    confidentialColumns: columns.filter(c => /CONFIDENTIAL|SECRET|RESTRICTED/i.test(c.classification ?? '')).length,
    personalColumns: new Set(columns.filter(c => c.terms.some(t => t.startsWith('PersonalData.'))).map(c => `${c.table}.${c.column}`)).size,
    personal,
    contractTables: d.contracts,
    terms: [...terms].sort(),
  };
}

export interface DeploymentBlock {
  description?: string;
  classification?: string;
  retentionDays?: number;
  owners: { users: string[]; groups: string[] };
}

/** The block platform.datahub of the deployment file (bootstrap/app-of-apps/apps/<app>.yaml). */
export function parseDeploymentBlock(text: string | undefined): DeploymentBlock | undefined {
  if (!text) return undefined;
  let doc: Record<string, unknown>;
  try {
    doc = (parseYaml(text) ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const b = ((doc.platform ?? {}) as Record<string, unknown>).datahub as Record<string, unknown> | undefined;
  if (!b) return undefined;
  const owners = (b.owners ?? {}) as Record<string, unknown>;
  return {
    description: typeof b.description === 'string' ? b.description : undefined,
    classification: typeof b.classification === 'string' ? b.classification : undefined,
    retentionDays: typeof b.retentionDays === 'number' ? b.retentionDays : undefined,
    owners: { users: strs(owners.users), groups: strs(owners.groups) },
  };
}

/** What the declarations say that the catalogue does not have, and the other way round. */
export function declaredVsFound(d: Declarations | undefined, found: Array<{ table: string; columns: string[] }>) {
  if (!d) return { undeclaredTables: found.map(f => f.table), missingTables: [], missingColumns: [] as string[] };
  const declared = new Map(d.tables.map(t => [t.name, t]));
  const foundMap = new Map(found.map(f => [f.table, new Set(f.columns)]));
  return {
    undeclaredTables: found.filter(f => !declared.has(f.table)).map(f => f.table),
    missingTables: d.tables.filter(t => !foundMap.has(t.name)).map(t => t.name),
    missingColumns: d.tables.flatMap(t => (foundMap.has(t.name) ? t.columns.filter(c => !foundMap.get(t.name)!.has(c.column)).map(c => `${t.name}.${c.column}`) : [])),
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  postgres: 'PostgreSQL',
  s3: 'SeaweedFS (S3)',
  alfresco: 'Alfresco',
  camunda: 'Camunda',
  operaton: 'Operaton',
  superset: 'Superset',
  activepieces: 'Activepieces',
};
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

// ---------------------------------------------------------------- DataHub (live, pro)

type SP = { properties?: Array<{ structuredProperty: { definition?: { qualifiedName?: string } }; values?: Array<{ stringValue?: string; numberValue?: number }> }> };
const sp = (s: SP | null | undefined, name: string) => {
  const v = s?.properties?.find(p => p.structuredProperty.definition?.qualifiedName === name)?.values?.[0];
  return v?.stringValue ?? (v?.numberValue !== undefined ? String(v.numberValue) : undefined);
};
const cp = (props: Array<{ key: string; value: string }> | null | undefined, key: string) => props?.find(p => p.key === key)?.value;
const termName = (urn: string) => urn.replace(/^urn:li:glossaryTerm:/, '');
const SPF = 'structuredProperties{properties{structuredProperty{definition{qualifiedName}} values{... on StringValue{stringValue} ... on NumberValue{numberValue}}}}';

const Q_PRODUCT = `query($u:String!){dataProduct(urn:$u){exists properties{name description customProperties{key value}}
 domain{domain{urn properties{name} ${SPF}}}
 ownership{owners{owner{__typename ... on CorpUser{username properties{displayName}} ... on CorpGroup{name}} ownershipType{info{name}}}}
 ${SPF}
 entities(input:{query:"*",start:0,count:${MAX_ENTITIES}}){total searchResults{entity{urn type
  ... on Dataset{name platform{name} subTypes{typeNames}}
  ... on Container{properties{name} platform{name} subTypes{typeNames}}
  ... on Chart{properties{name}} ... on Dashboard{properties{name}}}}}}}`;

const DATASET_FIELDS = `urn name platform{name} subTypes{typeNames} properties{description customProperties{key value}} ${SPF}
 glossaryTerms{terms{term{urn}}}
 schemaMetadata{fields{fieldPath nativeDataType description glossaryTerms{terms{term{urn}}} tags{tags{tag{name}}}}}
 editableSchemaMetadata{editableSchemaFieldInfo{fieldPath description glossaryTerms{terms{term{urn}}}}}
 up:lineage(input:{direction:UPSTREAM,start:0,count:20}){relationships{entity{urn type ... on Dataset{name platform{name}} ... on DataJob{properties{name}}}}}
 down:lineage(input:{direction:DOWNSTREAM,start:0,count:20}){relationships{entity{urn type ... on Dataset{name platform{name}} ... on Chart{properties{name}} ... on Dashboard{properties{name}}}}}`;

interface RawDataset {
  urn: string;
  name?: string;
  platform?: { name?: string };
  subTypes?: { typeNames?: string[] };
  properties?: { description?: string; customProperties?: Array<{ key: string; value: string }> };
  structuredProperties?: SP;
  glossaryTerms?: { terms?: Array<{ term: { urn: string } }> };
  schemaMetadata?: { fields?: Array<{ fieldPath: string; nativeDataType?: string; description?: string; glossaryTerms?: { terms?: Array<{ term: { urn: string } }> }; tags?: { tags?: Array<{ tag: { name?: string } }> } }> };
  editableSchemaMetadata?: { editableSchemaFieldInfo?: Array<{ fieldPath: string; description?: string; glossaryTerms?: { terms?: Array<{ term: { urn: string } }> } }> };
  up?: { relationships?: Array<{ entity: RawNode }> };
  down?: { relationships?: Array<{ entity: RawNode }> };
}
interface RawNode {
  urn: string;
  type: string;
  name?: string;
  platform?: { name?: string };
  properties?: { name?: string };
}

export interface LineageNode {
  urn: string;
  label: string;
  platform: string;
  kind: string;
  inProduct: boolean;
  url: string;
}

function nodeOf(n: RawNode, publicUrl: string, inProduct: boolean): LineageNode {
  const byType: Record<string, { platform: string; seg: string }> = {
    DATASET: { platform: '', seg: 'dataset' },
    CHART: { platform: 'superset', seg: 'chart' },
    DASHBOARD: { platform: 'superset', seg: 'dashboard' },
    DATA_JOB: { platform: 'pipeline', seg: 'dataJob' },
  };
  const known = byType[n.type] ?? { platform: '', seg: 'dataset' };
  const platform = n.platform?.name ?? known.platform;
  const seg = known.seg;
  return {
    urn: n.urn,
    label: n.name ?? n.properties?.name ?? n.urn,
    platform,
    kind: n.type.toLowerCase().replace('_', ' '),
    inProduct,
    url: `${publicUrl}/${seg}/${encodeURIComponent(n.urn)}`,
  };
}

async function batch<T>(settings: DatahubSettings, field: string, args: string[], selection: string): Promise<Array<T | null>> {
  if (!args.length) return [];
  const out: Array<T | null> = [];
  for (let i = 0; i < args.length; i += 20) {
    const chunk = args.slice(i, i + 20);
    const doc = `query{${chunk.map((u, j) => `e${j}:${field}(urn:${JSON.stringify(u)}){${selection}}`).join(' ')}}`;
    const data = await datahubQuery<Record<string, T | null>>(settings, doc, {});
    chunk.forEach((_, j) => out.push(data[`e${j}`] ?? null));
  }
  return out;
}

export class NotFound extends Error {}

function detailOf(table: { columns: unknown[]; rows?: number } | undefined, containerAssets: number | undefined): string {
  if (table) return `${table.columns.length} columns${table.rows !== undefined ? ` · ${table.rows} rows` : ''}`;
  if (containerAssets !== undefined) return `${containerAssets} assets`;
  return '';
}

interface RawProduct {
  exists?: boolean;
  properties?: { name?: string; description?: string; customProperties?: Array<{ key: string; value: string }> };
  domain?: { domain?: { urn?: string; properties?: { name?: string }; structuredProperties?: SP } };
  ownership?: { owners?: Array<{ owner: { __typename?: string; username?: string; name?: string; properties?: { displayName?: string } }; ownershipType?: { info?: { name?: string } } }> };
  structuredProperties?: SP;
  entities?: { total?: number; searchResults?: Array<{ entity: RawNode & { subTypes?: { typeNames?: string[] } } }> };
}

export async function loadPro(settings: DatahubSettings, product: string) {
  const pub = settings.publicUrl;
  const data = await datahubQuery<{ dataProduct: RawProduct | null }>(settings, Q_PRODUCT, { u: product });
  const p = data.dataProduct;
  if (!p || p.exists === false) throw new NotFound(`The data product ${product} is not in DataHub yet (it is catalogued once the application is in pro and its provisioner has run).`);
  const custom = p.properties?.customProperties;
  const entities = (p.entities?.searchResults ?? []).map(r => r.entity);

  // tables: their schema, terms, profile and lineage (one batched query for at most MAX_ENTITIES of them)
  const datasetUrns = entities.filter(e => e.type === 'DATASET').map(e => e.urn);
  const datasets = (await batch<RawDataset>(settings, 'dataset', datasetUrns, DATASET_FIELDS)).filter((d): d is RawDataset => !!d);
  // containers (bucket, site, process project...): how many assets each holds
  const containerUrns = entities.filter(e => e.type === 'CONTAINER').map(e => e.urn);
  const containers = await batch<{ entities?: { total?: number } }>(settings, 'container', containerUrns, 'entities(input:{start:0,count:0}){total}');
  // the contracts: last run of each assertion
  const assertionUrns = contractAssertions(cp(custom, 'refresquito.applied')).slice(0, MAX_ENTITIES);
  const assertions = await batch<{ info?: { type?: string; description?: string }; runEvents?: { runEvents?: Array<{ timestampMillis?: number; result?: { type?: string } }> } }>(
    settings,
    'assertion',
    assertionUrns,
    'info{type description} runEvents(limit:1){runEvents{timestampMillis result{type}}}',
  );

  const productUrns = new Set(entities.map(e => e.urn));
  const nodes = new Map<string, LineageNode>();
  const edges: Array<{ from: string; to: string }> = [];
  const tables = datasets
    .filter(d => d.platform?.name === 'postgres')
    .map(d => {
      const editable = new Map((d.editableSchemaMetadata?.editableSchemaFieldInfo ?? []).map(f => [f.fieldPath, f]));
      const profile = parseProfile(cp(d.properties?.customProperties, 'refresquito.profile'));
      return {
        urn: d.urn,
        name: d.name ?? d.urn,
        url: assetUrl(pub, 'dataset', d.urn),
        description: d.properties?.description,
        classification: sp(d.structuredProperties, 'refresquito.classification'),
        terms: (d.glossaryTerms?.terms ?? []).map(t => termName(t.term.urn)),
        rows: profile?.rows,
        measuredAt: profile?.measuredAt,
        columns: (d.schemaMetadata?.fields ?? []).map(f => {
          const e = editable.get(f.fieldPath);
          const terms = [...(f.glossaryTerms?.terms ?? []), ...(e?.glossaryTerms?.terms ?? [])].map(t => termName(t.term.urn));
          const pr = profile?.columns[f.fieldPath];
          return {
            name: f.fieldPath,
            type: f.nativeDataType ?? '',
            description: e?.description ?? f.description ?? undefined,
            terms: [...new Set(terms)],
            tags: (f.tags?.tags ?? []).map(t => t.tag.name ?? '').filter(Boolean),
            distinct: pr?.distinct,
            nulls: pr?.nulls,
          };
        }),
      };
    });
  for (const d of datasets) {
    nodes.set(d.urn, nodeOf({ urn: d.urn, type: 'DATASET', name: d.name, platform: d.platform }, pub, true));
    for (const r of d.up?.relationships ?? []) {
      nodes.set(r.entity.urn, nodes.get(r.entity.urn) ?? nodeOf(r.entity, pub, productUrns.has(r.entity.urn)));
      edges.push({ from: r.entity.urn, to: d.urn });
    }
    for (const r of d.down?.relationships ?? []) {
      nodes.set(r.entity.urn, nodes.get(r.entity.urn) ?? nodeOf(r.entity, pub, productUrns.has(r.entity.urn)));
      edges.push({ from: d.urn, to: r.entity.urn });
    }
  }
  // one more hop downstream from the datasets outside the product that it feeds (e.g. Superset dataset -> its charts)
  const neighbours = [...nodes.values()].filter(n => !n.inProduct && n.kind === 'dataset').map(n => n.urn).slice(0, 20);
  const second = await batch<{ down?: { relationships?: Array<{ entity: RawNode }> } }>(
    settings,
    'dataset',
    neighbours,
    'down:lineage(input:{direction:DOWNSTREAM,start:0,count:20}){relationships{entity{urn type ... on Dataset{name platform{name}} ... on Chart{properties{name}} ... on Dashboard{properties{name}}}}}',
  );
  second.forEach((s, i) =>
    (s?.down?.relationships ?? []).forEach(r => {
      nodes.set(r.entity.urn, nodes.get(r.entity.urn) ?? nodeOf(r.entity, pub, false));
      edges.push({ from: neighbours[i], to: r.entity.urn });
    }),
  );

  const inventory = entities
    .filter(e => !(e.type === 'CONTAINER' && e.platform?.name === 'postgres'))
    .map(e => {
      const ci = containerUrns.indexOf(e.urn);
      const table = tables.find(t => t.urn === e.urn);
      return {
        urn: e.urn,
        platform: platformLabel(e.platform?.name ?? ''),
        name: e.name ?? e.properties?.name ?? e.urn,
        kind: (e.subTypes?.typeNames?.[0] ?? e.type).toLowerCase(),
        detail: detailOf(table, ci >= 0 ? containers[ci]?.entities?.total ?? 0 : undefined),
        classification: table?.classification,
        url: e.type === 'CONTAINER' ? `${pub}/container/${encodeURIComponent(e.urn)}` : assetUrl(pub, 'dataset', e.urn),
      };
    });

  const declarationsText = cp(custom, 'refresquito.declarations');
  const declarations = parseDeclarations(declarationsText);
  const owners = (p.ownership?.owners ?? []).map(o => ({
    name: (o.owner.__typename === 'CorpUser' ? o.owner.properties?.displayName ?? o.owner.username : o.owner.name) ?? '',
    type: o.ownershipType?.info?.name ?? '',
  }));
  const foundColumns = tables.flatMap(t => t.columns.map(c => ({ table: t.name, column: c.name, terms: c.terms })));
  const personal = personalData([
    ...foundColumns,
    ...(declarations?.tables.flatMap(t => t.columns) ?? []).filter(c => !foundColumns.some(f => f.table === c.table && f.column === c.column)),
  ]);

  return {
    source: 'datahub' as const,
    product: {
      urn: product,
      url: assetUrl(pub, 'dataProduct', product),
      name: p.properties?.name,
      description: p.properties?.description,
      domain: p.domain?.domain?.properties?.name,
      ceiling: sp(p.domain?.domain?.structuredProperties, 'refresquito.max_classification'),
      classification: sp(p.structuredProperties, 'refresquito.classification'),
      classificationSource: sp(p.structuredProperties, 'refresquito.classification_source'),
      retentionDays: sp(p.structuredProperties, 'refresquito.retention_days'),
      zone: sp(p.structuredProperties, 'refresquito.zone'),
      program: sp(p.structuredProperties, 'refresquito.program'),
      stage: sp(p.structuredProperties, 'refresquito.stage'),
      ownerTeam: sp(p.structuredProperties, 'refresquito.owner_team'),
      owners,
    },
    governance: parseGovernance(cp(custom, 'refresquito.governance')),
    inventory,
    tables,
    lineage: { nodes: [...nodes.values()], edges },
    contracts: assertions.map((a, i) => ({
      urn: assertionUrns[i],
      description: a?.info?.description ?? assertionUrns[i],
      type: a?.info?.type,
      result: a?.runEvents?.runEvents?.[0]?.result?.type,
      at: a?.runEvents?.runEvents?.[0]?.timestampMillis,
    })),
    personal,
    declared: !!declarations,
    vsFound: declaredVsFound(declarations, tables.map(t => ({ table: t.name, columns: t.columns.map(c => c.name) }))),
    truncated: (p.entities?.total ?? 0) > MAX_ENTITIES,
  };
}

// ---------------------------------------------------------------- GitHub (declared, dev / pre)

/** "owner/repo:path" or a path in `repository`; read at the default branch through the GitHub contents API. */
export async function githubFile(token: string | undefined, repo: string, path: string): Promise<string | undefined> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(path) || path.includes('..')) throw new Error(`Not a GitHub file: ${repo}:${path}`);
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { Accept: 'application/vnd.github.raw+json', ...(token ? { Authorization: `token ${token}` } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub ${repo}:${path} answered ${res.status}`);
  return res.text();
}

export async function loadDeclared(token: string | undefined, repository: string | undefined, deploymentFile: string | undefined) {
  let block: DeploymentBlock | undefined;
  let deploymentMissing = false;
  if (deploymentFile?.includes(':')) {
    const [repo, path] = deploymentFile.split(':', 2);
    const text = await githubFile(token, repo, path);
    deploymentMissing = text === undefined;
    block = parseDeploymentBlock(text);
  }
  let declarations: Declarations | undefined;
  let declarationsMissing = true;
  if (repository) {
    const text = await githubFile(token, repository, 'platform/datahub.yaml');
    declarationsMissing = text === undefined;
    declarations = parseDeclarations(text);
  }
  return {
    source: 'declared' as const,
    block,
    deploymentMissing,
    declarationsMissing,
    repository,
    declarationsUrl: repository ? `https://github.com/${repository}/blob/HEAD/platform/datahub.yaml` : undefined,
    stats: declarations ? declarationStats(declarations) : undefined,
    tables: declarations?.tables.map(t => ({ name: t.name, terms: t.terms, columns: t.columns.length, contract: t.contract })) ?? [],
    sites: declarations?.sites ?? [],
    processes: declarations?.processes ?? [],
    schemaCompared: false,
  };
}
