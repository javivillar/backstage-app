/**
 * The approved exceptions to the checks of Quality & Security: platform/security-exceptions.yaml of the application,
 * validated by its CI (.github/quality.py exceptions) into the part `exceptions` of its quality report, so they travel
 * with the image of the commit that is deployed. Approved by the CODEOWNERS of that file (the security approvers).
 *
 * Here they are applied: the finding of an active exception leaves its check. Expiry is checked again now — an image
 * can run long after its CI accepted the exception — so an exception that expired since is not applied.
 */

export type ExceptionCheck = 'vulnerability' | 'endpoint' | 'sast' | 'secret' | 'license' | 'os-eol';

export interface SecurityException {
  check: ExceptionCheck;
  id: string;
  /** sast / secret: the file of the finding */
  file?: string;
  /** vulnerability: only this image repository */
  image?: string;
  reason?: string;
  approvedBy?: string;
  /** YYYY-MM-DD */
  expires?: string;
  days_left?: number;
}

export interface ExceptionsPart {
  active: SecurityException[];
  expired: SecurityException[];
  invalid: Array<Partial<SecurityException> & { entry?: number; why: string }>;
  file?: boolean;
}

/** docker.io/library/postgres:17.4, ghcr.io/o/x-api@sha256:... -> the repository */
export function repoOf(image: string): string {
  const noDigest = image.split('@')[0];
  const last = noDigest.slice(noDigest.lastIndexOf('/') + 1);
  return last.includes(':') ? noDigest.slice(0, noDigest.length - (last.length - last.indexOf(':'))) : noDigest;
}

const sameFile = (a?: string, b?: string) => {
  if (!a || !b) return false;
  const x = a.replace(/^\.?\//, '');
  const y = b.replace(/^\.?\//, '');
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
};

export const EXPIRING_DAYS = 30;

export class Exceptions {
  readonly active: SecurityException[];
  readonly expiredNow: SecurityException[];
  readonly invalid: ExceptionsPart['invalid'];

  constructor(part: ExceptionsPart | undefined, today: string = new Date().toISOString().slice(0, 10)) {
    const all = part?.active ?? [];
    this.active = all.filter(e => !e.expires || e.expires >= today);
    this.expiredNow = [...(part?.expired ?? []), ...all.filter(e => e.expires && e.expires < today)];
    this.invalid = part?.invalid ?? [];
    this.today = today;
  }

  private readonly today: string;

  private of(check: ExceptionCheck) {
    return this.active.filter(e => e.check === check);
  }

  vulnerability(id: string, image?: string): boolean {
    return this.of('vulnerability').some(e => e.id === id && (!e.image || (!!image && repoOf(e.image) === repoOf(image))));
  }

  /** "GET /api/info"; an operation of several methods ("GET,POST") is excepted when one of them is */
  endpoint(method: string, path: string): boolean {
    const methods = method.split(',').map(m => m.trim().toUpperCase());
    return this.of('endpoint').some(e => {
      const [m, ...rest] = e.id.trim().split(/\s+/);
      return methods.includes((m ?? '').toUpperCase()) && rest.join(' ') === path;
    });
  }

  /** Bandit's rule is "B608 hardcoded_sql_expressions": the id is its first word, or eslint's rule id */
  sast(rule: string | undefined, file: string | undefined): boolean {
    return this.of('sast').some(e => !!rule && (rule === e.id || rule.split(' ')[0] === e.id) && sameFile(file, e.file));
  }

  secret(rule: string | undefined, file: string | undefined): boolean {
    return this.of('secret').some(e => rule === e.id && sameFile(file, e.file));
  }

  license(name: string): boolean {
    return this.of('license').some(e => e.id === name);
  }

  osEol(image: string): boolean {
    return this.of('os-eol').some(e => repoOf(e.id) === repoOf(image));
  }

  /** active exceptions that expire within EXPIRING_DAYS */
  expiring(): SecurityException[] {
    const limit = new Date(Date.parse(`${this.today}T00:00:00Z`) + EXPIRING_DAYS * 86400000).toISOString().slice(0, 10);
    return this.active.filter(e => e.expires && e.expires <= limit);
  }
}
