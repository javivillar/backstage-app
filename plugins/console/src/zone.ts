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
export type ZoneView = {
  generated?: string;
  warnings: string[];
  host?: { name: string; cpus?: number; memoryGiB?: number; availableGiB?: number; supernet?: string; interfaces: Array<{ name: string; addresses: string[]; up: boolean }> };
  zones: Zone[];
  drift: DriftItem[];
};

export const useZone = () => useClusterGet<ZoneView>('/zone', 120_000);

/** All the VMs of a zone, with the programme they belong to (the zone routers as programme "zone"). */
export function zoneVms(z: Zone): Array<ZoneVm & { program: string }> {
  return [...(z.router?.vms ?? []).map(v => ({ ...v, program: 'zone' })), ...z.programs.flatMap(p => p.vms.map(v => ({ ...v, program: p.name })))];
}
