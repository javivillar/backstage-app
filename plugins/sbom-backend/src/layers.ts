import type { Component } from './cyclonedx';
import type { Vulnerability } from './vulnerabilities';

/**
 * The open CRITICAL / HIGH of an application split by who fixes them. The framework layer is fixed once, in the
 * framework or the platform, for every application on the line: the base image (OS packages), the platform images it
 * also runs (refresquito-postgres...) and the libraries the line itself ships (the components of its release SBOMs,
 * annotation refresquito.io/sbom-releases). Everything else is the application's own dependencies, fixed in its
 * repository.
 */

export interface LayerScan {
  ref: string;
  /** an image the application builds itself (ownImages); false: a platform image */
  own: boolean;
  /** only the findings that count (not not_applicable, not excepted): the caller filters them */
  vulns: Vulnerability[];
}

export interface LayerCounts {
  framework: { critical: number; high: number };
  own: { critical: number; high: number };
}

/**
 * The names a finding's package is matched with, lower case (Syft and Trivy differ in case: SQLAlchemy / sqlalchemy);
 * for Maven also group:name, as Trivy names it. By name, not version: an application on a later patch of the line, or
 * with a transitive dependency resolved to another version, still has it because of the framework.
 */
export function frameworkPackages(components: Component[]): Set<string> {
  const keys = new Set<string>();
  for (const c of components) {
    if (!c.name) continue;
    keys.add(c.name.toLowerCase());
    if (c.group) keys.add(`${c.group}:${c.name}`.toLowerCase());
  }
  return keys;
}

export function splitByLayer(scans: LayerScan[], frameworkPkgs: Set<string>): LayerCounts {
  const out: LayerCounts = { framework: { critical: 0, high: 0 }, own: { critical: 0, high: 0 } };
  for (const s of scans) {
    for (const v of s.vulns) {
      const sev = v.sev?.toUpperCase();
      if (sev !== 'CRITICAL' && sev !== 'HIGH') continue;
      const framework = !s.own || v.cls === 'os' || (!!v.pkg && frameworkPkgs.has(v.pkg.toLowerCase()));
      out[framework ? 'framework' : 'own'][sev === 'CRITICAL' ? 'critical' : 'high']++;
    }
  }
  return out;
}
