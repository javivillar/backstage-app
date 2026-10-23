import { Exceptions, repoOf } from './exceptions';
import { applicationFacts } from './techInsights';
import type { QualityReport } from './quality';
import type { Entity } from '@backstage/catalog-model';

const until = (e: string) => ({ reason: 'accepted for a reason', approvedBy: 'sec', expires: e });

describe('security exceptions', () => {
  const exc = new Exceptions(
    {
      active: [
        { check: 'vulnerability', id: 'CVE-1', image: 'ghcr.io/o/app-web', ...until('2027-01-01') },
        { check: 'vulnerability', id: 'CVE-9', ...until('2026-10-01') }, // expired since the CI accepted it
        { check: 'endpoint', id: 'get /api/info', ...until('2026-11-10') },
        { check: 'sast', id: 'B608', file: 'src/app/report.py', ...until('2027-01-01') },
        { check: 'secret', id: 'generic-api-key', file: 'tests/fixtures/fake.env', ...until('2027-01-01') },
        { check: 'license', id: 'some-lib', ...until('2027-01-01') },
        { check: 'os-eol', id: 'docker.io/library/postgres', ...until('2027-01-01') },
      ],
      expired: [{ check: 'license', id: 'old', ...until('2026-01-01') }],
      invalid: [{ entry: 9, why: 'approvedBy is required' }],
    },
    '2026-10-23',
  );

  it('applies only what has not expired today, each to its kind of finding', () => {
    expect(exc.active).toHaveLength(6);
    expect(exc.expiredNow.map(e => e.id)).toEqual(['old', 'CVE-9']);
    expect(exc.vulnerability('CVE-1', 'ghcr.io/o/app-web:abc')).toBe(true);
    expect(exc.vulnerability('CVE-1', 'ghcr.io/o/app-api:abc')).toBe(false); // limited to one image
    expect(exc.vulnerability('CVE-9', 'x')).toBe(false); // expired now
    expect(exc.endpoint('GET', '/api/info')).toBe(true);
    expect(exc.endpoint('POST', '/api/info')).toBe(false);
    expect(exc.sast('B608 hardcoded_sql_expressions', 'backend/src/app/report.py')).toBe(true);
    expect(exc.sast('B602 subprocess_popen_with_shell_equals_true', 'src/app/report.py')).toBe(false);
    expect(exc.secret('generic-api-key', 'tests/fixtures/fake.env')).toBe(true);
    expect(exc.license('some-lib')).toBe(true);
    expect(exc.osEol('docker.io/library/postgres:15.3-alpine3.18')).toBe(true);
    expect(exc.expiring().map(e => e.id)).toEqual(['get /api/info']);
  });

  it('knows the repository of an image', () => {
    expect(repoOf('docker.io/library/postgres:17.4')).toBe('docker.io/library/postgres');
    expect(repoOf('ghcr.io/o/x-api@sha256:abc')).toBe('ghcr.io/o/x-api');
    expect(repoOf('localhost:5000/x')).toBe('localhost:5000/x');
  });
});

describe('facts with exceptions', () => {
  const app: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'app-oneke', annotations: { 'refresquito.io/sbom-images': 'ghcr.io/o/app-api:1,ghcr.io/o/app-web:1' } },
    spec: {},
  };
  const report = (active: object[]): QualityReport => ({
    schema: 'refresquito.quality/v1',
    backend: {
      endpoints: { total: 2, unauthenticated: 1, public: 0, custom: 0, with_roles: 1 },
      bandit: { high: 1, medium: 0, low: 0 },
      detail: {
        endpoints: [
          { method: 'GET', path: '/api/info', auth: 'none', owner: 'app' },
          { method: 'GET', path: '/api/x', auth: 'roles', owner: 'app' },
        ],
        findings: [{ tool: 'bandit', rule: 'B608 hardcoded_sql_expressions', severity: 'HIGH', file: 'src/app/report.py', line: 3 }],
      },
    },
    secrets: { repo: 1, images: 0, detail: { findings: [{ tool: 'gitleaks', rule: 'generic-api-key', file: 'tests/fixtures/fake.env', line: 1 }] } },
    exceptions: { active: active as never, expired: [], invalid: [] },
  });
  const scan = (vulns: object[], os_eol = false) => ({
    configured: true,
    scan: { digest: 'sha256:1', status: 'scanned' as const, counts: {}, vulns: vulns as never, context: { kev: 1 }, os_eol },
  });
  const images = (r: QualityReport) => [
    { ref: 'ghcr.io/o/app-api:1', quality: r, scan: scan([{ id: 'CVE-K', sev: 'HIGH', fix: '2', kev: true, age_days: 40, pkg: 'linux-libc-dev', not_applicable: 'kernel' }], true) },
    { ref: 'ghcr.io/o/app-web:1', quality: r, scan: scan([{ id: 'CVE-1', sev: 'CRITICAL', fix: '2', kev: true, age_days: 20, in_use: 'yes' }]) },
  ];

  it('without exceptions every finding counts (but a kernel package never does)', () => {
    const f = applicationFacts(app, ['3.1'], images(report([])));
    expect(f).toMatchObject({ knownExploited: 1, criticalFixInUseMaxDays: 20, highFixMaxDays: -1, osEndOfLife: 1,
      unauthenticatedEndpoints: 1, sastIssues: 1, secretsFound: 1, securityExceptions: 0 });
  });

  it('the excepted findings leave their checks', () => {
    const f = applicationFacts(app, ['3.1'], images(report([
      { check: 'vulnerability', id: 'CVE-1', ...until('2099-01-01') },
      { check: 'endpoint', id: 'GET /api/info', ...until('2099-01-01') },
      { check: 'sast', id: 'B608', file: 'src/app/report.py', ...until('2099-01-01') },
      { check: 'secret', id: 'generic-api-key', file: 'tests/fixtures/fake.env', ...until('2099-01-01') },
      { check: 'os-eol', id: 'ghcr.io/o/app-api', ...until('2099-01-01') },
    ])));
    expect(f).toMatchObject({ knownExploited: 0, criticalFixInUseMaxDays: -1, osEndOfLife: 0, unauthenticatedEndpoints: 0,
      sastIssues: 0, secretsFound: 0, securityExceptions: 5, securityExceptionsExpiring: 0 });
  });
});
