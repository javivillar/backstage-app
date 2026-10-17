/**
 * What the SBOM tab shows of a CycloneDX document: its components with the ecosystem of each one (the type of its
 * purl: pypi, npm, maven, nuget, deb...), their licenses, and the components of the Refresquito frameworks apart.
 */

export interface Component {
  name: string;
  group?: string;
  version?: string;
  ecosystem: string;
  purl?: string;
  licenses: string[];
}

export interface SbomSummary {
  specVersion?: string;
  generatedAt?: string;
  generator?: string;
  subject?: string;
  total: number;
  ecosystems: Record<string, number>;
  licenses: Record<string, number>;
  /** the packages of the Refresquito frameworks (refresquito-fastapi, refresquito-angular...) */
  frameworks: Component[];
  components: Component[];
}

interface RawLicense {
  license?: { id?: string; name?: string };
  expression?: string;
}

interface RawComponent {
  name?: string;
  group?: string;
  version?: string;
  type?: string;
  purl?: string;
  licenses?: RawLicense[];
  components?: RawComponent[];
}

interface RawBom {
  bomFormat?: string;
  specVersion?: string;
  metadata?: {
    timestamp?: string;
    component?: { name?: string; version?: string };
    tools?: { components?: Array<{ name?: string; version?: string }> } | Array<{ name?: string; version?: string }>;
  };
  components?: RawComponent[];
}

/** The ecosystem of a purl (pkg:pypi/fastapi@1.0 -> pypi); a component without one is named by its CycloneDX type. */
export function ecosystemOf(c: { purl?: string; type?: string }): string {
  const m = /^pkg:([a-z0-9.+-]+)\//i.exec(c.purl ?? '');
  return m ? m[1].toLowerCase() : c.type ?? 'other';
}

function licensesOf(c: RawComponent): string[] {
  return (c.licenses ?? [])
    .map(l => l.expression ?? l.license?.id ?? l.license?.name)
    .filter((v): v is string => !!v);
}

function flatten(components: RawComponent[] = []): RawComponent[] {
  return components.flatMap(c => [c, ...flatten(c.components)]);
}

const count = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

export function summarize(raw: unknown): SbomSummary {
  const bom = raw as RawBom;
  if (!bom || bom.bomFormat !== 'CycloneDX') throw new Error('Not a CycloneDX document');
  const components: Component[] = flatten(bom.components)
    .filter(c => c.name && c.type !== 'file')
    .map(c => ({
      name: c.name as string,
      group: c.group || undefined,
      version: c.version || undefined,
      ecosystem: ecosystemOf(c),
      purl: c.purl,
      licenses: licensesOf(c),
    }))
    .sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name));
  const tools = bom.metadata?.tools;
  const tool = (Array.isArray(tools) ? tools : tools?.components ?? [])[0];
  const subject = bom.metadata?.component;
  return {
    specVersion: bom.specVersion,
    generatedAt: bom.metadata?.timestamp,
    generator: tool?.name ? `${tool.name}${tool.version ? ` ${tool.version}` : ''}` : undefined,
    subject: subject?.name ? `${subject.name}${subject.version ? `@${subject.version}` : ''}` : undefined,
    total: components.length,
    ecosystems: count(components.map(c => c.ecosystem)),
    licenses: count(components.flatMap(c => (c.licenses.length ? c.licenses : ['(none)']))),
    frameworks: components.filter(c => c.name.startsWith('refresquito-')),
    components,
  };
}
