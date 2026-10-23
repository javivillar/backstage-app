/**
 * The quality report the CI of an application attaches to its images (quality.json, schema refresquito.quality/v1,
 * written by .github/quality.py of the application): what its tests, coverage and linters said for that commit.
 */

export interface TestRun {
  total: number;
  failures: number;
  errors: number;
  skipped: number;
}

/** One test of the run (detail.tests): its name, result, time in seconds and, if it did not pass, why. */
export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  time: number;
  message?: string;
}

/** One file (detail.coverage): its coverage in percent and the lines no test runs ("12-14, 40"). */
export interface FileCoverage {
  file: string;
  lines: number;
  branches?: number;
  statements?: number;
  missing?: string;
}

/** Who can call an operation (detail.endpoints, .github/endpoints.py of the application). */
export interface Endpoint {
  method: string;
  path: string;
  /** none: no authentication and not declared public, the finding */
  auth: 'roles' | 'user' | 'flow' | 'custom' | 'public' | 'none';
  owner: 'app' | 'framework';
  operation?: string;
  roles?: string[];
  /** why it is public (openapi_extra x-refresquito-public) */
  reason?: string;
}

/** A finding of a tool on the code (detail.findings): Bandit, eslint (security), gitleaks, Trivy. Never the secret. */
export interface CodeFinding {
  tool: 'bandit' | 'eslint' | 'gitleaks' | 'trivy' | string;
  rule?: string;
  severity?: string;
  confidence?: string;
  file?: string;
  line?: number;
  message?: string;
  /** secrets: repository, or image <name>; and the commit for the history */
  where?: string;
  commit?: string;
}

export interface EndpointCounts {
  total: number;
  unauthenticated: number;
  public: number;
  custom: number;
  with_roles: number;
  flow?: number;
}

export interface QualityPart {
  tests?: TestRun;
  /** percentages */
  coverage?: { lines?: number; branches?: number; statements?: number; functions?: number };
  ruff?: { issues: number };
  mypy?: { errors: number };
  eslint?: { errors: number; warnings: number };
  /** code findings (quality.py with endpoints, Bandit and the eslint rules of security) */
  endpoints?: EndpointCounts;
  bandit?: { high: number; medium: number; low: number };
  security?: { errors: number };
  /** every test and every file (reports since quality.py with detail; older ones lack it) */
  detail?: { tests?: TestCase[]; coverage?: FileCoverage[]; endpoints?: Endpoint[]; findings?: CodeFinding[] };
}

/** Secrets in the whole git history (gitleaks) and in the images (Trivy); absent number: not scanned. */
export interface SecretsPart {
  repo?: number;
  images?: number;
  detail?: { findings?: CodeFinding[] };
}

export interface QualityReport {
  schema: string;
  revision?: string;
  generated?: string;
  backend?: QualityPart;
  frontend?: QualityPart;
  secrets?: SecretsPart;
}

export const QUALITY_SCHEMA = 'refresquito.quality/v1';

/** The report as it is, if it is one (its schema), else undefined. */
export function parseQuality(content: unknown): QualityReport | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const report = content as QualityReport;
  return report.schema === QUALITY_SCHEMA ? report : undefined;
}

/**
 * The numbers the scorecard checks; -1 when the report does not say it (a missing number fails its check rather than
 * passing it). An application without frontend has no frontend numbers to fail: -1 only when the part exists.
 */
export function qualityFacts(report: QualityReport | undefined) {
  const n = (v: number | undefined) => (typeof v === 'number' ? v : -1);
  const parts = [report?.backend, report?.frontend].filter((p): p is QualityPart => !!p);
  const tests = parts.map(p => p.tests);
  return {
    qualityReport: !!report,
    testsFailed: report && tests.every(Boolean) ? tests.reduce((acc, t) => acc + t!.failures + t!.errors, 0) : -1,
    backendCoverage: n(report?.backend?.coverage?.lines),
    frontendCoverage: report?.frontend ? n(report.frontend.coverage?.lines) : 100,
    lintIssues:
      report?.backend?.ruff && (!report.frontend || report.frontend.eslint)
        ? report.backend.ruff.issues + (report.frontend?.eslint?.errors ?? 0)
        : -1,
    typeErrors: n(report?.backend?.mypy?.errors),
    // code findings: operations without authentication not declared public; Bandit HIGH + MEDIUM and the eslint rules
    // of security; secrets in the history and in the images. -1: the report does not say it (the check then fails)
    unauthenticatedEndpoints: n(report?.backend?.endpoints?.unauthenticated),
    sastIssues:
      report?.backend?.bandit && (!report.frontend || report.frontend.security)
        ? report.backend.bandit.high + report.backend.bandit.medium + (report.frontend?.security?.errors ?? 0)
        : -1,
    secretsFound:
      typeof report?.secrets?.repo === 'number' && typeof report.secrets.images === 'number'
        ? report.secrets.repo + report.secrets.images
        : -1,
    qualityRevision: report?.revision ?? '',
  };
}
