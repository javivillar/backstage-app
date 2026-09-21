/* eslint-disable no-console */
/**
 * Live verification of the DataHub WRITE path (F2).
 * Procedure, options and pros/cons: BACKSTAGE-DATAHUB-F2-VERIFICATION.md (refresquito-services).
 *
 *   node -r sucrase/register scripts/verify_write.ts <step>
 *
 * steps: create | rerun | deprecate | rollback | cleanup
 *
 * `cleanup` and the rollback SOFT-delete (status.removed=true): the service account has no
 * DELETE_ENTITY privilege (by design, least privilege). Hidden assets can be removed for good
 * by a DataHub admin.
 *
 * It runs the REAL orchestrator (src/register.ts) against a real DataHub with the
 * plugin's service-account token, on clearly named TEST assets only. Nothing else
 * can be written or deleted: every URN is checked against ALLOWED before any
 * write or delete, and the script aborts otherwise.
 *
 * REVIEW NOTE: if a Claude Code permission rule pins this file, then changing it
 * changes what that rule allows. Change it only through a reviewed PR.
 */
import * as fs from 'fs';
import { softDeleteEntity } from '../src/datahubWriter';
import { DatahubSettings, datahubQuery } from '../src/datahubClient';
import { deprecateAsset, registerBrief } from '../src/register';
import { DataBrief } from '../src/brief';
import { Proposal } from '../src/plan';

const BASE_URL = process.env.DATAHUB_BASE_URL ?? 'http://datahub.refresquito.com';
const TOKEN_FILE = process.env.DATAHUB_TOKEN_FILE ?? '/var/lib/one/datahub-f2/datahub.token';

const settings: DatahubSettings = {
  baseUrl: BASE_URL,
  token: fs.readFileSync(TOKEN_FILE, 'utf8').trim(),
  publicUrl: BASE_URL,
  governedThreshold: 80,
  accessGroups: [],
  writesEnabled: true,
  writeGroups: [],
  stewardGroups: [],
  defaultSteward: 'urn:li:corpGroup:datahub-admin',
};

/** The ONLY things this script may create, change or delete (substring match on the URN). */
const ALLOWED = ['f2_verify', 'f2-verify', 'f2_probe'];
function assertTestUrn(urn: string): void {
  if (!ALLOWED.some(a => urn.includes(a))) {
    throw new Error(`Refusing to touch a non-test URN: ${urn}`);
  }
}

type AssetKind = 'dataset' | 'dataFlow' | 'dataJob' | 'dataProduct';

const ds = (db: string) => `urn:li:dataset:(urn:li:dataPlatform:postgres,${db}.public.pedidos,PROD)`;
const site = (slug: string) => `urn:li:dataset:(urn:li:dataPlatform:alfresco,site/${slug}-docs,PROD)`;
const flow = (slug: string) => `urn:li:dataFlow:(camunda,${slug}-checkout,prod)`;
const job = (slug: string) => `urn:li:dataJob:(${flow(slug)},validar)`;
const product = (slug: string) => `urn:li:dataProduct:${slug}`;

const brief = (slug: string, db: string): DataBrief => ({
  slug,
  name: 'F2 verify',
  description: 'Temporary product created by the F2 live verification. Safe to delete.',
  domain: 'sales',
  businessOwner: 'sales-analytics',
  technicalOwner: 'carlos.ruiz@refresquito.com',
  terms: ['customer'],
  tags: ['gold'],
  backstageEntity: 'system:default/f2-verify',
  links: [{ url: 'http://backstage.refresquito.com/', description: 'Backstage' }],
  stores: [
    {
      kind: 'postgres',
      database: db,
      schema: 'public',
      table: 'pedidos',
      description: 'orders',
      classification: 'Confidential',
      retentionDays: 2555,
      lawfulBasis: 'Contract',
      freshnessSlaHours: 24,
      columns: [
        { name: 'id', type: 'int', description: 'primary key' },
        { name: 'email', type: 'text', personal: true, description: 'customer email' },
      ],
    },
    { kind: 'alfresco-site', name: `${slug}-docs`, classification: 'Internal', retentionDays: 365 },
  ],
  processes: [
    {
      engine: 'camunda',
      id: `${slug}-checkout`,
      name: 'Checkout',
      tasks: [
        {
          id: 'validar',
          name: 'Validate order',
          reads: [`postgres:${db}.public.pedidos`],
          writes: [`alfresco-site:${slug}-docs`],
        },
      ],
    },
  ],
});

/**
 * Wraps the ONLY function that writes, so that no proposal can reach DataHub
 * unless every URN in it is a test URN. The guard runs BEFORE the write.
 */
function guardWrites(): () => void {
  const real = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && String(url).includes('/openapi/v3/entity/')) {
      const body = JSON.parse(String(init?.body)) as Array<{ urn: string }>;
      body.forEach(e => assertTestUrn(e.urn));
    }
    if (method === 'DELETE') assertTestUrn(decodeURIComponent(String(url)));
    return real(url, init);
  }) as typeof fetch;
  return () => {
    global.fetch = real;
  };
}

const opts = (runId: string) => ({
  ctx: { runId, requestedBy: 'user:default/f2-verify-script' },
  callerEmail: 'javi.villar@gmail.com',
  authorize: async () => {},
});

async function exists(type: AssetKind, urn: string): Promise<boolean> {
  const d = await datahubQuery<Record<string, { exists?: boolean } | null>>(
    settings,
    `query($u:String!){ ${type}(urn:$u){ exists } }`,
    { u: urn },
  );
  return !!d[type]?.exists;
}

/** True when the asset is gone OR soft-deleted (`status.removed`), which is how the undo hides things. */
async function hidden(type: AssetKind, urn: string): Promise<boolean> {
  const d = await datahubQuery<Record<string, { exists?: boolean; status?: { removed?: boolean } | null } | null>>(
    settings,
    `query($u:String!){ ${type}(urn:$u){ exists status{ removed } } }`,
    { u: urn },
  );
  const e = d[type];
  return !e?.exists || e.status?.removed === true;
}

const seconds = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
}

/** Reads everything back: a pass proves DataHub ACCEPTED each aspect, not just answered 200. */
async function readBack(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const d = await datahubQuery<Record<string, any>>(
    settings,
    `query($ds:String!,$flow:String!,$job:String!,$p:String!){
       dataset(urn:$ds){ properties{ name customProperties{ key value } } subTypes{ typeNames }
         ownership{ owners{ ownershipType{ info{ name } } owner{ ... on CorpUser{ urn } ... on CorpGroup{ urn } } } }
         domain{ domain{ urn } } tags{ tags{ tag{ urn } } } glossaryTerms{ terms{ term{ urn } } }
         structuredProperties{ properties{ structuredProperty{ definition{ qualifiedName } } values{ ... on StringValue{ stringValue } ... on NumberValue{ numberValue } } } }
         schemaMetadata{ fields{ fieldPath nativeDataType } }
         editableSchemaMetadata{ editableSchemaFieldInfo{ fieldPath description tags{ tags{ tag{ urn } } } } } }
       dataFlow(urn:$flow){ properties{ name } domain{ domain{ urn } } }
       dataJob(urn:$job){ properties{ name } inputOutput{ inputDatasets{ urn } outputDatasets{ urn } } }
       dataProduct(urn:$p){ properties{ name numAssets } domain{ domain{ urn } } institutionalMemory{ elements{ url } } }
     }`,
    { ds: ds('f2_verify'), flow: flow('f2-verify'), job: job('f2-verify'), p: product('f2-verify') },
  );
  const x = d.dataset;
  check(
    'dataset properties + managedBy marker',
    x?.properties?.name === 'pedidos' &&
      x.properties.customProperties.some((p: any) => p.key === 'managedBy' && p.value === 'backstage'),
    x?.properties?.customProperties,
  );
  check('dataset subtype', x?.subTypes?.typeNames?.[0] === 'Table', x?.subTypes);
  check(
    'owners (business, technical, steward)',
    (x?.ownership?.owners ?? []).length === 3,
    x?.ownership?.owners?.map((o: any) => `${o.ownershipType?.info?.name}:${o.owner?.urn}`),
  );
  check('domain', x?.domain?.domain?.urn === 'urn:li:domain:sales');
  check('tags', x?.tags?.tags?.some((t: any) => t.tag.urn === 'urn:li:tag:gold'), x?.tags);
  check(
    'glossary terms (+ personal-data added)',
    ['customer', 'personal-data'].every(t => x?.glossaryTerms?.terms?.some((y: any) => y.term.urn.endsWith(t))),
    x?.glossaryTerms?.terms?.map((t: any) => t.term.urn),
  );
  const sp = Object.fromEntries(
    (x?.structuredProperties?.properties ?? []).map((p: any) => [
      p.structuredProperty.definition.qualifiedName,
      p.values[0].stringValue ?? p.values[0].numberValue,
    ]),
  );
  check(
    'structured properties',
    sp['refresquito.data_classification'] === 'Confidential' &&
      sp['refresquito.retention_days'] === 2555 &&
      sp['refresquito.lawful_basis'] === 'Contract' &&
      sp['refresquito.freshness_sla_hours'] === 24,
    sp,
  );
  check('schema fields', x?.schemaMetadata?.fields?.length === 2, x?.schemaMetadata?.fields);
  const ed = x?.editableSchemaMetadata?.editableSchemaFieldInfo ?? [];
  check(
    'editable column metadata (description + PII tag)',
    ed.some((f: any) => f.fieldPath === 'email' && f.description && f.tags?.tags?.length > 0),
    ed,
  );
  check('data flow', d.dataFlow?.properties?.name === 'Checkout' && d.dataFlow?.domain?.domain?.urn === 'urn:li:domain:sales');
  const io = d.dataJob?.inputOutput;
  check(
    'planned lineage (job input/output)',
    io?.inputDatasets?.[0]?.urn === ds('f2_verify') && io?.outputDatasets?.[0]?.urn === site('f2-verify'),
    io,
  );
  check(
    'data product + assets + link',
    d.dataProduct?.properties?.name === 'F2 verify' &&
      d.dataProduct?.properties?.numAssets >= 2 &&
      d.dataProduct?.institutionalMemory?.elements?.length > 0,
    d.dataProduct?.properties,
  );
  const found = await datahubQuery<any>(
    settings,
    `{ searchAcrossEntities(input:{query:"f2-verify",types:[DATA_PRODUCT],count:5}){ searchResults{ entity{ urn } } } }`,
  );
  check(
    'appears in search',
    found.searchAcrossEntities.searchResults.some((r: any) => r.entity.urn === product('f2-verify')),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

async function createStep(): Promise<void> {
  const t0 = Date.now();
  const r = await registerBrief(settings, brief('f2-verify', 'f2_verify'), opts('verify-1'));
  console.log(JSON.stringify(r, null, 1));
  console.log(`registerBrief took ${seconds(t0)}`);
  console.log('--- reading everything back');
  await readBack();
}

async function rerunStep(): Promise<void> {
  const t0 = Date.now();
  const r = await registerBrief(settings, brief('f2-verify', 'f2_verify'), opts('verify-2'));
  console.log(JSON.stringify(r, null, 1));
  console.log(`registerBrief took ${seconds(t0)}`);
  check('idempotent: nothing created, 5 updated', r.created.length === 0 && r.updated.length === 5);
}

async function deprecateStep(): Promise<void> {
  const a = { actorEmail: 'javi.villar@gmail.com', authorize: async () => {} };
  const read = async () =>
    (await datahubQuery<{ dataset: { deprecation: unknown } }>(settings, `query($u:String!){ dataset(urn:$u){ deprecation{ deprecated note } } }`, { u: ds('f2_verify') })).dataset.deprecation;
  await deprecateAsset(settings, ds('f2_verify'), 'verification', a);
  console.log('deprecated ->', JSON.stringify(await read()));
  await deprecateAsset(settings, ds('f2_verify'), '', { ...a, deprecated: false });
  console.log('undeprecated ->', JSON.stringify(await read()));
}

async function rollbackStep(): Promise<void> {
  const inner = global.fetch;
  // Inject a failure on the LAST write (the product), so what was written before it must be undone.
  global.fetch = (async (u: string | URL | Request, init?: RequestInit) =>
    String(u).includes('/openapi/v3/entity/dataProduct') && init?.method === 'POST'
      ? new Response('boom', { status: 500 })
      : inner(u, init)) as typeof fetch;
  try {
    await registerBrief(settings, brief('f2-verify-rb', 'f2_verify_rb'), opts('verify-rb'));
    check('rollback: the injected failure was raised', false);
  } catch (e) {
    console.log('failed as injected ->', (e as Error).message.slice(0, 220));
  }
  global.fetch = inner;
  const gone = [
    await hidden('dataset', ds('f2_verify_rb')),
    await hidden('dataset', site('f2-verify-rb')),
    await hidden('dataFlow', flow('f2-verify-rb')),
    await hidden('dataJob', job('f2-verify-rb')),
  ];
  check('rollback hid (soft-deleted) everything this run created', gone.every(Boolean), gone);
}

async function cleanupStep(): Promise<void> {
  const all: Array<[AssetKind, string]> = [
    ['dataProduct', product('f2-verify')],
    ['dataJob', job('f2-verify')],
    ['dataFlow', flow('f2-verify')],
    ['dataset', site('f2-verify')],
    ['dataset', ds('f2_verify')],
    ['dataJob', job('f2-verify-rb')],
    ['dataFlow', flow('f2-verify-rb')],
    ['dataset', site('f2-verify-rb')],
    ['dataset', ds('f2_verify_rb')],
    ['dataset', 'urn:li:dataset:(urn:li:dataPlatform:postgres,f2_probe.public.probe,PROD)'],
  ];
  for (const [type, urn] of all) {
    assertTestUrn(urn);
    const kind = type as Proposal['entityType'];
    if (await exists(type, urn)) await softDeleteEntity(settings, kind, urn);
    check(`hidden ${urn}`, await hidden(type, urn));
  }
}

const STEPS: Record<string, () => Promise<void>> = {
  create: createStep,
  rerun: rerunStep,
  deprecate: deprecateStep,
  rollback: rollbackStep,
  cleanup: cleanupStep,
};

async function main(): Promise<void> {
  const step = process.argv[2];
  const run = STEPS[step];
  if (!run) throw new Error(`usage: verify_write.ts ${Object.keys(STEPS).join('|')}`);
  const restore = guardWrites();
  try {
    await run();
  } finally {
    restore();
  }
}

main().catch(e => {
  console.error('FAILED:', (e as Error).message);
  process.exit(1);
});
