import { addSegregation, enableZone, refuseCluster, scaleCluster, tomlPrograms } from './clusterInfra';
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
    expect(occar).toMatchObject({ n: 1, enabled: true });
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
});
