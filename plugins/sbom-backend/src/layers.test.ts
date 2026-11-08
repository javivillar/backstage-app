import { frameworkPackages, splitByLayer } from './layers';
import type { Vulnerability } from './vulnerabilities';

const own = (vulns: Vulnerability[]) => ({ ref: 'ghcr.io/o/petstore-api:abc', own: true, vulns });

describe('vulnerabilities by layer', () => {
  it('platform image vuln is framework', () => {
    const out = splitByLayer(
      [{ ref: 'ghcr.io/o/refresquito-postgres:3.3.0', own: false, vulns: [{ id: 'A', sev: 'HIGH', cls: 'lang', pkg: 'x', ver: '1' }] }],
      new Set(),
    );
    expect(out.framework.high).toBe(1);
    expect(out.own.high).toBe(0);
  });

  it('os vuln in own image is framework', () => {
    const out = splitByLayer([own([{ id: 'A', sev: 'CRITICAL', cls: 'os', pkg: 'openssl', ver: '3' }])], new Set());
    expect(out.framework.critical).toBe(1);
    expect(out.own.critical).toBe(0);
  });

  it('lang vuln of a framework package is framework', () => {
    const out = splitByLayer(
      [own([{ id: 'A', sev: 'HIGH', cls: 'lang', pkg: 'starlette', ver: '0.47.1' }])],
      new Set(['starlette@0.47.1']),
    );
    expect(out.framework.high).toBe(1);
    expect(out.own.high).toBe(0);
  });

  it('lang vuln of the app is own', () => {
    const out = splitByLayer([own([{ id: 'A', sev: 'HIGH', cls: 'lang', pkg: 'starlette', ver: '0.47.1' }])], new Set());
    expect(out.own.high).toBe(1);
    expect(out.framework.high).toBe(0);
  });

  it('MEDIUM is not counted', () => {
    const out = splitByLayer([own([{ id: 'A', sev: 'MEDIUM', cls: 'os' }])], new Set());
    expect(out).toEqual({ framework: { critical: 0, high: 0 }, own: { critical: 0, high: 0 } });
  });

  it('the packages of the release SBOMs of a line, also by group for Maven', () => {
    const pkgs = frameworkPackages([
      { name: 'starlette', version: '0.47.1', ecosystem: 'pypi', licenses: [] },
      { name: 'spring-core', group: 'org.springframework', version: '6.2.0', ecosystem: 'maven', licenses: [] },
      { name: 'no-version', ecosystem: 'npm', licenses: [] },
    ]);
    expect([...pkgs].sort()).toEqual(['org.springframework:spring-core@6.2.0', 'spring-core@6.2.0', 'starlette@0.47.1']);
  });
});
