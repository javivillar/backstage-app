import { actionRequest, addSegregation, type AddedSegregation, deleteCluster, enableZone, kindOf, refuseCluster, removeSegregation, scaleCluster, segregationExceptions, siteRole, tomlPrograms, withoutProgram } from './clusterInfra';
import type { ZoneView } from './clusterZone';

const TOML = `[general]
x = 1

[[zone]]
name = "occar"
label = "OCCAR"
enabled = false

[[zone]]
name = "nato"
enabled = true

[[program]]
zone = "nato"
n = 1
name = "sirtap"

[[program]]
zone = "nato"
n = 3     # cistest
name = "cistest"
`;

const profile = {
  name: 'standard', default: true, description: '', counts: { vnf: 1, master: 2, worker: 2, storage: 1 }, memoryMb: 57344,
  roles: { vnf: { vcpu: 2, memory_mb: 2048 }, master: { vcpu: 4, memory_mb: 4096 }, worker: { vcpu: 10, memory_mb: 20480 }, storage: { vcpu: 4, memory_mb: 6144 } },
  k8sCis: true, longhorn: true,
};
const view = (free = 200_000): ZoneView => ({
  warnings: [], drift: [],
  catalog: [
    { name: 'occar', status: 'reserved', enabled: false, maxProgramN: 99, programs: [] },
    { name: 'nato', status: 'complete', enabled: true, maxProgramN: 99, programs: [{ name: 'sirtap', n: 1, declared: true, ok: true, cluster: 'nato-sirtap-oneke' }, { name: 'old', n: 4, declared: false, ok: null }, { name: 'a400m', n: 5, declared: true, ok: true }] },
  ],
  zones: [{ name: 'nato', status: 'complete', programs: [
    { name: 'sirtap', id: 'nato-sirtap', status: '', ok: true, cluster: { name: 'nato-sirtap-oneke', state: 'RUNNING', roles: { master: 2, worker: 2, storage: 1 } }, networks: [], securityGroups: [], vms: [] },
    { name: 'a400m', id: 'nato-a400m', status: '', ok: true, networks: [], securityGroups: [], vms: [] },
  ] }],
  kubernetes: { profiles: [profile], defaultProfile: 'standard' },
  capacity: { freeMemoryMb: free },
});

describe('infrastructure as code from the console', () => {
  it('reads and edits network.toml like configuration.py', () => {
    expect(tomlPrograms(TOML)).toEqual([{ zone: 'nato', n: 1, name: 'sirtap' }, { zone: 'nato', n: 3, name: 'cistest' }]);
    expect(enableZone(TOML, 'occar')).toContain('name = "occar"\nlabel = "OCCAR"\nenabled = true');
    expect(enableZone(TOML, 'nato')).toBe(TOML);
    expect(() => enableZone(TOML, 'mars')).toThrow(/catalog/);
  });

  it('adds a segregation with a new n, enabling a reserved zone', () => {
    const nato = addSegregation(TOML, view(), 'nato', 'eurofighter');
    expect(nato).toMatchObject({ n: 6, enabled: false }); // 5 is the highest (a400m in OpenNebula), 4 never reused
    expect((nato as { text: string }).text.endsWith('[[program]]\nzone = "nato"\nn = 6\nname = "eurofighter"\n')).toBe(true);
    const occar = addSegregation(TOML, view(), 'occar', 'a400m') as { text: string; n: number; enabled: boolean };
    expect(occar).toMatchObject({ n: 2, common: 1, enabled: true }); // the first segregation of a zone brings its common
    expect(occar.text).toContain('enabled = true\n\n[[zone]]\nname = "nato"');
    expect(addSegregation(TOML, view(), 'nato', 'cistest')).toMatch(/already/);
    expect(addSegregation(TOML, view(), 'nato', 'Bad_Name')).toMatch(/name/);
    expect(addSegregation(TOML, view(), 'mars', 'x')).toMatch(/no zone/);
  });

  it('refuses clusters that cannot be created', () => {
    const ask = { zone: 'nato', program: 'a400m', profile: 'standard' };
    expect(refuseCluster(view(), [], ask)).toBeUndefined();
    expect(refuseCluster(view(), [], { ...ask, program: 'sirtap' })).toMatch(/already has a cluster/);
    expect(refuseCluster(view(), [], { ...ask, program: 'nope' })).toMatch(/segregation/);
    expect(refuseCluster(view(), [{ zone: 'nato', program: 'a400m' }], ask)).toMatch(/already asked/);
    expect(refuseCluster(view(), [], { ...ask, profile: 'huge' })).toMatch(/profile/);
    expect(refuseCluster(view(50_000), [], ask)).toMatch(/memory/);
    expect(refuseCluster(view(30_000), [], { ...ask, workers: 1 })).toMatch(/memory/); // 57344 - 20480
    expect(refuseCluster(view(40_000), [], { ...ask, workers: 0 })).toBeUndefined(); // 57344 - 2 × 20480
    expect(refuseCluster(view(), [], { ...ask, workers: 20 })).toMatch(/Workers/);
  });

  it('scales a cluster: more workers or storage, never fewer storage nodes', () => {
    const ask = { zone: 'nato', program: 'sirtap', workers: 3, storage: 1 };
    expect(scaleCluster(view(), undefined, ask, 'user:default/javi')).toMatchObject({ zone: 'nato', program: 'sirtap', workers: 3, storage: 1, requested_by: 'user:default/javi' });
    expect(scaleCluster(view(), { zone: 'nato', program: 'sirtap', profile: 'standard', workers: 2, storage: 1 }, { ...ask, workers: 1 }, 'u')).toMatchObject({ profile: 'standard', workers: 1 });
    expect(scaleCluster(view(), undefined, { ...ask, storage: 0 }, 'u')).toMatch(/Longhorn/);
    expect(scaleCluster(view(10_000), undefined, ask, 'u')).toMatch(/memory/);
    expect(scaleCluster(view(), undefined, { ...ask, program: 'a400m' }, 'u')).toMatch(/no cluster/);
    expect(scaleCluster(view(), { zone: 'nato', program: 'sirtap', workers: 2, storage: 1 }, { ...ask, workers: 2 }, 'u')).toMatch(/already/);
  });

  it('removes a segregation block and the exceptions that name it, nothing else', () => {
    const t = `${TOML}\n[[exception]]\nfrom = "nato/sirtap"\nto = "nato/cistest"\n\n[[exception]]\nfrom = "occar/a400m"\nto = "nato/sirtap"\n`;
    const out = withoutProgram(t, 'nato', 'cistest')!;
    expect(tomlPrograms(out)).toEqual([{ zone: 'nato', n: 1, name: 'sirtap' }]);
    expect(out).not.toContain('nato/cistest');
    expect(out).toContain('[[exception]]\nfrom = "occar/a400m"\nto = "nato/sirtap"\n');
    expect(out).toContain('[general]\nx = 1\n\n[[zone]]');
    expect(withoutProgram(t, 'nato', 'nope')).toBeUndefined();
    const v = view();
    expect(removeSegregation(TOML, v, [], 0, ['nato/sirtap'], 'nato', 'sirtap')).toMatch(/this console/);
    expect(removeSegregation(TOML, v, [], 0, [], 'nato', 'sirtap')).toMatch(/delete the cluster first/);
    expect(removeSegregation(TOML, v, [{ zone: 'nato', program: 'cistest' }], 0, [], 'nato', 'cistest')).toMatch(/asked in git/);
    expect(removeSegregation(TOML, v, [], 1, [], 'nato', 'cistest')).toMatch(/1 VM/);
    expect(removeSegregation(TOML, v, [{ zone: 'nato', program: 'cistest', delete: true }], 0, [], 'nato', 'cistest')).toHaveProperty('text');
  });

  it('deletes a cluster, never the one of the console', () => {
    expect(deleteCluster(view(), undefined, ['nato/sirtap'], 'nato', 'sirtap', 'u')).toMatch(/this console/);
    expect(deleteCluster(view(), undefined, [], 'nato', 'sirtap', 'u')).toMatchObject({ zone: 'nato', program: 'sirtap', delete: true });
    expect(deleteCluster(view(), undefined, [], 'nato', 'a400m', 'u')).toMatch(/no cluster/);
    expect(deleteCluster(view(), { zone: 'nato', program: 'sirtap', delete: true }, [], 'nato', 'sirtap', 'u')).toMatch(/already/);
  });

  it('adds masters, never removes them', () => {
    const ask = { zone: 'nato', program: 'sirtap', workers: 2, storage: 1 };
    expect(scaleCluster(view(), undefined, { ...ask, masters: 3 }, 'u')).toMatchObject({ masters: 3, workers: 2 });
    expect(scaleCluster(view(), undefined, { ...ask, masters: 1 }, 'u')).toMatch(/etcd/);
    expect(scaleCluster(view(), undefined, { ...ask, masters: 9 }, 'u')).toMatch(/Masters/);
    expect(scaleCluster(view(1000), undefined, { ...ask, masters: 3 }, 'u')).toMatch(/memory/);
  });

  it('asks one-off operations, never stopping the cluster of the console', () => {
    const vms = [{ zone: 'nato', program: 'a400m', name: 'tools' }];
    const ok = actionRequest(view(), ['nato/sirtap'], vms, { kind: 'vm-reboot', zone: 'nato', program: 'a400m', vm: 'tools' }, 'u');
    expect(ok).toMatchObject({ body: { kind: 'vm-reboot', zone: 'nato', program: 'a400m', vm: 'tools', requested_by: 'u' } });
    expect((ok as { file: string }).file).toMatch(/-vm-reboot-nato-a400m-tools\.json$/);
    expect(actionRequest(view(), ['nato/sirtap'], vms, { kind: 'cluster-stop', zone: 'nato', program: 'sirtap' }, 'u')).toMatch(/restarted, not stopped/);
    expect(actionRequest(view(), ['nato/sirtap'], vms, { kind: 'cluster-restart', zone: 'nato', program: 'sirtap' }, 'u')).toHaveProperty('file');
    expect(actionRequest(view(), [], vms, { kind: 'vm-reboot', zone: 'nato', program: 'a400m', vm: 'other' }, 'u')).toMatch(/no VM/);
    expect(actionRequest(view(), [], vms, { kind: 'cluster-start', zone: 'nato', program: 'a400m' }, 'u')).toMatch(/no cluster/);
    expect(actionRequest(view(), [], vms, { kind: 'rm', zone: 'nato', program: 'a400m' }, 'u')).toMatch(/one of/);
  });
});

const ok = (x: AddedSegregation | string): AddedSegregation => {
  if (typeof x === 'string') throw new Error(x);
  return x;
};
/** A site: its role, and the zones of the catalog with what the host knows of them. */
const site = (role: 'core' | 'edge' | undefined, programs: Record<string, Array<{ name: string; n: number; kind?: string }>>, live: Record<string, Array<{ name: string; vms?: number; kind?: string }>> = {}): ZoneView => ({
  warnings: [], drift: [],
  ...(role ? { site: { role } } : {}),
  catalog: Object.entries(programs).map(([name, ps]) => ({ name, status: ps.length ? 'complete' : 'reserved', enabled: ps.length > 0, maxProgramN: 9, programs: ps.map(p => ({ ...p, declared: true, ok: true })) })),
  zones: Object.entries(live).map(([name, ps]) => ({
    name, status: 'complete',
    programs: ps.map(p => ({ name: p.name, id: `${name}-${p.name}`, status: '', ok: true, kind: p.kind, networks: [], securityGroups: [], vms: Array.from({ length: p.vms ?? 0 }, (_, i) => ({ id: `${i}`, name: `vm-${i}`, state: 'RUNNING', role: 'vm', ips: [] })) })),
  })),
});

const BASE = `[site]
role = "core"

[[zone]]
name = "diflim"
enabled = false

[[zone]]
name = "nato"
enabled = true

# [[exception]]
# from = "occar/program1"
# to = "occar/program2"

# ---------------------------------------------------------------------------------
# Programs. install and add-program append a block here with the next free n.

[[program]]
zone = "nato"
n = 1
name = "sirtap"
`;

describe('segregation kinds, common and the exceptions of the interconnection', () => {
  it('reads the kind of a programme and the role of the site', () => {
    expect(tomlPrograms(`${BASE}\n[[program]]\nzone = "nato"\nn = 3\nname = "landing"\nkind = "landing"   # the gateways\n`)).toEqual([{ zone: 'nato', n: 1, name: 'sirtap' }, { zone: 'nato', n: 3, name: 'landing', kind: 'landing' }]);
    expect(kindOf('sirtap')).toBe('programme');
    expect(kindOf('common')).toBe('common'); // an older topology.json has no kind: the reserved name says it
    expect(kindOf('landing', 'landing')).toBe('landing');
    expect(kindOf('sirtap', 'nonsense')).toBe('programme');
    expect(siteRole({})).toBe('core');
    expect(siteRole({ site: { role: 'edge' } })).toBe('edge');
  });

  it('the first segregation of a zone brings its common and the exception to ClamAV', () => {
    const v = site('core', { diflim: [], nato: [{ name: 'sirtap', n: 1 }] });
    const out = ok(addSegregation(BASE, v, 'diflim', 'efa'));
    expect(out).toMatchObject({ program: 'efa', kind: 'programme', n: 2, common: 1, enabled: true, also: ['diflim/common', 'exception to ClamAV'] });
    expect(out.text).toContain('name = "diflim"\nenabled = true');
    expect(out.text.endsWith(
      '[[program]]\nzone = "diflim"\nn = 1\nname = "common"\nkind = "common"\n\n' +
      '[[program]]\nzone = "diflim"\nn = 2\nname = "efa"\n\n' +
      '[[exception]]\nfrom = "diflim/efa"\nto = "diflim/common"\nprotocol = "TCP"\nports = "3310"\nreason = "diflim/efa scans files with the ClamAV of diflim/common"\n',
    )).toBe(true);
    expect(tomlPrograms(out.text).filter(p => p.zone === 'diflim')).toEqual([{ zone: 'diflim', n: 1, name: 'common', kind: 'common' }, { zone: 'diflim', n: 2, name: 'efa' }]);
    expect(out.exceptions).toEqual([{ from: 'diflim/efa', to: 'diflim/common', protocol: 'TCP', ports: '3310', reason: expect.any(String) }]);
    // what was there stays as it was
    expect(out.text.startsWith(BASE.replace('name = "diflim"\nenabled = false', 'name = "diflim"\nenabled = true').replace(/\n+$/, ''))).toBe(true);
  });

  it('a zone that already has its common gets only the programme and its exception', () => {
    const toml = ok(addSegregation(BASE, site('core', { diflim: [], nato: [] }), 'diflim', 'efa')).text;
    const v = site('core', { diflim: [{ name: 'common', n: 1, kind: 'common' }, { name: 'efa', n: 2 }], nato: [] });
    const out = ok(addSegregation(toml, v, 'diflim', 'tornado'));
    expect(out).toMatchObject({ n: 3, enabled: false, also: ['exception to ClamAV'] });
    expect(out.common).toBeUndefined();
    expect(tomlPrograms(out.text).filter(p => p.name === 'common')).toHaveLength(1);
    expect(out.exceptions.map(e => `${e.from}>${e.to}:${e.ports}`)).toEqual(['diflim/tornado>diflim/common:3310']);
  });

  it('a zone from before the common (nato) gets no common and no exception', () => {
    const v = site(undefined, { nato: [{ name: 'sirtap', n: 1 }] });
    const out = ok(addSegregation(BASE, v, 'nato', 'eurofighter'));
    expect(out).toMatchObject({ n: 2, also: [], exceptions: [] });
    expect(out.text).not.toContain('"common"');
    expect(out.text.match(/\[\[exception\]\]/g)).toHaveLength(1); // the commented example only
  });

  it('a programme only live in OpenNebula counts: the zone is not empty', () => {
    const v = site('core', { diflim: [{ name: 'old', n: 4 }] });
    v.catalog![0].programs[0].declared = false;
    const out = ok(addSegregation(BASE, v, 'diflim', 'efa'));
    expect(out).toMatchObject({ n: 5, also: [] });
    expect(out.common).toBeUndefined();
  });

  it('a landing zone on a core site: its fixed name, common, and the edge proxy of every programme', () => {
    const toml = `${BASE}\n[[program]]\nzone = "nato"\nn = 2\nname = "common"\nkind = "common"\n\n[[program]]\nzone = "nato"\nn = 3\nname = "cistest"\n`;
    const v = site('core', { nato: [{ name: 'sirtap', n: 1 }, { name: 'common', n: 2, kind: 'common' }, { name: 'cistest', n: 3 }] });
    const out = ok(addSegregation(toml, v, 'nato', 'whatever', 'landing'));
    expect(out).toMatchObject({ program: 'landing', kind: 'landing', n: 4, also: ['exception to ClamAV', '2 exception(s) to the edge proxy'] });
    expect(out.text).toContain('[[program]]\nzone = "nato"\nn = 4\nname = "landing"\nkind = "landing"\n');
    expect(out.exceptions.map(e => `${e.from}>${e.to}:${e.protocol}/${e.ports}`)).toEqual(['nato/landing>nato/common:TCP/3310', 'nato/landing>nato/sirtap:TCP/443', 'nato/landing>nato/cistest:TCP/443']);
    // the name asked is ignored for a landing zone, also when it is missing
    expect(ok(addSegregation(toml, v, 'nato', '', 'landing')).program).toBe('landing');
    // a missing role is a core site
    expect(ok(addSegregation(toml, { ...v, site: undefined }, 'nato', '', 'landing')).kind).toBe('landing');
  });

  it('a landing zone as the first segregation of a zone still brings common', () => {
    const out = ok(addSegregation(BASE, site('core', { diflim: [] }), 'diflim', '', 'landing'));
    expect(out).toMatchObject({ program: 'landing', n: 2, common: 1, enabled: true });
    expect(out.exceptions.map(e => `${e.from}>${e.to}`)).toEqual(['diflim/landing>diflim/common']);
  });

  it('a new programme in a zone with a landing zone is reached by it', () => {
    const toml = `${BASE}\n[[program]]\nzone = "nato"\nn = 2\nname = "common"\nkind = "common"\n\n[[program]]\nzone = "nato"\nn = 3\nname = "landing"\nkind = "landing"\n`;
    const v = site('core', { nato: [{ name: 'sirtap', n: 1 }, { name: 'common', n: 2, kind: 'common' }, { name: 'landing', n: 3, kind: 'landing' }] });
    const out = ok(addSegregation(toml, v, 'nato', 'a400m'));
    expect(out.exceptions.map(e => `${e.from}>${e.to}:${e.ports}`)).toEqual(['nato/a400m>nato/common:3310', 'nato/landing>nato/a400m:443']);
    expect(out.also).toEqual(['exception to ClamAV', '1 exception(s) to the edge proxy']);
    // without a landing zone declared in the file, nothing points at it
    expect(segregationExceptions('nato', 'a400m', 'programme', [{ zone: 'nato', n: 1, name: 'sirtap' }])).toEqual([]);
  });

  it('refuses a kind that does not fit the site, a second one, and the reserved names', () => {
    const core = site('core', { nato: [{ name: 'sirtap', n: 1 }, { name: 'landing', n: 2, kind: 'landing' }], diflim: [] });
    const edge = site('edge', { nato: [{ name: 'sirtap', n: 1 }] });
    expect(addSegregation(BASE, core, 'diflim', '', 'integration')).toMatch(/edge site.*core site/);
    expect(addSegregation(BASE, edge, 'nato', '', 'landing')).toMatch(/core site.*edge site/);
    expect(ok(addSegregation(BASE, edge, 'nato', '', 'integration'))).toMatchObject({ program: 'integration', kind: 'integration' });
    expect(ok(addSegregation(BASE, edge, 'nato', '', 'integration')).text).toContain('name = "integration"\nkind = "integration"\n');
    expect(addSegregation(BASE, core, 'nato', '', 'landing')).toMatch(/nato\/landing already exists/);
    for (const name of ['common', 'landing', 'integration']) expect(addSegregation(BASE, core, 'diflim', name)).toMatch(/reserved name/);
    expect(addSegregation(BASE, core, 'diflim', 'efa', 'common')).toMatch(/kind is one of programme, landing, integration/);
    expect(addSegregation(BASE, core, 'diflim', 'efa', 'cluster')).toMatch(/kind is one of/);
    // common needs a number too: the zone has one left
    const full = site('core', { diflim: [] });
    full.catalog![0].maxProgramN = 1;
    expect(addSegregation(BASE, full, 'diflim', 'efa')).toMatch(/No free programme numbers/);
  });

  it('only a programme gets a Kubernetes cluster', () => {
    const v = { ...site('core', { nato: [{ name: 'landing', n: 2, kind: 'landing' }, { name: 'common', n: 3 }, { name: 'a400m', n: 4 }] }), kubernetes: { profiles: [profile], defaultProfile: 'standard' } };
    expect(refuseCluster(v, [], { zone: 'nato', program: 'landing', profile: 'standard' })).toMatch(/landing segregation: only a programme/);
    expect(refuseCluster(v, [], { zone: 'nato', program: 'common', profile: 'standard' })).toMatch(/common segregation/);
    expect(refuseCluster(v, [], { zone: 'nato', program: 'a400m', profile: 'standard' })).toBeUndefined();
  });

  it('removing a segregation takes its exceptions and keeps the comments around', () => {
    const v = site('core', { diflim: [], nato: [] });
    const one = ok(addSegregation(BASE, v, 'diflim', 'efa')).text;
    const two = ok(addSegregation(one, site('core', { diflim: [{ name: 'common', n: 1, kind: 'common' }, { name: 'efa', n: 2 }] }), 'diflim', '', 'landing')).text;
    expect(two.match(/^\[\[exception\]\]$/gm)).toHaveLength(3); // efa > common, landing > common, landing > efa
    const live = site('core', { diflim: [{ name: 'common', n: 1, kind: 'common' }, { name: 'efa', n: 2 }, { name: 'landing', n: 3, kind: 'landing' }] });
    const out = removeSegregation(two, live, [], 0, [], 'diflim', 'efa') as { text: string };
    expect(tomlPrograms(out.text).filter(p => p.zone === 'diflim').map(p => p.name)).toEqual(['common', 'landing']);
    expect(out.text).not.toContain('diflim/efa');
    expect(out.text.match(/^\[\[exception\]\]$/gm)).toHaveLength(1);
    expect(out.text).toContain('from = "diflim/landing"\nto = "diflim/common"');
    expect(out.text).not.toMatch(/\n\n\n/);
    // removing the first programme of the file leaves the heading comment of the section where it was
    const first = removeSegregation(two, live, [], 0, [], 'nato', 'sirtap') as { text: string };
    expect(first.text).toContain('# Programs. install and add-program append a block here with the next free n.\n\n[[program]]\nzone = "diflim"');
    expect(first.text).toContain('# [[exception]]\n# from = "occar/program1"');
    // a block followed by the comment of the next one: the comment stays
    const commented = `${BASE}\n# the test cluster\n[[program]]\nzone = "nato"\nn = 2\nname = "cistest"\n`;
    expect(withoutProgram(commented, 'nato', 'sirtap')).toContain('# the test cluster\n[[program]]\nzone = "nato"\nn = 2');
  });

  it('common goes last; a landing zone goes after its components', () => {
    const toml = ok(addSegregation(BASE, site('core', { diflim: [] }), 'diflim', 'efa')).text;
    const both = site('core', { diflim: [{ name: 'common', n: 1, kind: 'common' }, { name: 'efa', n: 2 }] });
    expect(removeSegregation(toml, both, [], 0, [], 'diflim', 'common')).toMatch(/removed last, after diflim\/efa/);
    const alone = removeSegregation(toml, both, [], 0, [], 'diflim', 'efa') as { text: string };
    expect(alone.text).not.toContain('[[exception]]\nfrom');
    // efa is gone from git but the host has not destroyed it yet: common still waits
    expect(removeSegregation(alone.text, both, [], 0, [], 'diflim', 'common')).toMatch(/removed last/);
    const last = removeSegregation(alone.text, site('core', { diflim: [{ name: 'common', n: 1, kind: 'common' }] }), [], 0, [], 'diflim', 'common') as { text: string };
    expect(tomlPrograms(last.text).filter(p => p.zone === 'diflim')).toEqual([]);
    // a common without its kind in an older file is still the common
    expect(removeSegregation(toml.replace('kind = "common"\n', ''), both, [], 0, [], 'diflim', 'common')).toMatch(/removed last/);

    const landing = `${BASE}\n[[program]]\nzone = "nato"\nn = 3\nname = "landing"\nkind = "landing"\n`;
    const cat = { nato: [{ name: 'sirtap', n: 1 }, { name: 'landing', n: 3, kind: 'landing' }] };
    expect(removeSegregation(landing, site('core', cat, { nato: [{ name: 'landing', vms: 2, kind: 'landing' }] }), [], 0, [], 'nato', 'landing')).toMatch(/2 VM\(s\): delete its components first/);
    expect(removeSegregation(landing, site('core', cat, { nato: [{ name: 'landing', kind: 'landing' }] }), [], 1, [], 'nato', 'landing')).toMatch(/1 VM\(s\): delete its components first/);
    expect(removeSegregation(landing, site('core', cat, { nato: [{ name: 'landing', kind: 'landing' }] }), [], 0, [], 'nato', 'landing')).toHaveProperty('text');
  });
});
