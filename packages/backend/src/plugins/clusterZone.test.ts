import { summariseZone } from './clusterZone';

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
    expect(nato.router).toEqual({ name: 'vr-nato', exists: true, vms: [{ id: '7', name: 'vr-nato-0', state: 'ACTIVE', role: 'zone router', ips: ['10.102.0.2'] }] });
    expect(nato.transit).toMatchObject({ name: 'nato-transit', leases: 2, hostIp: '10.102.0.1', routerIp: '10.102.0.2' });
    const p = nato.programs[0];
    expect(p.cluster).toEqual({ name: 'oneke-nato-sirtap', state: 'RUNNING', vip: '10.102.1.200', roles: { master: 2, worker: 3 }, fqdn: '*.platform.nato.sirtap.iaas.refresquito.io' });
    expect(p.vms[0]).toEqual({ id: '21', name: 'oneke-ip-10-102-101-17', state: 'ACTIVE', role: 'master', host: 'refresquito', vcpu: '4', memoryGb: 4, ips: ['10.102.101.17'] });
    expect(z.host).toMatchObject({ name: 'refresquito', cpus: 16, availableGiB: 21.9 });
  });

  it('lists every difference with the design', () => {
    expect(summariseZone(raw).drift).toEqual([
      { zone: 'nato', program: 'sirtap', kind: 'network', name: 'nato-sirtap-pub', detail: 'VLAN 2005 in OpenNebula, 2001 in network.toml' },
      { zone: 'nato', program: 'sirtap', kind: 'security group', name: 'sg-nato-sirtap-pub', detail: 'rule not in the design: inbound TCP 8443 anywhere' },
    ]);
  });
});
