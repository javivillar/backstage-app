import { Entity } from '@backstage/catalog-model';
import { applicationFacts, compareLines, frameworkLines, isApplication, normalizeLine } from './techInsights';
import type { QualityReport } from './quality';
import type { SbomSummary } from './cyclonedx';
import type { ImageScan } from './vulnerabilities';

const component = (name: string, annotations: Record<string, string> = {}, tags: string[] = []): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, annotations, tags },
  spec: { type: 'service', owner: 'group:default/team', lifecycle: 'production' },
});

const line = (l: string) => component(`python-framework-${l.replace('.', '-')}`, { 'refresquito.io/framework-line': l }, ['framework', 'framework-line']);

const app = component('petstore-oneke', {
  'refresquito.io/framework-line': '3.1',
  'refresquito.io/sbom-images': 'ghcr.io/o/petstore-api:abc,ghcr.io/o/petstore-web:abc',
});

const sbom = (frameworks: Array<[string, string]>): SbomSummary => ({
  total: 1,
  ecosystems: {},
  licenses: {},
  components: [],
  frameworks: frameworks.map(([name, version]) => ({ name, version, ecosystem: 'pypi', licenses: [] })),
});

const scan = (vulns: ImageScan['vulns']): { configured: boolean; scan: ImageScan } => ({
  configured: true,
  scan: { digest: 'sha256:1', status: 'scanned', counts: {}, vulns },
});

describe('framework lines', () => {
  it('orders the lines by number', () => {
    expect(compareLines('3.10', '3.9')).toBeGreaterThan(0);
    expect(frameworkLines([line('3.1'), line('2.0'), line('3.0'), app])).toEqual(['2.0', '3.0', '3.1']);
  });

  it('reads a line written as its component too', () => {
    expect(normalizeLine('3.1')).toBe('3.1');
    expect(normalizeLine('python-framework-3-1')).toBe('3.1');
    expect(normalizeLine('')).toBe('');
    const old = component('a', { 'refresquito.io/framework-line': 'python-framework-3-1' });
    expect(applicationFacts(old, ['3.0', '3.1'], [])).toMatchObject({ frameworkLine: '3.1', onLatestFrameworkLine: true });
  });

  it('tells an application from a line of the framework', () => {
    expect(isApplication(app)).toBe(true);
    expect(isApplication(line('3.1'))).toBe(false);
    expect(isApplication(component('keycloak-oneke'))).toBe(false);
  });
});

describe('facts of an application', () => {
  const lines = ['2.0', '3.0', '3.1'];

  it('on the latest line, with SBOMs and a scan', () => {
    const facts = applicationFacts(app, lines, [
      {
        ref: 'api',
        sbom: sbom([['refresquito-fastapi', '3.1.0']]),
        scan: scan([{ id: 'CVE-1', sev: 'HIGH' }]),
      },
      {
        ref: 'web',
        sbom: sbom([['refresquito-angular', '3.1.0']]),
        scan: scan([
          { id: 'CVE-2', sev: 'CRITICAL', fix: '1.2' },
          { id: 'CVE-3', sev: 'CRITICAL' },
          { id: 'CVE-4', sev: 'HIGH', fix: '2.0' },
        ]),
      },
    ]);
    expect(facts).toMatchObject({
      imageCount: 2,
      sbomOnEveryImage: true,
      imagesScanned: true,
      critical: 2,
      criticalWithFix: 1,
      high: 2,
      highWithFix: 1,
      frameworkLine: '3.1',
      latestFrameworkLine: '3.1',
      onLatestFrameworkLine: true,
      frameworkLineMaintained: true,
      imagesMatchFrameworkLine: true,
      frameworkInImages: 'refresquito-angular 3.1.0, refresquito-fastapi 3.1.0',
    });
  });

  it('an image without SBOM or scan, on an old line its images do not match', () => {
    const old = component('orders-oneke', { 'refresquito.io/framework-line': '3.0', 'refresquito.io/sbom-images': 'a,b' });
    const facts = applicationFacts(old, lines, [
      { ref: 'a', sbom: sbom([['refresquito-fastapi', '3.1.0']]), scan: { configured: true, scan: null } },
      { ref: 'b', sbom: null, scan: { configured: false, scan: null } },
    ]);
    expect(facts).toMatchObject({
      sbomOnEveryImage: false,
      imagesScanned: false,
      onLatestFrameworkLine: false,
      frameworkLineMaintained: true,
      imagesMatchFrameworkLine: false,
    });
  });

  it('a line that left the catalog is no longer maintained', () => {
    const legacy = component('legacy-oneke', { 'refresquito.io/framework-line': '0.1' });
    expect(applicationFacts(legacy, lines, [])).toMatchObject({
      imageCount: 0,
      sbomOnEveryImage: false,
      frameworkLineMaintained: false,
      onLatestFrameworkLine: false,
    });
  });
});

describe('context of the vulnerabilities (Wazuh)', () => {
  const withContext = (vulns: ImageScan['vulns'], context: ImageScan['context']) => ({
    configured: true,
    scan: { digest: 'sha256:1', status: 'scanned' as const, counts: {}, vulns, context },
  });

  it('known exploited CVEs once across images, the maximum of the ages and of EPSS', () => {
    const facts = applicationFacts(app, ['3.1'], [
      {
        ref: 'api',
        scan: withContext(
          [
            { id: 'CVE-2023-44487', sev: 'HIGH', fix: '1.1', kev: true, epss: 0.99, age_days: 12 },
            { id: 'CVE-1', sev: 'CRITICAL', fix: '2', kev: false, age_days: 3 },
          ],
          { kev: 1, epss_max: 0.99, critical_fix_max_days: 3, high_fix_max_days: 12 },
        ),
      },
      {
        ref: 'web',
        scan: withContext(
          [
            { id: 'CVE-2023-44487', sev: 'LOW', kev: true, kev_ransomware: true },
            { id: 'CVE-2', sev: 'CRITICAL', fix: '3', kev: false, age_days: 9 },
          ],
          { kev: 1, epss_max: 0.5, critical_fix_max_days: 9, high_fix_max_days: -1 },
        ),
      },
    ]);
    expect(facts).toMatchObject({
      vulnContext: true,
      knownExploited: 1,
      knownExploitedRansomware: 1,
      knownExploitedIds: 'CVE-2023-44487',
      epssMax: 0.99,
      criticalFixMaxDays: 9,
      highFixMaxDays: 12,
    });
  });

  it('in use and exposure: the short SLA only for what is in use (or unknown), the most exposed image', () => {
    const facts = applicationFacts(app, ['3.1'], [
      {
        ref: 'api',
        scan: {
          configured: true,
          scan: {
            digest: 'sha256:1', status: 'scanned', counts: {},
            vulns: [
              { id: 'CVE-1', sev: 'CRITICAL', fix: '2', kev: false, in_use: 'no', age_days: 40 },
              { id: 'CVE-2', sev: 'CRITICAL', fix: '2', kev: true, in_use: 'yes', age_days: 3 },
            ],
            context: { kev: 1, critical_fix_max_days: 40, high_fix_max_days: -1, critical_fix_inuse_max_days: 3,
                       high_fix_inuse_max_days: -1, critical_network_exposed: 1 },
            exposure: { level: 'external', via: ['ingress a/b'] },
          },
        },
      },
      { ref: 'web', scan: withContext([{ id: 'CVE-3', sev: 'CRITICAL', kev: false, in_use: 'no' }], { kev: 0, critical_fix_max_days: -1, exposure: 'internal' }) },
    ]);
    expect(facts).toMatchObject({
      criticalFixMaxDays: 40,
      criticalFixInUseMaxDays: 3,
      knownExploitedInUse: 1,
      criticalNotInUse: 2,
      criticalNetworkExposed: 1,
      exposure: 'external',
    });
  });

  it('nothing open: no KEV and -1 days', () => {
    const facts = applicationFacts(app, ['3.1'], [
      { ref: 'api', scan: withContext([], { kev: 0, epss_max: null, critical_fix_max_days: -1, high_fix_max_days: -1 }) },
    ]);
    expect(facts).toMatchObject({ vulnContext: true, knownExploited: 0, epssMax: -1, criticalFixMaxDays: -1 });
  });

  it('unknown when the KEV feed was missing, a scan has no context or an image is not scanned', () => {
    const missing = applicationFacts(app, ['3.1'], [{ ref: 'api', scan: withContext([], { kev: null }) }]);
    const old = applicationFacts(app, ['3.1'], [{ ref: 'api', scan: scan([{ id: 'CVE-1', sev: 'HIGH' }]) }]);
    const notScanned = applicationFacts(app, ['3.1'], [
      { ref: 'api', scan: withContext([], { kev: 0 }) },
      { ref: 'web', scan: { configured: true, scan: null } },
    ]);
    for (const facts of [missing, old, notScanned]) {
      expect(facts).toMatchObject({ vulnContext: false, knownExploited: -1, criticalFixMaxDays: -1 });
    }
  });
});

describe('quality report', () => {
  const report: QualityReport = {
    schema: 'refresquito.quality/v1',
    revision: 'abc',
    backend: {
      tests: { total: 28, failures: 0, errors: 0, skipped: 0 },
      coverage: { lines: 96.9 },
      ruff: { issues: 0 },
      mypy: { errors: 2 },
    },
    frontend: {
      tests: { total: 27, failures: 1, errors: 0, skipped: 0 },
      coverage: { lines: 75, branches: 80 },
      eslint: { errors: 3, warnings: 1 },
    },
  };

  it('counts when every image has it', () => {
    const facts = applicationFacts(app, ['3.1'], [
      { ref: 'api', quality: report },
      { ref: 'web', quality: report },
    ]);
    expect(facts).toMatchObject({
      qualityReport: true,
      testsFailed: 1,
      backendCoverage: 96.9,
      frontendCoverage: 75,
      lintIssues: 3,
      typeErrors: 2,
      qualityRevision: 'abc',
    });
  });

  it('an image without it: no report, and every number fails its check', () => {
    const facts = applicationFacts(app, ['3.1'], [
      { ref: 'api', quality: report },
      { ref: 'web', quality: null },
    ]);
    expect(facts).toMatchObject({ qualityReport: false, testsFailed: -1, backendCoverage: -1, lintIssues: -1, typeErrors: -1 });
  });

  it('a report without the numbers of a tool says -1 for them', () => {
    const facts = applicationFacts(app, ['3.1'], [
      { ref: 'api', quality: { schema: 'refresquito.quality/v1', backend: { coverage: { lines: 90 } } } },
    ]);
    expect(facts).toMatchObject({ qualityReport: true, testsFailed: -1, backendCoverage: 90, frontendCoverage: 100, lintIssues: -1, typeErrors: -1 });
  });
});
