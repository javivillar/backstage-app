import { DEFAULT_POLICY, deniedIn, evaluateLicenses } from './licenses';
import type { Component } from './cyclonedx';

const D = DEFAULT_POLICY.denied;
const c = (name: string, ecosystem: string, licenses: string[]): Component => ({ name, ecosystem, licenses });

describe('license expressions', () => {
  it('allows what an allowed license can satisfy', () => {
    for (const e of ['MIT', 'Apache-2.0 OR BSD-3-Clause', 'MIT AND PSF-2.0', 'GPL-3.0-only OR MIT', 'LGPL-3.0-or-later', 'MIT License', 'Dual License',
      'GPL-2.0-or-later WITH Classpath-exception-2.0 OR Apache-2.0', '(MIT OR GPL-3.0) AND BSD-2-Clause', 'GNU Lesser General Public License v3 (LGPLv3)']) {
      expect([e, deniedIn(e, D)]).toEqual([e, []]);
    }
  });

  it('denies what needs a denied license', () => {
    expect(deniedIn('GPL-3.0-only', D)).toEqual(['GPL-3.0-only']);
    expect(deniedIn('AGPL-3.0-or-later', D)).toEqual(['AGPL-3.0-or-later']);
    expect(deniedIn('MIT AND GPL-2.0-only', D)).toEqual(['GPL-2.0-only']);
    expect(deniedIn('(MIT OR Apache-2.0) AND AGPL-3.0', D)).toEqual(['AGPL-3.0']);
    expect(deniedIn('GPL-2.0 OR AGPL-3.0', D).sort()).toEqual(['AGPL-3.0', 'GPL-2.0']);
    expect(deniedIn('GNU General Public License v3 (GPLv3)', D)).toEqual(['GPL-3.0']);
    expect(deniedIn('GNU Affero General Public License v3', D)).toEqual(['AGPL-3.0']);
    expect(deniedIn('SSPL-1.0', D)).toEqual(['SSPL-1.0']);
  });
});

describe('license policy of an SBOM', () => {
  it('looks only at the dependencies of the application, and lists the ones without a license', () => {
    const report = evaluateLicenses([
      c('bash', 'deb', ['GPL-3.0-or-later']), // the OS of the image: not looked at
      c('fastapi', 'pypi', ['MIT']),
      c('some-lib', 'pypi', ['GPL-3.0-only']),
      c('dual', 'npm', ['GPL-3.0-only', 'MIT']), // two licenses listed: either
      c('mystery', 'pypi', []),
      c('refresquito-fastapi', 'pypi', ['LicenseRef-Refresquito-Proprietary']),
    ]);
    expect(report.checked).toBe(5);
    expect(report.denied.map(d => [d.name, d.denied])).toEqual([['some-lib', ['GPL-3.0-only']]]);
    expect(report.unknown.map(u => u.name)).toEqual(['mystery']);
  });

  it('ignores what is not a dependency, and counts a package found twice once', () => {
    const launcher = { ...c('Simple Launcher', 'nuget', []), version: '1.1.0.14', purl: 'pkg:nuget/Simple%20Launcher@1.1.0.14' };
    const lib = { ...c('lib', 'pypi', []), version: '1.0' };
    const report = evaluateLicenses([launcher, launcher, lib, lib]);
    expect(report.checked).toBe(1);
    expect(report.unknown.map(u => u.name)).toEqual(['lib']);
  });

  it('takes the policy of the configuration', () => {
    const report = evaluateLicenses([c('x', 'pypi', ['MPL-2.0']), c('y', 'deb', ['MPL-2.0'])], { denied: ['MPL-*'], ecosystems: ['pypi', 'deb'], ignore: [] });
    expect(report.denied.map(d => d.name)).toEqual(['x', 'y']);
  });
});
