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
