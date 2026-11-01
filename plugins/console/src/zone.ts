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
export const useVmRequests = () => useClusterGet<{ policy: VmPolicy; vms: VmRequest[]; allowed: boolean }>('/zone/vms', 30_000);

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
