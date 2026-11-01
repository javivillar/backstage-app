/**
 * The zone layer of the console, read-only: what the OpenNebula host publishes every 5 minutes as topology.json in
 * the ConfigMap refresquito-topology of the Backstage namespace (opennebula configuration/topology.py, timer
 * one-topology-publish). Summarised here: the host, each zone with its router and transit, each programme with its
 * networks, security groups (and where they differ from network.toml), VMs and OneKE cluster.
 */

type Raw = Record<string, any>;

export type ZoneVm = {
  id: string;
  name: string;
  state: string;
  role: string;
  host?: string;
  vcpu?: string;
  memoryGb?: number;
  ips: string[];
  /** detail page of the console */
  owner?: string;
  group?: string;
  cpuReserved?: string;
  started?: string;
  labels?: string;
  console?: boolean;
  requestedBy?: string;
  nics?: Array<{ network: string; ip: string; mac?: string; securityGroups?: string }>;
  disks?: Array<{ image: string; sizeMb: number; datastore?: string; target?: string }>;
  cpuPct?: number;
  memoryUsedGb?: number;
};
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
export type DriftItem = { zone: string; program?: string; kind: 'network' | 'security group' | 'router' | 'cluster'; name: string; detail: string };
/** What vms-apply did with each VM requested from the console (configuration/vms.py of opennebula). */
export type ConsoleVmStatus = { zone: string; program: string; name: string; size?: string; image?: string; wanted?: string; state: string; detail?: string; id?: string; requested_by?: string };
/** Every zone of the catalog (reserved ones too) with its programmes: where a new segregation can go. */
export type CatalogZone = { name: string; label?: string; status: string; enabled: boolean; block?: string; maxProgramN?: number; programs: Array<{ name: string; n?: number; declared: boolean; ok: boolean | null; cluster?: string }> };
/** A OneKE profile of [kubernetes.profiles]: the marketplace. */
export type ClusterProfile = {
  name: string;
  default: boolean;
  description: string;
  counts: Record<'vnf' | 'master' | 'worker' | 'storage', number>;
  memoryMb: number;
  roles: Record<'vnf' | 'master' | 'worker' | 'storage', { vcpu: number; memory_mb: number }>;
  nodeImage?: string;
  cni?: string;
  k8sCis: boolean;
  k8sPsa?: string;
  longhorn: boolean;
};
export type ReconcileStep = { file?: string; zone?: string; program?: string; action: string; state: string; detail?: string; at?: string };
/** What the host did following main (configuration.py reconcile). */
export type ReconcileStatus = { started?: string; finished?: string; error?: string | null; segregation?: { state: string; detail?: string; at?: string } | null; clusters: ReconcileStep[] };
export type ZoneView = {
  generated?: string;
  catalog?: CatalogZone[];
  kubernetes?: { profiles: ClusterProfile[]; defaultProfile?: string; template?: string };
  capacity?: { freeMemoryMb?: number; reservedMemoryMb?: number };
  reconcile?: ReconcileStatus;
  consoleVms?: { applied?: string; vms: ConsoleVmStatus[] };
  warnings: string[];
  host?: { name: string; cpus?: number; memoryGiB?: number; availableGiB?: number; supernet?: string; interfaces: Array<{ name: string; addresses: string[]; up: boolean }> };
  zones: Zone[];
  drift: DriftItem[];
};

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const rule = (r: unknown) => (typeof r === 'string' ? r : [r && (r as Raw).direction, (r as Raw)?.protocol, (r as Raw)?.ports, (r as Raw)?.peer].filter(Boolean).join(' '));

function vm(x: Raw): ZoneVm {
  return {
    id: str(x.id),
    name: str(x.name),
    state: str(x.state) || '?',
    role: str(x.role),
    host: x.host || undefined,
    vcpu: x.vcpu ? str(x.vcpu) : undefined,
    memoryGb: typeof x.memory_gb === 'number' ? x.memory_gb : undefined,
    ips: (x.nics ?? []).map((n: Raw) => str(n.ip)).filter(Boolean),
    owner: x.owner || undefined,
    group: x.group || undefined,
    cpuReserved: x.cpu_reserved ? str(x.cpu_reserved) : undefined,
    started: typeof x.started === 'number' ? new Date(x.started * 1000).toISOString() : undefined,
    labels: x.labels || undefined,
    console: x.console === true ? true : undefined,
    requestedBy: x.requested_by || undefined,
    nics: Array.isArray(x.nics) ? x.nics.map((n: Raw) => ({ network: str(n.network), ip: str(n.ip), mac: n.mac || undefined, securityGroups: n.security_groups || undefined })) : undefined,
    disks: Array.isArray(x.disks) ? x.disks.map((d: Raw) => ({ image: str(d.image), sizeMb: Number(d.size_mb ?? 0), datastore: d.datastore || undefined, target: d.target || undefined })) : undefined,
    cpuPct: typeof x.cpu_pct === 'number' ? x.cpu_pct : undefined,
    memoryUsedGb: typeof x.memory_used_gb === 'number' ? x.memory_used_gb : undefined,
  };
}

function network(x: Raw): ZoneNetwork {
  return {
    name: str(x.name),
    role: x.role || undefined,
    cidr: str(x.cidr),
    vlan: x.vlan,
    exists: !!x.exists,
    state: x.state || undefined,
    leases: Array.isArray(x.leases) ? x.leases.length : 0,
    drift: Array.isArray(x.drift) ? x.drift.map(str) : [],
  };
}

export function summariseZone(raw: Raw): ZoneView {
  const drift: DriftItem[] = [];
  const zones: Zone[] = (raw.zones ?? [])
    .filter((z: Raw) => z.enabled || (z.programs ?? []).length)
    .map((z: Raw) => {
      const zone = str(z.name);
      const router = z.router ? { name: str(z.router.name), exists: !!z.router.exists, vms: (z.router.vms ?? []).map(vm) } : undefined;
      if (router && !router.exists) drift.push({ zone, kind: 'router', name: router.name, detail: 'declared in network.toml, not in OpenNebula' });
      const transit = z.transit ? { ...network(z.transit), hostIp: z.transit.host_ip, routerIp: z.transit.router_ip } : undefined;
      const programs: ZoneProgram[] = (z.programs ?? []).map((p: Raw) => {
        const program = str(p.name);
        const networks = (p.networks ?? []).map(network);
        for (const n of networks) {
          if (!n.exists) drift.push({ zone, program, kind: 'network', name: n.name, detail: 'declared in network.toml, not in OpenNebula' });
          for (const d of n.drift) drift.push({ zone, program, kind: 'network', name: n.name, detail: d });
        }
        const securityGroups: ZoneSecurityGroup[] = (p.security_groups ?? []).map((g: Raw) => {
          const sg = { name: str(g.name), role: g.role || undefined, exists: !!g.exists, source: g.source || undefined, rules: (g.rules ?? []).map(rule), extra: (g.extra ?? []).map(rule), missing: (g.missing ?? []).map(rule) };
          if (!sg.exists) drift.push({ zone, program, kind: 'security group', name: sg.name, detail: 'declared in network.toml, not in OpenNebula' });
          for (const e of sg.extra) drift.push({ zone, program, kind: 'security group', name: sg.name, detail: `rule not in the design: ${e}` });
          for (const m of sg.missing) drift.push({ zone, program, kind: 'security group', name: sg.name, detail: `rule of the design missing: ${m}` });
          return sg;
        });
        const c = p.cluster;
        const cluster = c ? { name: str(c.name), state: str(c.state), vip: c.vip || undefined, roles: c.roles ?? {}, fqdn: c.fqdn || undefined } : undefined;
        if (cluster && /not read|failed|error/i.test(cluster.state)) drift.push({ zone, program, kind: 'cluster', name: cluster.name, detail: `OneFlow says: ${cluster.state}` });
        return { name: program, id: str(p.id), status: str(p.status), ok: typeof p.ok === 'boolean' ? p.ok : null, fqdn: p.fqdn || undefined, cluster, networks, securityGroups, vms: (p.vms ?? []).map(vm) };
      });
      return { name: zone, label: z.label || undefined, status: str(z.status), block: z.block || undefined, router, transit, programs };
    });
  const h = raw.host;
  const cv = raw.console_vms;
  const catalog: CatalogZone[] = (raw.zones ?? []).map((z: Raw) => ({
    name: str(z.name),
    label: z.label || undefined,
    status: str(z.status),
    enabled: !!z.enabled,
    block: z.block || undefined,
    maxProgramN: typeof z.max_program_n === 'number' ? z.max_program_n : undefined,
    programs: (z.programs ?? []).map((p: Raw) => ({ name: str(p.name), n: typeof p.n === 'number' ? p.n : undefined, declared: p.declared !== false, ok: typeof p.ok === 'boolean' ? p.ok : null, cluster: p.cluster?.name || undefined })),
  }));
  const k = raw.kubernetes;
  const rc = raw.reconcile;
  return {
    generated: raw.generated ? str(raw.generated) : undefined,
    catalog,
    kubernetes: k && Array.isArray(k.profiles)
      ? {
          defaultProfile: k.default_profile || undefined,
          template: k.template || undefined,
          profiles: k.profiles.map((p: Raw) => ({
            name: str(p.name),
            default: !!p.default,
            description: str(p.description),
            counts: p.counts ?? {},
            memoryMb: Number(p.memory_mb ?? 0),
            roles: p.roles ?? {},
            nodeImage: p.node_image || undefined,
            cni: p.cni || undefined,
            k8sCis: !!p.k8s_cis,
            k8sPsa: p.k8s_psa || undefined,
            longhorn: !!p.longhorn,
          })),
        }
      : undefined,
    capacity: raw.capacity ? { freeMemoryMb: raw.capacity.free_memory_mb ?? undefined, reservedMemoryMb: raw.capacity.reserved_memory_mb ?? undefined } : undefined,
    reconcile: rc ? { started: rc.started, finished: rc.finished, error: rc.error ?? null, segregation: rc.segregation ?? null, clusters: Array.isArray(rc.clusters) ? rc.clusters : [] } : undefined,
    consoleVms: cv && Array.isArray(cv.vms) ? { applied: cv.applied ? str(cv.applied) : undefined, vms: cv.vms as ConsoleVmStatus[] } : undefined,
    warnings: (raw.warnings ?? []).map(str),
    host: h
      ? {
          name: str(h.name),
          cpus: h.cpus,
          memoryGiB: h.memory_gib,
          availableGiB: h.available_gib,
          supernet: h.supernet,
          interfaces: (h.interfaces ?? []).map((i: Raw) => ({ name: str(i.name), addresses: (i.addresses ?? []).map(str), up: !!i.up })),
        }
      : undefined,
    zones,
    drift,
  };
}
