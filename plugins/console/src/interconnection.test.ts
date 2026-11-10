import { interFiles, interPolicy, interView } from './interFixture';
import { componentName, componentRows, componentTitle, interconnectionAttention, interconnectionKind, interconnectionZones, kindCounts, kindOf, overLimits, pathLanes, policyComponents, removalBlock, segregations, siteRole, zoneSlots } from './interconnection';
import { lifecycle, pullKind } from './zone';

const ctx = { admins: ['nato/sirtap'], askedClusters: [] as string[], vmFiles: 0, pending: [] as string[], allowed: true };

describe('the model of the interconnection', () => {
  const segs = segregations(interView);
  const rows = componentRows(interView, interFiles, interPolicy);
  const zones = interconnectionZones(segs, rows);

  it('reads the role of the site and the kind of each segregation, also from an older host', () => {
    expect(siteRole(interView)).toBe('core');
    expect(siteRole({})).toBe('core');
    expect(siteRole(undefined)).toBe('core');
    expect(siteRole({ site: { role: 'edge' } })).toBe('edge');
    expect(interconnectionKind('core')).toBe('landing');
    expect(interconnectionKind('edge')).toBe('integration');
    expect(kindOf('sirtap')).toBe('programme');
    expect(kindOf('common')).toBe('common');
    expect(kindOf('landing', 'landing')).toBe('landing');
    expect(segs.map(s => [s.id, s.kind])).toEqual([['nato/sirtap', 'programme'], ['nato/a400m', 'programme'], ['nato/landing', 'landing'], ['nato/common', 'common']]);
    expect(kindCounts(segs)).toEqual({ programme: 2, common: 1, landing: 1, integration: 0 });
    // a topology.json without kinds or catalog: the names say it
    const old = { ...interView, site: undefined, catalog: undefined, zones: interView.zones.map(z => ({ ...z, programs: z.programs.map(p => ({ ...p, kind: undefined })) })) };
    expect(segregations(old).map(s => s.kind)).toEqual(['programme', 'programme', 'landing', 'common']);
  });

  it('says why a segregation cannot be removed yet', () => {
    const by = (id: string) => segs.find(s => s.id === id)!;
    expect(removalBlock(by('nato/sirtap'), segs, ctx)?.key).toBe('ic.block.own');
    expect(removalBlock(by('nato/sirtap'), segs, { ...ctx, admins: [] })).toEqual({ key: 'ic.block.cluster', vars: { name: 'oneke-nato-sirtap' } });
    expect(removalBlock(by('nato/a400m'), segs, ctx)).toBeUndefined();
    expect(removalBlock(by('nato/a400m'), segs, { ...ctx, askedClusters: ['nato/a400m'] })?.key).toBe('ic.block.clusterAsked');
    expect(removalBlock(by('nato/a400m'), segs, { ...ctx, vmFiles: 1 })).toEqual({ key: 'ic.block.vms', vars: { n: 1 } });
    expect(removalBlock(by('nato/a400m'), segs, { ...ctx, pending: ['nato/a400m'] })?.key).toBe('ic.block.pending');
    expect(removalBlock(by('nato/a400m'), segs, { ...ctx, allowed: false })?.key).toBe('ic.block.admin');
    expect(removalBlock(by('nato/landing'), segs, { ...ctx, vmFiles: 3 })).toEqual({ key: 'ic.block.components', vars: { n: 3 } });
    expect(removalBlock(by('nato/common'), segs, ctx)?.key).toBe('ic.block.common');
    expect(removalBlock(by('nato/common'), [by('nato/common')], ctx)).toBeUndefined();
  });

  it('joins the component files with what OpenNebula has', () => {
    expect(rows.map(r => [r.vm, r.state, r.address])).toEqual([
      ['vm-nato-landing-apisix-u2m-0', 'running', '10.102.3.10'],
      ['vm-nato-landing-kafka-0', 'waiting', undefined],
      ['vm-nato-landing-sftpgo-0', 'git', undefined],
    ]);
    expect(rows[0]).toMatchObject({ component: 'apisix', traffic: 'u2m', image: 'refresquito-apisix-coraza-ubuntu2404-0.1.4', cpu: 2, memoryMb: 4096, diskGb: 20, name: 'apisix-u2m-0' });
    // a failed Workspace says why (the quota of the segregation in OpenNebula)
    const failed = componentRows(interView, [{ ...interFiles[2], state: { synced: false, message: 'quota exceeded' } }], interPolicy);
    expect(failed.find(r => r.name === 'sftpgo-0')).toMatchObject({ state: 'failed', detail: 'quota exceeded' });
    // a VM with the tag of a component and no file: listed, without a name to delete
    const orphan = componentRows(interView, [], interPolicy);
    expect(orphan.map(r => [r.vm, r.name, r.state])).toEqual([['vm-nato-landing-apisix-u2m-0', undefined, 'running'], ['vm-nato-landing-kafka-0', undefined, 'waiting']]);
    expect(componentRows(undefined, [], undefined)).toEqual([]);
  });

  it('knows the pieces a landing zone should have and what is missing', () => {
    expect(zones).toHaveLength(1);
    expect(zones[0].slots.map(s => [s.key, s.state])).toEqual([['apisix-u2m', 'running'], ['apisix-m2m', 'missing'], ['sftpgo', 'git'], ['kafka', 'waiting']]);
    expect(zones[0]).toMatchObject({ complete: false, clamav: false });
    expect(zones[0].common?.id).toBe('nato/common');
    expect(zones[0].programmes.map(p => p.id)).toEqual(['nato/sirtap', 'nato/a400m']);
    expect(zoneSlots('integration', []).map(s => s.key)).toEqual(['apisix-u2m', 'apisix-m2m']);
    expect(interconnectionAttention(zones)).toEqual([
      { tone: 'neg', key: 'ic.att.landing.m2m', vars: { zone: 'nato/landing' }, to: 'marketplace' },
      { tone: 'warn', key: 'ic.att.waiting', vars: { name: 'vm-nato-landing-kafka-0' }, to: 'interconnection' },
    ]);
  });

  it('draws the path of both lanes with the state of the pieces of this site', () => {
    const [u2m, m2m] = pathLanes(zones[0], 'core');
    expect(u2m.nodes.map(n => n.state)).toEqual(['remote', 'remote', 'planned', 'running', 'ok', 'ok']);
    expect(u2m.nodes[4].sub).toBe('VIP 10.102.1.200');
    expect(m2m.nodes.map(n => [n.title, n.state])).toEqual([['ic.path.services', 'remote'], ['APISIX M2M', 'remote'], ['ic.path.tunnel', 'planned'], ['APISIX M2M', 'missing'], ['SFTPGo', 'git'], ['Kafka', 'waiting']]);
    // on an edge site the gateways of the integration zone are its own and the core is the other site
    const edge = pathLanes({ ...zones[0], seg: { ...zones[0].seg, kind: 'integration' } }, 'edge');
    expect(edge[0].nodes.map(n => n.state)).toEqual(['remote', 'running', 'planned', 'remote', 'remote', 'remote']);
  });

  it('names and sizes a new component like the backend', () => {
    expect(policyComponents(interPolicy)).toEqual(['apisix', 'sftpgo', 'kafka']);
    expect(policyComponents({ ...interPolicy, components: undefined })).toEqual([]);
    expect(policyComponents(undefined)).toEqual([]);
    expect(componentName(['apisix-u2m-0'], 'apisix', 'u2m')).toBe('apisix-u2m-1');
    expect(componentName(['apisix-u2m-0'], 'apisix', 'm2m')).toBe('apisix-m2m-0');
    expect(componentName([], 'kafka')).toBe('kafka-0');
    expect(componentTitle('apisix', 'm2m')).toBe('APISIX M2M');
    expect(componentTitle('sftpgo')).toBe('SFTPGo');
    expect(overLimits(interPolicy.component_limits, interFiles, 'nato', 'landing', { cpu: 2, memory_mb: 4096 })).toEqual([]);
    expect(overLimits({ vms: 3, cpu: 16, memory_mb: 14000 }, interFiles, 'nato', 'landing', { cpu: 2, memory_mb: 4096 })).toEqual(['vms', 'memory_mb']);
    expect(overLimits(undefined, interFiles, 'nato', 'landing', { cpu: 2, memory_mb: 4096 })).toEqual([]);
  });

  it('calls the pull requests of a landing zone components', () => {
    const p = { number: 131, title: 'console: create component kafka-0', url: 'u', created: '2026-11-10T20:00:00Z', branch: 'console/vm-new-nato-landing-kafka-0-abc', body: '```json\n{"zone":"nato","program":"landing","name":"kafka-0","component":"kafka"}\n```' };
    expect(pullKind(p)).toBe('New component');
    expect(pullKind({ ...p, branch: 'console/vm-del-nato-landing-kafka-0-abc' })).toBe('Delete component');
    expect(pullKind({ ...p, body: '```json\n{"zone":"nato","program":"sirtap","name":"tools"}\n```' })).toBe('New VM');
    expect(lifecycle({ ...p, merged: '2026-11-10T21:00:00Z' }).label).toBe('Merged');
  });
});
