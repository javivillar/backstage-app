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

export interface QualityPart {
  tests?: TestRun;
  /** percentages */
  coverage?: { lines?: number; branches?: number; statements?: number; functions?: number };
  ruff?: { issues: number };
  mypy?: { errors: number };
  eslint?: { errors: number; warnings: number };
}

export interface QualityReport {
  schema: string;
  revision?: string;
  generated?: string;
  backend?: QualityPart;
  frontend?: QualityPart;
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
    qualityRevision: report?.revision ?? '',
  };
}
