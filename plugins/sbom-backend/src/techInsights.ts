import { createBackendModule } from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  FactRetriever,
  FactRetrieverContext,
  TechInsightFact,
  techInsightsFactRetrieversExtensionPoint,
} from '@backstage-community/plugin-tech-insights-node';
import type { Component, SbomSummary } from './cyclonedx';
import type { ImageScan } from './vulnerabilities';

/**
 * Facts of the scorecard "Quality & Security" (Tech Insights) about what an application of the platform runs: the
 * SBOM of its images, their vulnerabilities in Wazuh's last image scan, and the line of the Python Framework it is
 * built on, compared with the latest line of the catalog. Read through the API of the SBOM tab (plugin sbom), with
 * the credentials of this backend.
 *
 * An application is a Component with the annotation refresquito.io/sbom-images or refresquito.io/framework-line that
 * is not itself a line of the framework (type library, tag framework-line). The checks are in app-config
 * (techInsights.factChecker.checks, chart cnoe-oneke).
 */

export const ANNOTATION_SBOM_IMAGES = 'refresquito.io/sbom-images';
export const ANNOTATION_FRAMEWORK_LINE = 'refresquito.io/framework-line';
/** the packages that say which line of the framework an image carries */
const FRAMEWORK_PACKAGES = ['refresquito-fastapi', 'refresquito-angular'];

export interface ImageFacts {
  ref: string;
  /** null: the image has no SBOM attached; undefined: it could not be read */
  sbom?: SbomSummary | null;
  /** configured false: this Backstage reads no image scan (sbom.vulnerabilitiesUrl) */
  scan?: { configured: boolean; scan: ImageScan | null };
}

const list = (entity: Entity, key: string) =>
  (entity.metadata.annotations?.[key] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export const isFrameworkLine = (e: Entity) =>
  e.kind.toLowerCase() === 'component' && (e.metadata.tags ?? []).includes('framework-line');

export const isApplication = (e: Entity) =>
  e.kind.toLowerCase() === 'component' &&
  !isFrameworkLine(e) &&
  (list(e, ANNOTATION_SBOM_IMAGES).length > 0 || !!e.metadata.annotations?.[ANNOTATION_FRAMEWORK_LINE]);

/** "3.1" < "3.10": compared by number, part by part */
export function compareLines(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** the lines of the framework the catalog keeps (only the maintained ones are there), the latest last */
export function frameworkLines(entities: Entity[]): string[] {
  const lines = entities
    .filter(isFrameworkLine)
    .map(e => e.metadata.annotations?.[ANNOTATION_FRAMEWORK_LINE])
    .filter((l): l is string => !!l);
  return [...new Set(lines)].sort(compareLines);
}

const lineOf = (version?: string) => (version ?? '').split('.').slice(0, 2).join('.');

/** The facts of one application, from what its images say. */
export function applicationFacts(entity: Entity, lines: string[], images: ImageFacts[]): TechInsightFact['facts'] {
  const line = entity.metadata.annotations?.[ANNOTATION_FRAMEWORK_LINE] ?? '';
  const latest = lines[lines.length - 1] ?? '';
  const withSbom = images.filter(i => i.sbom);
  const framework: Component[] = withSbom.flatMap(i => i.sbom!.frameworks ?? []).filter(c => FRAMEWORK_PACKAGES.includes(c.name));
  const scans = images.map(i => i.scan?.scan).filter((s): s is ImageScan => !!s && s.status === 'scanned');
  const vulns = scans.flatMap(s => s.vulns ?? []);
  const count = (sev: string, fixable: boolean) =>
    vulns.filter(v => v.sev?.toUpperCase() === sev && (!fixable || !!v.fix)).length;
  return {
    imageCount: images.length,
    sbomOnEveryImage: images.length > 0 && withSbom.length === images.length,
    imagesScanned: images.length > 0 && scans.length === images.length,
    critical: count('CRITICAL', false),
    criticalWithFix: count('CRITICAL', true),
    high: count('HIGH', false),
    highWithFix: count('HIGH', true),
    frameworkLine: line,
    latestFrameworkLine: latest,
    onLatestFrameworkLine: !!line && line === latest,
    frameworkLineMaintained: !!line && lines.includes(line),
    // the images carry the line the application says it is on (the packages of the framework in their SBOM)
    imagesMatchFrameworkLine: !!line && framework.length > 0 && framework.every(c => lineOf(c.version) === line),
    frameworkInImages: [...new Set(framework.map(c => `${c.name} ${c.version ?? '?'}`))].sort().join(', '),
  };
}

export const supplyChainFactRetriever: FactRetriever = {
  id: 'refresquitoSupplyChainFactRetriever',
  version: '0.1.0',
  title: 'Images and framework of the application',
  description:
    'SBOM and vulnerabilities (Wazuh image scan) of the images an application runs, and the line of the Python Framework it is built on',
  entityFilter: [{ kind: 'component' }],
  schema: {
    imageCount: { type: 'integer', description: 'Images the application runs (annotation refresquito.io/sbom-images)' },
    sbomOnEveryImage: { type: 'boolean', description: 'Every image has its SBOM attached in the registry' },
    imagesScanned: { type: 'boolean', description: "Every image is in Wazuh's last image scan" },
    critical: { type: 'integer', description: 'CRITICAL vulnerabilities of its images' },
    criticalWithFix: { type: 'integer', description: 'CRITICAL vulnerabilities with a fixed version available' },
    high: { type: 'integer', description: 'HIGH vulnerabilities of its images' },
    highWithFix: { type: 'integer', description: 'HIGH vulnerabilities with a fixed version available' },
    frameworkLine: { type: 'string', description: 'Line of the Python Framework it is built on' },
    latestFrameworkLine: { type: 'string', description: 'Latest line of the Python Framework in the catalog' },
    onLatestFrameworkLine: { type: 'boolean', description: 'It is built on the latest line' },
    frameworkLineMaintained: { type: 'boolean', description: 'Its line is still maintained (in the catalog)' },
    imagesMatchFrameworkLine: { type: 'boolean', description: 'The framework packages in its images are of its line' },
    frameworkInImages: { type: 'string', description: 'Framework packages found in the SBOMs of its images' },
  },
  async handler(ctx: FactRetrieverContext): Promise<TechInsightFact[]> {
    const { discovery, auth, logger } = ctx;
    const credentials = await auth.getOwnServiceCredentials();
    const tokenFor = async (targetPluginId: string) =>
      (await auth.getPluginRequestToken({ onBehalfOf: credentials, targetPluginId })).token;

    const catalog = new CatalogClient({ discoveryApi: discovery, fetchApi: { fetch } });
    const { items } = await catalog.getEntities({ filter: { kind: 'component' } }, { token: await tokenFor('catalog') });
    const lines = frameworkLines(items);
    const apps = items.filter(isApplication);
    if (!apps.length) return [];

    const sbomBase = await discovery.getBaseUrl('sbom');
    const sbomToken = await tokenFor('sbom');
    const get = async <T>(path: string, ref: string): Promise<T | undefined> => {
      const res = await fetch(`${sbomBase}${path}?ref=${encodeURIComponent(ref)}`, {
        headers: { Authorization: `Bearer ${sbomToken}` },
      });
      if (!res.ok) {
        logger.warn(`tech-insights: ${path} of ${ref} answered ${res.status}`);
        return undefined;
      }
      return (await res.json()) as T;
    };

    const facts: TechInsightFact[] = [];
    for (const entity of apps) {
      const images: ImageFacts[] = [];
      for (const ref of list(entity, ANNOTATION_SBOM_IMAGES)) {
        const sbom = await get<{ summary: SbomSummary | null }>('/image', ref);
        const scan = await get<{ configured: boolean; scan: ImageScan | null }>('/vulnerabilities', ref);
        images.push({ ref, sbom: sbom ? sbom.summary : undefined, scan });
      }
      facts.push({
        entity: { namespace: entity.metadata.namespace ?? 'default', kind: entity.kind, name: entity.metadata.name },
        facts: applicationFacts(entity, lines, images),
      });
      logger.debug(`tech-insights: facts of ${stringifyEntityRef(entity)}`);
    }
    return facts;
  },
};

/** Adds the fact retriever to Tech Insights; when it runs is in app-config (techInsights.factRetrievers). */
export const techInsightsModuleSupplyChain = createBackendModule({
  pluginId: 'tech-insights',
  moduleId: 'refresquito-supply-chain',
  register(env) {
    env.registerInit({
      deps: { providers: techInsightsFactRetrieversExtensionPoint },
      async init({ providers }) {
        providers.addFactRetrievers({ refresquitoSupplyChainFactRetriever: supplyChainFactRetriever });
      },
    });
  },
});
