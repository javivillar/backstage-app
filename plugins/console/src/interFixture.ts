import type { InfraView, VmPolicy, VmRequest } from './zone';

/** A core site for the tests of the interconnection: nato with a programme and its cluster, a landing zone and common. */
const net = (name: string, role: string, cidr: string) => ({ name, role, cidr, vlan: 2000, exists: true, leases: 1, drift: [] });
const vm = (id: string, name: string, state: string, more: Record<string, unknown> = {}) => ({ id, name, state, role: 'vm', ips: [] as string[], ...more });

export const interView: InfraView = {
  generated: '2026-11-10T21:25:04Z', warnings: [], drift: [], domain: 'iaas.refresquito.io',
  site: { role: 'core' },
  host: { name: 'refresquito', cpus: 16, memoryGiB: 62.5, availableGiB: 10, supernet: '10.96.0.0/12', interfaces: [] },
  catalog: [
    { name: 'nato', label: 'NATO', status: 'complete', enabled: true, block: '10.102.0.0/16', maxProgramN: 99, programs: [
      { name: 'sirtap', n: 1, kind: 'programme', declared: true, ok: true, cluster: 'oneke-nato-sirtap' },
      { name: 'a400m', n: 2, kind: 'programme', declared: true, ok: true },
      { name: 'landing', n: 3, kind: 'landing', declared: true, ok: true },
      { name: 'common', n: 4, kind: 'common', declared: true, ok: true },
    ] },
    { name: 'diflim', label: 'Limited distribution', status: 'reserved', enabled: false, block: '10.104.0.0/16', maxProgramN: 99, programs: [] },
  ],
  zones: [{
    name: 'nato', label: 'NATO', status: 'complete', block: '10.102.0.0/16',
    router: { name: 'vr-nato', exists: true, vms: [vm('7', 'vr-nato-0', 'ACTIVE', { role: 'zone router', ips: ['10.102.0.2'] })] },
    programs: [
      { name: 'sirtap', id: 'nato-sirtap', status: 'complete', ok: true, kind: 'programme', cluster: { name: 'oneke-nato-sirtap', state: 'RUNNING', vip: '10.102.1.200', roles: { vnf: 1, master: 2, worker: 2, storage: 1 } }, networks: [], securityGroups: [], vms: [vm('21', 'master-0', 'ACTIVE', { role: 'master' })] },
      { name: 'a400m', id: 'nato-a400m', status: 'complete', ok: true, kind: 'programme', networks: [], securityGroups: [], vms: [] },
      { name: 'landing', id: 'nato-landing', status: 'complete', ok: true, kind: 'landing', networks: [net('nato-landing-pub', 'public', '10.102.3.0/24')], securityGroups: [], vms: [
        vm('40', 'vm-nato-landing-apisix-u2m-0', 'ACTIVE', { console: true, component: 'apisix', traffic: 'u2m', ips: ['10.102.3.10'] }),
        vm('41', 'vm-nato-landing-kafka-0', 'PENDING', { console: true, component: 'kafka' }),
      ] },
      { name: 'common', id: 'nato-common', status: 'complete', ok: true, kind: 'common', networks: [], securityGroups: [], vms: [] },
    ],
  }],
  kubernetes: {
    defaultProfile: 'minimal',
    profiles: [{
      name: 'minimal', default: true, description: 'One master', counts: { vnf: 1, master: 1, worker: 0, storage: 1 }, memoryMb: 20480,
      roles: { vnf: { vcpu: 2, memory_mb: 2048 }, master: { vcpu: 4, memory_mb: 4096 }, worker: { vcpu: 10, memory_mb: 20480 }, storage: { vcpu: 4, memory_mb: 6144 } }, k8sCis: true, longhorn: true,
    }],
  },
  capacity: { freeMemoryMb: 30720, reservedMemoryMb: 8192 },
  reconcile: { finished: '2026-11-10T21:21:04Z', error: null, segregation: null, clusters: [] },
};

/** The policy of console-vms-oneke 0.2.0. */
export const interPolicy: VmPolicy = {
  images: { 'ubuntu-22.04-cis': 'oneke-cis' },
  sizes: { small: { cpu: 1, memory_mb: 2048, disk_gb: 20 } },
  limits: { vms: 3, cpu: 4, memory_mb: 8192 },
  components: {
    apisix: { image: 'refresquito-apisix-coraza-ubuntu2404-0.1.4', kinds: ['landing', 'integration'], traffic: ['u2m', 'm2m'], cpu: [1, 2, 4], memory_mb: [2048, 4096, 8192], disk_gb: [20, 40, 80], cpu_model: 'host-passthrough' },
    sftpgo: { image: 'refresquito-sftpgo-ubuntu2404-0.1.2', kinds: ['landing'], cpu: [1, 2, 4], memory_mb: [2048, 4096, 8192], disk_gb: [20, 50, 100] },
    kafka: { image: 'refresquito-kafka-ubuntu2404-0.1.0', kinds: ['landing'], cpu: [1, 2, 4], memory_mb: [2048, 4096, 8192], disk_gb: [10, 20, 40] },
    forge: { image: 'refresquito-forge-ubuntu2404-0.1.0', kinds: ['integration'], cpu: [4, 8], memory_mb: [12288, 16384, 24576], disk_gb: [100, 200, 500] },
  },
  component_limits: { vms: 6, cpu: 16, memory_mb: 32768 },
};

export const interFiles: VmRequest[] = [
  { zone: 'nato', program: 'landing', name: 'apisix-u2m-0', component: 'apisix', traffic: 'u2m', cpu: 2, memory_mb: 4096, disk_gb: 20, requested_by: 'user:default/javi', state: { synced: true, ready: true, outputs: { ip: '10.102.3.10' } } },
  { zone: 'nato', program: 'landing', name: 'kafka-0', component: 'kafka', cpu: 2, memory_mb: 4096, disk_gb: 20, state: { synced: true, ready: false } },
  { zone: 'nato', program: 'landing', name: 'sftpgo-0', component: 'sftpgo', cpu: 2, memory_mb: 4096, disk_gb: 50 },
];
