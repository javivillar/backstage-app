import { inventory, summariseZone } from './clusterZone';

const raw = {
  generated: '2026-11-01T10:00:00',
  warnings: [],
  host: { name: 'refresquito', cpus: 16, memory_gib: 62.5, available_gib: 21.9, supernet: '10.96.0.0/12', interfaces: [{ name: 'br-nato-t', addresses: ['10.102.0.1/24'], up: true }] },
  zones: [
    { name: 'occar', enabled: false, status: 'reserved', programs: [] },
    {
      name: 'nato',
      enabled: true,
      status: 'complete',
      block: '10.102.0.0/16',
      router: { name: 'vr-nato', exists: true, vms: [{ id: '7', name: 'vr-nato-0', state: 'ACTIVE', role: 'zone router', nics: [{ ip: '10.102.0.2' }] }] },
      transit: { name: 'nato-transit', cidr: '10.102.0.0/24', vlan: 2000, exists: true, leases: [{}, {}], host_ip: '10.102.0.1', router_ip: '10.102.0.2' },
      programs: [
        {
          name: 'sirtap',
          id: 'nato-sirtap',
          status: 'complete',
          ok: true,
          networks: [{ name: 'nato-sirtap-pub', role: 'public', cidr: '10.102.1.0/24', vlan: 2001, exists: true, leases: [{}], drift: ['VLAN 2005 in OpenNebula, 2001 in network.toml'] }],
          security_groups: [{ name: 'sg-nato-sirtap-pub', role: 'public', exists: true, source: 'OpenNebula', rules: ['inbound TCP 443 172.20.10.0/28'], extra: ['inbound TCP 8443 anywhere'], missing: [] }],
          vms: [{ id: '21', name: 'oneke-ip-10-102-101-17', state: 'ACTIVE', role: 'master', host: 'refresquito', vcpu: '4', memory_gb: 4, nics: [{ network: 'nato-sirtap-priv', ip: '10.102.101.17' }] }],
          cluster: { name: 'oneke-nato-sirtap', state: 'RUNNING', vip: '10.102.1.200', roles: { master: 2, worker: 3 }, fqdn: '*.platform.nato.sirtap.iaas.refresquito.io' },
        },
      ],
    },
  ],
};

describe('summariseZone', () => {
  it('keeps the zones in use with their programmes, VMs and networks', () => {
    const z = summariseZone(raw);
    expect(z.zones.map(x => x.name)).toEqual(['nato']);
    const nato = z.zones[0];
    expect(nato.router).toMatchObject({ name: 'vr-nato', exists: true, vms: [{ id: '7', name: 'vr-nato-0', state: 'ACTIVE', role: 'zone router', ips: ['10.102.0.2'] }] });
    expect(nato.transit).toMatchObject({ name: 'nato-transit', leases: 2, hostIp: '10.102.0.1', routerIp: '10.102.0.2' });
    const p = nato.programs[0];
    expect(p.cluster).toEqual({ name: 'oneke-nato-sirtap', state: 'RUNNING', vip: '10.102.1.200', roles: { master: 2, worker: 3 }, fqdn: '*.platform.nato.sirtap.iaas.refresquito.io' });
    expect(p.vms[0]).toMatchObject({ id: '21', name: 'oneke-ip-10-102-101-17', state: 'ACTIVE', role: 'master', host: 'refresquito', vcpu: '4', memoryGb: 4, ips: ['10.102.101.17'] });
    expect(z.host).toMatchObject({ name: 'refresquito', cpus: 16, availableGiB: 21.9 });
  });

  it('lists every difference with the design', () => {
    expect(summariseZone(raw).drift).toEqual([
      { zone: 'nato', program: 'sirtap', kind: 'network', name: 'nato-sirtap-pub', detail: 'VLAN 2005 in OpenNebula, 2001 in network.toml' },
      { zone: 'nato', program: 'sirtap', kind: 'security group', name: 'sg-nato-sirtap-pub', detail: 'rule not in the design: inbound TCP 8443 anywhere' },
    ]);
  });
});

describe('the interconnection in the zone view', () => {
  it('reads the site role, the kind of each segregation and the component of a VM', () => {
    const z = summariseZone({
      ...raw,
      site: { role: 'core' },
      zones: [
        {
          name: 'nato', enabled: true, status: 'complete',
          programs: [
            { name: 'landing', n: 3, kind: 'landing', id: 'nato-landing', status: 'complete', ok: true, vms: [{ id: '40', name: 'vm-nato-landing-apisix-m2m-0', state: 'ACTIVE', role: 'vm', console: true, component: 'apisix', traffic: 'm2m', nics: [{ ip: '10.102.3.10' }] }] },
            { name: 'sirtap', n: 1, id: 'nato-sirtap', status: 'complete', ok: true, vms: [{ id: '21', name: 'master-0', state: 'ACTIVE', role: 'master' }] },
          ],
        },
      ],
    });
    expect(z.site).toEqual({ role: 'core' });
    expect(z.catalog![0].programs.map(p => [p.name, p.kind])).toEqual([['landing', 'landing'], ['sirtap', undefined]]);
    expect(z.zones[0].programs[0]).toMatchObject({ kind: 'landing', vms: [{ component: 'apisix', traffic: 'm2m', ips: ['10.102.3.10'] }] });
    expect(z.zones[0].programs[1].vms[0].component).toBeUndefined();
    expect(summariseZone({ ...raw, site: { role: 'edge' } }).site).toEqual({ role: 'edge' });
  });

  it('a topology.json from before it has no site (read as a core site by who uses it)', () => {
    expect(summariseZone(raw).site).toBeUndefined();
    expect(summariseZone(raw).zones[0].programs[0].kind).toBeUndefined();
  });
});

describe('inventory', () => {
  it('maps the templates and storage of OpenNebula to the console shape', () => {
    const inv = inventory({
      vm_templates: [{ id: '11', name: 'Service OneKE 1.33-master', vrouter: false, vcpu: '4', memory_mb: 6144, disks: ['node 0.1.2'], networks: ['priv'], instances: ['master-0'], text: 'VCPU = "4"', registered: 1760000000 }],
      service_templates: [{ id: '2', name: 'Service OneKE 1.33', roles: [{ name: 'master', cardinality: 1, template_id: '11' }], instances: [{ name: 'oneke-nato-sirtap', state: '2' }], text: '{}' }],
      images: [{ id: '6', name: 'node 0.1.2', type: 'OS', datastore: 'default', size_mb: 25600, persistent: false, state: 'USED', vms: ['master-0'] }],
      datastores: [{ id: '1', name: 'default', type: 'image', state: 'READY', total_mb: 1000, free_mb: 600, used_mb: 400, images: 1, clusters: ['0'] }],
      backup_jobs: [{ id: '0', name: 'daily', vms: ['master-0'], keep_last: '7', last: 1762600000, schedule: [], outdated: 0, errors: 1 }],
      vm_backups: [{ vm: 'master-0', id: '27', count: 2, last: 1762600000, persistent_disks: 0 }],
    })!;
    expect(inv.vmTemplates[0]).toMatchObject({ memoryMb: 6144, instances: ['master-0'], registered: '2025-10-09T08:53:20.000Z' });
    expect(inv.serviceTemplates[0].roles[0]).toEqual({ name: 'master', cardinality: 1, templateId: '11' });
    expect(inv.datastores[0]).toMatchObject({ usedMb: 400, totalMb: 1000 });
    expect(inv.backupJobs[0]).toMatchObject({ errors: 1, last: '2025-11-08T11:06:40.000Z' });
    expect(inv.vmGroups).toEqual([]);
    expect(inventory(null)).toBeUndefined();
  });
});
