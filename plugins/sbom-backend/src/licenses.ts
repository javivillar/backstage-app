/**
 * The license policy of the platform, applied to the components of an SBOM: which dependencies of an application
 * carry a license it may not ship in a proprietary product (copyleft that reaches the application: GPL, AGPL...), and
 * which say no license at all.
 *
 * Only the dependencies of the application (its ecosystems: pypi, npm, maven...), not the packages of the OS of the
 * image (deb, apk, rpm): a base image is full of GPL programs, which the application does not link with.
 *
 * A license is what the SBOM says: an SPDX id (MIT), an expression (Apache-2.0 OR BSD-3-Clause, MIT AND PSF-2.0) or a
 * free name (MIT License, GNU General Public License v3). An expression is denied when it cannot be satisfied without a
 * denied license: OR needs every alternative denied, AND any part denied.
 *
 *   sbom:
 *     licenses:
 *       denied: ['AGPL-*', 'GPL-*', 'SSPL-*']        # SPDX ids, * at the end = any version / variant
 *       ecosystems: [pypi, npm, maven, nuget, golang, cargo, gem]
 *       ignore: ['pkg:nuget/Simple%20Launcher@']    # purl prefixes that are not dependencies (see DEFAULT_POLICY)
 */
import type { Component } from './cyclonedx';

export interface LicensePolicy {
  denied: string[];
  ecosystems: string[];
  /** purl prefixes of components that are not dependencies of the application */
  ignore: string[];
}

export const DEFAULT_POLICY: LicensePolicy = {
  denied: ['AGPL-*', 'GPL-*', 'SSPL-*', 'CC-BY-NC-*', 'BUSL-*', 'Commons-Clause'],
  ecosystems: ['pypi', 'npm', 'maven', 'nuget', 'golang', 'cargo', 'gem', 'composer'],
  // the Windows launchers pip carries inside (pip/_vendor/distlib/*.exe), which Syft reads as .NET binaries
  ignore: ['pkg:nuget/Simple%20Launcher@'],
};

export interface LicenseFinding {
  name: string;
  version?: string;
  ecosystem: string;
  licenses: string[];
  /** the denied license(s) that decide it */
  denied?: string[];
}

export interface LicenseReport {
  /** dependencies of the application looked at */
  checked: number;
  denied: LicenseFinding[];
  /** dependencies with no license at all in the SBOM */
  unknown: LicenseFinding[];
  policy: LicensePolicy;
}

/** Free names some ecosystems use (PyPI classifiers, old package.json) -> their SPDX id */
const NAMES: Array<[RegExp, string]> = [
  [/^gnu affero general public license v?3?/i, 'AGPL-3.0'],
  [/^gnu (lesser|library) general public license/i, 'LGPL'],
  [/^gnu general public license v?2/i, 'GPL-2.0'],
  [/^gnu general public license/i, 'GPL-3.0'],
  [/^(the )?mit license$/i, 'MIT'],
  [/^apache( software)? license,? (version )?2(\.0)?$/i, 'Apache-2.0'],
  [/^bsd license$/i, 'BSD'],
];

function normalize(id: string): string {
  const t = id.trim().replace(/^\(|\)$/g, '');
  for (const [re, spdx] of NAMES) if (re.test(t)) return spdx;
  return t;
}

function matches(id: string, pattern: string): boolean {
  const a = id.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith('*') ? a.startsWith(p.slice(0, -1)) || a === p.slice(0, -2) : a === p;
}

type Node = { id: string } | { op: 'AND' | 'OR'; parts: Node[] };

/** A small SPDX expression parser: ids, WITH <exception> (ignored), AND binds tighter than OR, parentheses. */
function parse(expression: string): Node {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i]?.toUpperCase();
  // eslint-disable-next-line prefer-const -- assigned below: the grammar is recursive (parentheses)
  let orExpr: () => Node;
  const primary = (): Node => {
    if (tokens[i] === '(') {
      i++;
      const node = orExpr();
      if (tokens[i] === ')') i++;
      return node;
    }
    // a free name may have spaces ("MIT License"): take words until an operator or a parenthesis
    const words: string[] = [];
    while (i < tokens.length && !['AND', 'OR', 'WITH'].includes(peek()!) && tokens[i] !== '(' && tokens[i] !== ')') words.push(tokens[i++]);
    if (peek() === 'WITH') {
      i++;
      while (i < tokens.length && !['AND', 'OR'].includes(peek()!) && tokens[i] !== ')') i++;
    }
    return { id: normalize(words.join(' ')) };
  };
  const andExpr = (): Node => {
    const parts = [primary()];
    while (peek() === 'AND') {
      i++;
      parts.push(primary());
    }
    return parts.length === 1 ? parts[0] : { op: 'AND', parts };
  };
  orExpr = (): Node => {
    const parts = [andExpr()];
    while (peek() === 'OR') {
      i++;
      parts.push(andExpr());
    }
    return parts.length === 1 ? parts[0] : { op: 'OR', parts };
  };
  return orExpr();
}

/** The denied ids a license expression cannot do without; [] when allowed licenses can satisfy it. */
export function deniedIn(expression: string, denied: string[]): string[] {
  const walk = (node: Node): string[] => {
    if ('id' in node) return denied.some(p => matches(node.id, p)) ? [node.id] : [];
    const results = node.parts.map(walk);
    if (node.op === 'OR') return results.some(r => r.length === 0) ? [] : [...new Set(results.flat())];
    return [...new Set(results.flat())];
  };
  return walk(parse(expression));
}

export function evaluateLicenses(components: Component[], policy: LicensePolicy = DEFAULT_POLICY): LicenseReport {
  const seen = new Set<string>();
  const mine = components.filter(c => {
    if (!policy.ecosystems.includes(c.ecosystem) || policy.ignore.some(p => (c.purl ?? '').startsWith(p))) return false;
    const key = `${c.ecosystem}:${c.group ?? ''}/${c.name}@${c.version ?? ''}`;   // the same package in several places
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const denied: LicenseFinding[] = [];
  const unknown: LicenseFinding[] = [];
  for (const c of mine) {
    const finding = { name: c.group ? `${c.group}/${c.name}` : c.name, version: c.version, ecosystem: c.ecosystem, licenses: c.licenses };
    if (!c.licenses.length) {
      unknown.push(finding);
      continue;
    }
    // several licenses listed for one component: each is an alternative (CycloneDX lists them so)
    const blocked = deniedIn(c.licenses.map(l => `(${l})`).join(' OR '), policy.denied);
    if (blocked.length) denied.push({ ...finding, denied: blocked });
  }
  return { checked: mine.length, denied, unknown, policy };
}

export function policyFrom(config?: { getOptionalStringArray(key: string): string[] | undefined }): LicensePolicy {
  return {
    denied: config?.getOptionalStringArray('denied') ?? DEFAULT_POLICY.denied,
    ecosystems: config?.getOptionalStringArray('ecosystems') ?? DEFAULT_POLICY.ecosystems,
    ignore: config?.getOptionalStringArray('ignore') ?? DEFAULT_POLICY.ignore,
  };
}
