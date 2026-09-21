import { DataBrief, flowUrnOf, normalizeBrief, productUrn, storeRef, storeUrn } from './brief';
import { assetUrl } from './governance';

// "New data product" also links the product into the BACKSTAGE catalog (design §2, §4.3 step 7): a System for the
// product, a Resource per data store and a Component per process, each annotated with the DataHub URN it
// mirrors (`datahub.io/...`). Those annotations are what make the DataHub card and the "Data governance" tab
// appear on the entity, and `metadata.links` puts a DataHub link on the entity's Links card.
//
// Pure: brief in, YAML text out (no I/O, no YAML library: every scalar is JSON, which is valid YAML).

export interface CatalogEntityRef {
  kind: 'System' | 'Resource' | 'Component';
  name: string;
}

export interface CatalogInfo {
  yaml: string;
  readme: string;
  entities: CatalogEntityRef[];
}

const RESOURCE_TYPE: Record<string, string> = {
  postgres: 'database',
  kafka: 'kafka-topic',
  s3: 'object-storage',
  'alfresco-site': 'document-site',
};

/** A valid Backstage entity name: [a-z0-9] with dashes, at most 63 characters. */
export function entityName(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'x').slice(0, 63).replace(/-+$/g, '') || 'x';
}

type Yaml = string | number | boolean | Yaml[] | { [k: string]: Yaml | undefined };

/** Minimal serializer for the shapes used here. Strings via JSON.stringify (always valid YAML). */
function toYaml(v: Yaml | undefined, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (v === undefined) return '';
  if (Array.isArray(v)) {
    if (v.length === 0) return ' []';
    return `\n${v
      .map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item).filter(([, x]) => x !== undefined);
          const [first, ...rest] = entries;
          const head = `${pad}- ${first[0]}:${toYaml(first[1] as Yaml, indent + 2)}`;
          return [head, ...rest.map(([k, x]) => `${pad}  ${k}:${toYaml(x as Yaml, indent + 2)}`)].join('\n');
        }
        return `${pad}- ${toYaml(item, indent + 1).trimStart()}`;
      })
      .join('\n')}`;
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return ' {}';
    return `\n${entries.map(([k, x]) => `${pad}${k}:${toYaml(x as Yaml, indent + 1)}`).join('\n')}`;
  }
  return ` ${JSON.stringify(v)}`;
}

const doc = (o: Record<string, Yaml | undefined>): string => `${toYaml(o as Yaml, 0).replace(/^\n/, '')}\n`;

export interface CatalogInfoOptions {
  /** Entity ref that owns the entities (the person who launched the template), e.g. user:default/ana. */
  ownerRef: string;
  /** DataHub UI base URL, for the link on each entity. */
  publicUrl: string;
}

export function buildCatalogInfo(rawBrief: DataBrief, opts: CatalogInfoOptions): CatalogInfo {
  const brief = normalizeBrief(rawBrief);
  const slug = entityName(brief.slug);
  const productId = productUrn(brief);
  const link = (type: 'dataset' | 'dataProduct' | 'dataFlow', urn: string) => ({ url: assetUrl(opts.publicUrl, type, urn), title: 'DataHub', icon: 'dashboard' });
  const base = { apiVersion: 'backstage.io/v1alpha1' };
  const docs: string[] = [];
  const entities: CatalogEntityRef[] = [];

  docs.push(
    doc({
      ...base,
      kind: 'System',
      metadata: {
        name: slug,
        title: brief.name,
        description: brief.description,
        annotations: { 'datahub.io/data-product': productId },
        links: [link('dataProduct', productId)],
      },
      spec: { owner: opts.ownerRef },
    }),
  );
  entities.push({ kind: 'System', name: slug });

  const used = new Set<string>([slug]);
  const unique = (n: string): string => {
    let name = n;
    for (let i = 2; used.has(name); i++) name = `${n.slice(0, 60)}-${i}`;
    used.add(name);
    return name;
  };

  for (const s of brief.stores) {
    const urn = storeUrn(s);
    const label = s.kind === 'postgres' ? `${s.database}.${s.schema}.${s.table}` : (s.name ?? storeRef(s));
    const name = unique(entityName(`${slug}-${s.kind === 'postgres' ? s.table : s.name}`));
    docs.push(
      doc({
        ...base,
        kind: 'Resource',
        metadata: {
          name,
          title: label,
          description: s.description,
          annotations: { 'datahub.io/dataset': urn },
          links: [link('dataset', urn)],
        },
        spec: { type: RESOURCE_TYPE[s.kind] ?? 'database', owner: opts.ownerRef, system: slug },
      }),
    );
    entities.push({ kind: 'Resource', name });
  }

  for (const p of brief.processes ?? []) {
    const flow = flowUrnOf(p);
    const name = unique(entityName(`${slug}-${p.id}`));
    docs.push(
      doc({
        ...base,
        kind: 'Component',
        metadata: {
          name,
          title: p.name,
          description: `${p.engine} process ${p.id}`,
          annotations: { 'datahub.io/flow': flow, 'datahub.io/data-product': productId },
          links: [link('dataFlow', flow)],
        },
        spec: { type: 'process', lifecycle: 'production', owner: opts.ownerRef, system: slug },
      }),
    );
    entities.push({ kind: 'Component', name });
  }

  const readme = [
    `# ${brief.name}`,
    '',
    brief.description,
    '',
    'Data product registered from Backstage ("New data product"). The governance metadata (owners, classification,',
    'retention, lawful basis, lineage) lives in DataHub; the entities in `catalog-info.yaml` mirror it in the',
    'Backstage catalog and are annotated with the DataHub URN they correspond to (`datahub.io/...`).',
    '',
    `- DataHub: ${assetUrl(opts.publicUrl, 'dataProduct', productId)}`,
    ...entities.map(e => `- ${e.kind} \`${e.name}\``),
    '',
  ].join('\n');

  return { yaml: docs.join('---\n'), readme, entities };
}
