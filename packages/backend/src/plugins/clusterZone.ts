/**
 * The zone layer of the console, read-only: what the OpenNebula host publishes every 5 minutes as topology.json in
 * the ConfigMap refresquito-topology of the Backstage namespace (opennebula configuration/topology.py, timer
 * one-topology-publish). Summarised here: the host, each zone with its router and transit, each programme with its
 * networks, security groups (and where they differ from network.toml), VMs and OneKE cluster.
 */

type Raw = Record<string, any>;

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
export type DriftItem = { zone: string; program?: string; kind: 'network' | 'security group' | 'router' | 'cluster'; name: string; detail: string };
export type ZoneView = {
  generated?: string;
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
  return {
    generated: raw.generated ? str(raw.generated) : undefined,
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
