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
import type { ImageComponent, ImageScan } from './vulnerabilities';
import { QualityReport, qualityFacts } from './quality';
import { governanceFactRetriever } from './governance';
import { Exceptions } from './exceptions';

/**
 * Facts of the scorecard "Quality & Security" (Tech Insights) about what an application of the platform runs: the
 * SBOM of its images, their vulnerabilities in Wazuh's last image scan, the line of the Python Framework it is built
 * on, compared with the latest line of the catalog, and the quality report of its commit (tests, coverage, linters). Read through the API of the SBOM tab (plugin sbom), with
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
  /** null: no quality report attached; undefined: it could not be read */
  quality?: QualityReport | null;
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
    .map(e => normalizeLine(e.metadata.annotations?.[ANNOTATION_FRAMEWORK_LINE]))
    .filter(Boolean);
  return [...new Set(lines)].sort(compareLines);
}

const lineOf = (version?: string) => (version ?? '').split('.').slice(0, 2).join('.');

/** "3.1", also when written as the component of the line (python-framework-3-1) */
export function normalizeLine(value?: string): string {
  const m = /(\d+)[.-](\d+)$/.exec((value ?? '').trim());
  return m ? `${m[1]}.${m[2]}` : '';
}

export const ANNOTATION_REPOSITORY = 'refresquito.io/repository';
export const ANNOTATION_APPLICATION = 'refresquito.io/application';

/** ghcr.io/o/petstore-api:abc (or @sha256:...) -> petstore-api */
const imageName = (ref: string) => ref.split('@')[0].replace(/:[^/:]*$/, '').split('/').pop() ?? '';

/**
 * The images the application builds itself, where its CI attaches the quality report: the ones named after its
 * repository (refresquito.io/repository javivillar/animalshelter: animalshelter-api, animalshelter-web), or after the
 * application when it says no repository. The platform images it also runs (refresquito-postgres, a line of the
 * framework) carry no report of the application; their SBOM and vulnerabilities still count. Without a name, or when
 * none matches, every image.
 */
export function ownImages(entity: Entity, images: ImageFacts[]): ImageFacts[] {
  const annotations = entity.metadata.annotations ?? {};
  const name = (annotations[ANNOTATION_REPOSITORY] ?? '').split('/').pop()?.trim() || (annotations[ANNOTATION_APPLICATION] ?? '').trim();
  if (!name) return images;
  const own = images.filter(i => {
    const image = imageName(i.ref);
    return image === name || image.startsWith(`${name}-`);
  });
  return own.length ? own : images;
}

/** The facts of one application, from what its images say. */
export function applicationFacts(entity: Entity, lines: string[], images: ImageFacts[]): TechInsightFact['facts'] {
  const line = normalizeLine(entity.metadata.annotations?.[ANNOTATION_FRAMEWORK_LINE]);
  const latest = lines[lines.length - 1] ?? '';
  const withSbom = images.filter(i => i.sbom);
  const framework: Component[] = withSbom.flatMap(i => i.sbom!.frameworks ?? []).filter(c => FRAMEWORK_PACKAGES.includes(c.name));
  // the approved exceptions of its commit (quality report, part exceptions): their findings leave the checks.
  // The report is the one its CI attaches to the images it builds: a platform image it also runs has none
  const own = ownImages(entity, images);
  const report = own.length > 0 && own.every(i => i.quality) ? own[0].quality! : undefined;
  const exc = new Exceptions(report?.exceptions);
  // the findings that count: not a kernel package of the image (Wazuh: not_applicable), not excepted for that image
  const counted = images.flatMap(i => {
    const s = i.scan?.scan;
    if (!s || s.status !== 'scanned') return [];
    return [{ ref: i.ref, scan: { ...s, vulns: (s.vulns ?? []).filter(v => !v.not_applicable && !exc.vulnerability(v.id, i.ref)) } }];
  });
  const scans = counted.map(c => c.scan);
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
    ...contextFacts(scans, images.length),
    // the OS of its images (Wazuh, wazuh-oneke 0.21.0: Trivy EOSL): -1 when an image is not scanned or its scan
    // does not say it
    osEndOfLife:
      images.length > 0 && scans.length === images.length && scans.every(s => typeof s.os_eol === 'boolean')
        ? counted.filter(c => c.scan.os_eol && !exc.osEol(c.ref)).length
        : -1,
    // the runtimes and servers of its images (Wazuh, wazuh-oneke 0.23.0: endoflife.date): -1 when an image is not
    // scanned or its scan does not say them
    ...componentFacts(scans, images.length),
    // the license policy on the dependencies of its images (SBOM): distinct packages; -1 when an image has no SBOM
    ...licenseFacts(images, exc),
    // the quality report of its commit (the CI attaches the same one to every image it builds): it counts when they all have it
    ...qualityFacts(report, exc),
    ...exceptionFacts(exc, report),
  };
}

/**
 * The runtimes and servers of its images out of support (wazuh-oneke 0.23.0, USE-CASES.md I10), distinct by product
 * and release over its images: Node.js 18, Python 3.8, PostgreSQL 12... A Go toolchain (the Go a binary was built
 * with) is counted apart: only the vendor of that binary can rebuild it.
 */
export function componentFacts(scans: ImageScan[], imageCount: number) {
  const known = imageCount > 0 && scans.length === imageCount && scans.every(s => Array.isArray(s.components));
  const all = scans.flatMap(s => s.components ?? []);
  const distinct = (pred: (c: ImageComponent) => boolean) =>
    new Set(all.filter(pred).map(c => `${c.label ?? c.product} ${c.release ?? c.version}`));
  const eol = distinct(c => c.status === 'eol' && c.source !== 'go');
  const soon = distinct(c => c.status === 'soon' && c.source !== 'go');
  const toolchains = distinct(c => c.status === 'eol' && c.source === 'go');
  return {
    componentsEndOfLife: known ? eol.size : -1,
    componentsEndingSoon: known ? soon.size : -1,
    toolchainsEndOfLife: known ? toolchains.size : -1,
    componentsOutOfSupport: [...eol].sort().join(', '),
  };
}

/**
 * The context of its vulnerabilities, as Wazuh computes it (wazuh-oneke 0.20.0, USE-CASES.md I6): CVEs in CISA KEV,
 * highest EPSS, and the days the oldest fixable CRITICAL / HIGH has been open in its image repositories. Nothing is
 * computed here but the maximum over its images; the SLA thresholds are the checks (app-config). vulnContext false
 * (an image not scanned, a scan without context or without the KEV feed): the numbers are -1 and the checks fail.
 */
const EXPOSURE_RANK: Record<string, number> = { none: 0, internal: 1, host: 2, external: 3 };

export function contextFacts(scans: ImageScan[], imageCount: number) {
  const known = imageCount > 0 && scans.length === imageCount && scans.every(s => s.context && s.context.kev !== null && s.context.kev !== undefined);
  if (!known) {
    return {
      vulnContext: false, knownExploited: -1, knownExploitedRansomware: -1, knownExploitedIds: '', epssMax: -1,
      criticalFixMaxDays: -1, highFixMaxDays: -1, criticalFixInUseMaxDays: -1, highFixInUseMaxDays: -1,
      knownExploitedInUse: -1, criticalNotInUse: -1, criticalNetworkExposed: -1, exposure: '',
    };
  }
  // From the findings Wazuh gives (their age, fix, in use, attack vector): the ones of applicationFacts, that is without
  // the kernel packages and the excepted ones. Nothing is judged here but the maximum and the count.
  const vulns = scans.flatMap(s => s.vulns ?? []);
  const sev = (v: { sev?: string }, s: string) => v.sev?.toUpperCase() === s;
  const kev = [...new Set(vulns.filter(v => v.kev).map(v => v.id))].sort();
  const oldest = (pred: (v: (typeof vulns)[number]) => boolean) => Math.max(-1, ...vulns.filter(pred).map(v => v.age_days ?? 0));
  const inUse = (v: { in_use?: string }) => v.in_use !== 'no';
  const outside = (s: ImageScan) => ['external', 'host'].includes(s.exposure?.level ?? s.context?.exposure ?? '');
  return {
    vulnContext: true,
    knownExploited: kev.length,
    knownExploitedRansomware: new Set(vulns.filter(v => v.kev_ransomware).map(v => v.id)).size,
    knownExploitedIds: kev.join(', '),
    epssMax: Math.max(-1, ...vulns.map(v => v.epss ?? -1)),
    criticalFixMaxDays: oldest(v => sev(v, 'CRITICAL') && !!v.fix),
    highFixMaxDays: oldest(v => sev(v, 'HIGH') && !!v.fix),
    // in use (USE-CASES.md I7 of wazuh-oneke): unknown counts as in use
    criticalFixInUseMaxDays: oldest(v => sev(v, 'CRITICAL') && !!v.fix && inUse(v)),
    highFixInUseMaxDays: oldest(v => sev(v, 'HIGH') && !!v.fix && inUse(v)),
    knownExploitedInUse: new Set(vulns.filter(v => v.kev && inUse(v)).map(v => v.id)).size,
    criticalNotInUse: new Set(vulns.filter(v => sev(v, 'CRITICAL') && v.in_use === 'no').map(v => v.id)).size,
    criticalNetworkExposed: new Set(
      scans.filter(outside).flatMap(s => (s.vulns ?? []).filter(v => sev(v, 'CRITICAL') && v.av === 'N' && inUse(v)).map(v => v.id)),
    ).size,
    // the most exposed of its images
    exposure: scans
      .map(s => s.exposure?.level ?? s.context?.exposure ?? '')
      .reduce((a, b) => (EXPOSURE_RANK[b] ?? -1) > (EXPOSURE_RANK[a] ?? -1) ? b : a, ''),
  };
}

export function licenseFacts(images: ImageFacts[], exc: Exceptions = new Exceptions(undefined)) {
  const reports = images.map(i => i.sbom?.licensePolicy);
  if (!images.length || reports.some(r => !r)) return { deniedLicenses: -1, unknownLicenses: -1, deniedLicenseIds: '' };
  const key = (f: { ecosystem: string; name: string; version?: string }) => `${f.ecosystem}:${f.name}@${f.version ?? ''}`;
  const keep = (f: { name: string }) => !exc.license(f.name);
  const denied = new Map(reports.flatMap(r => r!.denied).filter(keep).map(f => [key(f), f]));
  const unknown = new Set(reports.flatMap(r => r!.unknown).filter(keep).map(key));
  return {
    deniedLicenses: denied.size,
    unknownLicenses: unknown.size,
    deniedLicenseIds: [...denied.values()].map(f => `${f.name} ${f.version ?? ''} (${(f.denied ?? []).join(', ')})`).join('; '),
  };
}

/** The exceptions themselves: how many apply, how many are invalid, how many expire within 30 days. */
export function exceptionFacts(exc: Exceptions, report: QualityReport | undefined) {
  if (!report) return { securityExceptions: -1, securityExceptionsInvalid: -1, securityExceptionsExpiring: -1, securityExceptionIds: '' };
  return {
    securityExceptions: exc.active.length,
    securityExceptionsInvalid: exc.invalid.length,
    securityExceptionsExpiring: exc.expiring().length,
    securityExceptionIds: exc.active.map(e => `${e.check} ${e.id} (until ${e.expires})`).join('; '),
  };
}

export const supplyChainFactRetriever: FactRetriever = {
  id: 'refresquitoSupplyChainFactRetriever',
  version: '0.7.0',
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
    vulnContext: {
      type: 'boolean',
      description: 'Every image is scanned and Wazuh gave the context of its vulnerabilities (EPSS, KEV, age)',
    },
    knownExploited: { type: 'integer', description: 'CVEs of CISA KEV (exploited in the wild) in its images; -1: unknown' },
    knownExploitedRansomware: { type: 'integer', description: 'Of them, used by ransomware campaigns; -1: unknown' },
    knownExploitedIds: { type: 'string', description: 'The CVEs of CISA KEV in its images' },
    epssMax: { type: 'float', description: 'Highest EPSS score (probability of exploitation) of its vulnerabilities; -1: unknown' },
    criticalFixMaxDays: {
      type: 'integer',
      description: 'Days the oldest fixable CRITICAL has been open in its image repositories; -1: none (or unknown)',
    },
    highFixMaxDays: {
      type: 'integer',
      description: 'Days the oldest fixable HIGH has been open in its image repositories; -1: none (or unknown)',
    },
    criticalFixInUseMaxDays: {
      type: 'integer',
      description: 'Days the oldest fixable CRITICAL whose package is in use (or unknown) has been open; -1: none',
    },
    highFixInUseMaxDays: {
      type: 'integer',
      description: 'Days the oldest fixable HIGH whose package is in use (or unknown) has been open; -1: none',
    },
    knownExploitedInUse: { type: 'integer', description: 'CVEs of CISA KEV whose package is in use (or unknown); -1: unknown' },
    criticalNotInUse: { type: 'integer', description: 'CRITICAL CVEs whose package no process of its images has loaded' },
    criticalNetworkExposed: {
      type: 'integer',
      description: 'CRITICAL CVEs attackable over the network, in use, on images reachable from outside the cluster',
    },
    exposure: { type: 'string', description: 'The most exposed of its images: external, host, internal or none' },
    frameworkLine: { type: 'string', description: 'Line of the Python Framework it is built on' },
    latestFrameworkLine: { type: 'string', description: 'Latest line of the Python Framework in the catalog' },
    onLatestFrameworkLine: { type: 'boolean', description: 'It is built on the latest line' },
    frameworkLineMaintained: { type: 'boolean', description: 'Its line is still maintained (in the catalog)' },
    imagesMatchFrameworkLine: { type: 'boolean', description: 'The framework packages in its images are of its line' },
    frameworkInImages: { type: 'string', description: 'Framework packages found in the SBOMs of its images' },
    qualityReport: { type: 'boolean', description: 'Every image the application builds has the quality report of its commit attached' },
    testsFailed: { type: 'integer', description: 'Tests that failed or errored (backend and frontend); -1: not reported' },
    backendCoverage: { type: 'float', description: 'Line coverage of the backend tests (%); -1: not reported' },
    frontendCoverage: { type: 'float', description: 'Line coverage of the frontend tests (%); -1: not reported' },
    lintIssues: { type: 'integer', description: 'ruff issues plus eslint errors; -1: not reported' },
    typeErrors: { type: 'integer', description: 'mypy errors of the backend; -1: not reported' },
    qualityRevision: { type: 'string', description: 'Commit of the quality report' },
    osEndOfLife: { type: 'integer', description: 'Images whose OS is out of support (no more security fixes); -1: unknown' },
    componentsEndOfLife: {
      type: 'integer',
      description: 'Runtimes and servers of its images out of support (Node.js, Python, PostgreSQL... of a release with no more fixes; endoflife.date); -1: unknown',
    },
    componentsEndingSoon: { type: 'integer', description: 'Runtimes and servers of its images whose support ends within 90 days; -1: unknown' },
    toolchainsEndOfLife: { type: 'integer', description: 'Go toolchains out of support its binaries were built with; -1: unknown' },
    componentsOutOfSupport: { type: 'string', description: 'The runtimes and servers out of support, with their release' },
    deniedLicenses: {
      type: 'integer',
      description: 'Dependencies of the application with a license the policy denies (GPL, AGPL...); -1: an image has no SBOM',
    },
    unknownLicenses: { type: 'integer', description: 'Dependencies of the application with no license in the SBOM; -1: an image has no SBOM' },
    deniedLicenseIds: { type: 'string', description: 'The dependencies with a denied license, and which' },
    securityExceptions: { type: 'integer', description: 'Approved security exceptions that apply now; -1: no quality report' },
    securityExceptionsInvalid: { type: 'integer', description: 'Invalid entries of platform/security-exceptions.yaml (they do not apply); -1: no quality report' },
    securityExceptionsExpiring: { type: 'integer', description: 'Security exceptions that expire within 30 days; -1: no quality report' },
    securityExceptionIds: { type: 'string', description: 'The security exceptions that apply, and until when' },
    unauthenticatedEndpoints: {
      type: 'integer',
      description: 'Operations of the API with no authentication that are not declared public; -1: not reported',
    },
    sastIssues: {
      type: 'integer',
      description: 'Static analysis of the code: Bandit HIGH and MEDIUM plus the eslint rules of security; -1: not reported',
    },
    secretsFound: {
      type: 'integer',
      description: 'Secrets in the git history (gitleaks) and in the images (Trivy); -1: not reported',
    },
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
        const quality = await get<{ report: QualityReport | null }>('/quality', ref);
        images.push({ ref, sbom: sbom ? sbom.summary : undefined, scan, quality: quality ? quality.report : undefined });
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
        providers.addFactRetrievers({
          refresquitoSupplyChainFactRetriever: supplyChainFactRetriever,
          refresquitoDataGovernanceFactRetriever: governanceFactRetriever,
        });
      },
    });
  },
});
