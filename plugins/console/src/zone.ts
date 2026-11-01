import { useClusterGet } from './namespace';

/** GET /api/cluster/zone (clusterZone.ts): the zone as the OpenNebula host publishes it, read-only. */
export type ZoneVm = { id: string; name: string; state: string; role: string; host?: string; vcpu?: string; memoryGb?: number; ips: string[] };
export type ZoneNetwork = { name: string; role?: string; cidr: string; vlan?: number | string; exists: boolean; state?: string; leases: number; drift: string[] };
export type ZoneSecurityGroup = { name: string; role?: string; exists: boolean; source?: string; rules: string[]; extra: string[]; missing: string[] };
export type ZoneProgram = {
  name: string;
  id: string;
  status: string;
  ok: boolean | null;
  fqdn?: string;
  cluster?: { name: string; state: string; vip?: string; roles: Record<string, number>; fqdn?: string };
  networks: ZoneNetwork[];
  securityGroups: ZoneSecurityGroup[];
  vms: ZoneVm[];
};
export type Zone = {
  name: string;
  label?: string;
  status: string;
  block?: string;
  router?: { name: string; exists: boolean; vms: ZoneVm[] };
  transit?: ZoneNetwork & { hostIp?: string; routerIp?: string };
  programs: ZoneProgram[];
};
export type DriftItem = { zone: string; program?: string; kind: string; name: string; detail: string };
export type ConsoleVmStatus = { zone: string; program: string; name: string; size?: string; image?: string; wanted?: string; state: string; detail?: string; id?: string; requested_by?: string };
export type ZoneView = {
  generated?: string;
  consoleVms?: { applied?: string; vms: ConsoleVmStatus[] };
  warnings: string[];
  host?: { name: string; cpus?: number; memoryGiB?: number; availableGiB?: number; supernet?: string; interfaces: Array<{ name: string; addresses: string[]; up: boolean }> };
  zones: Zone[];
  drift: DriftItem[];
};

export const useZone = () => useClusterGet<ZoneView>('/zone', 120_000);

/** All the VMs of a zone, with the programme they belong to (the zone routers as programme "zone"). */
export function zoneVms(z: Zone): Array<ZoneVm & { program: string }> {
  // a VM with leases on several networks (the zone router) is listed by every programme: once, the first time
  const seen = new Set<string>();
  return [...(z.router?.vms ?? []).map(v => ({ ...v, program: 'zone' })), ...z.programs.flatMap(p => p.vms.map(v => ({ ...v, program: p.name })))].filter(v => {
    const key = v.id || v.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** GET /api/cluster/zone/vms: the VMs requested from the console (files of console-vms-oneke) and their Workspace. */
export type VmPolicy = {
  images: Record<string, string>;
  sizes: Record<string, { cpu: number; memory_mb: number; disk_gb: number }>;
  limits: { vms?: number; cpu?: number; memory_mb?: number };
};
export type VmState = { synced?: boolean; ready?: boolean; message?: string; outputs?: Record<string, unknown> };
export type VmRequest = { zone: string; program: string; name: string; size: string; image: string; requested_by?: string; requested_at?: string; state?: VmState };
export const useVmRequests = () => useClusterGet<{ policy: VmPolicy; vms: VmRequest[]; pulls?: ConsolePull[]; allowed: boolean }>('/zone/vms', 30_000);

/** Where a VM is, in words: from its Workspace (Argo CD → Crossplane → Terraform → OpenNebula). */
export function vmStatus(v: VmRequest): { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'off'; detail: string } {
  const s = v.state;
  if (!s) return { label: 'In git', tone: 'info', detail: 'waiting for Argo CD to sync it' };
  if (s.synced === false) return { label: 'Failed', tone: 'bad', detail: s.message ?? 'Crossplane could not apply it' };
  if (s.ready) {
    const ip = s.outputs?.ip ? String(s.outputs.ip) : '';
    return { label: 'Running', tone: 'ok', detail: ip ? `address ${ip}` : '' };
  }
  return { label: 'Creating', tone: 'info', detail: s.message ?? 'Terraform is creating it in OpenNebula' };
}

/** Every zone of the catalog (reserved too) and its programmes: where a new segregation can go. */
export type CatalogZone = { name: string; label?: string; status: string; enabled: boolean; block?: string; maxProgramN?: number; programs: Array<{ name: string; n?: number; declared: boolean; ok: boolean | null; cluster?: string }> };
export type RoleName = 'vnf' | 'master' | 'worker' | 'storage';
/** A OneKE profile of the marketplace ([kubernetes.profiles] of network.toml). */
export type ClusterProfile = {
  name: string;
  default: boolean;
  description: string;
  counts: Record<RoleName, number>;
  memoryMb: number;
  roles: Record<RoleName, { vcpu: number; memory_mb: number }>;
  nodeImage?: string;
  cni?: string;
  k8sCis: boolean;
  k8sPsa?: string;
  longhorn: boolean;
};
export type ReconcileStep = { file?: string; zone?: string; program?: string; action: string; state: string; detail?: string; at?: string };
export type ReconcileStatus = { started?: string; finished?: string; error?: string | null; segregation?: { state: string; detail?: string; at?: string } | null; clusters: ReconcileStep[] };
/** The parts of GET /zone the Infrastructure pages use (the host publishes them with topology.json). */
export type InfraView = ZoneView & {
  catalog?: CatalogZone[];
  kubernetes?: { profiles: ClusterProfile[]; defaultProfile?: string; template?: string };
  capacity?: { freeMemoryMb?: number; reservedMemoryMb?: number };
  reconcile?: ReconcileStatus;
};

/** An open pull request of the console (branch console/...). */
export type ConsolePull = { number: number; title: string; url: string; branch: string; created: string };
export type ClusterFile = { zone: string; program: string; profile?: string; workers?: number; storage?: number; requested_by?: string; requested_at?: string };
/** GET /api/cluster/infra: open pull requests of segregations and clusters, and the cluster files in git. */
export const useInfra = () => useClusterGet<{ allowed: boolean; repo: string; pulls: ConsolePull[]; clusters: ClusterFile[] }>('/infra', 60_000);
export const SCALE_LIMITS = { workers: 8, storage: 3 };

/** What a pull request of the console asks, from its branch. */
export function pullKind(p: ConsolePull): string {
  const b = p.branch.replace(/^console\//, '');
  if (b.startsWith('vm-new-')) return 'New VM';
  if (b.startsWith('vm-del-')) return 'Delete VM';
  if (b.startsWith('seg-')) return 'New segregation';
  if (b.startsWith('cluster-')) return 'New cluster';
  return 'Change';
}

/** Where a programme is in what the host did following main: the last reconcile step for its cluster file. */
export function reconcileStep(r: ReconcileStatus | undefined, zone: string, program: string): ReconcileStep | undefined {
  return r?.clusters.find(c => c.zone === zone && c.program === program);
}
