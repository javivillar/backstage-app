import { type CatalogZone, consoleVmName, type InfraView, type VmLimits, type VmPolicy, type VmRequest, vmStatus, type ZoneProgram, type ZoneVm } from './zone';

/**
 * The model of the interconnection (design 2026-11-10), from what the console already reads: the zone view of the host
 * (GET /zone: site role, kind of each segregation, VMs with their component) and the VM files of console-vms-oneke
 * (GET /zone/vms: the components asked and the policy). Everything here tolerates the fields being absent: a site
 * without role is a core, a segregation without kind is what its name says, a policy without components offers none.
 */
export type SegKind = 'programme' | 'common' | 'landing' | 'integration';
export const SEG_KINDS: SegKind[] = ['programme', 'common', 'landing', 'integration'];
/** Names nobody gives a programme: the name and the kind of these segregations are the same word. */
export const RESERVED_NAMES: readonly string[] = ['common', 'landing', 'integration'];
export type SiteRole = 'core' | 'edge';

export function kindOf(name: string, kind?: string): SegKind {
  if (kind && (SEG_KINDS as string[]).includes(kind)) return kind as SegKind;
  return RESERVED_NAMES.includes(name) ? (name as SegKind) : 'programme';
}
export const siteRole = (view?: Pick<InfraView, 'site'>): SiteRole => (view?.site?.role === 'edge' ? 'edge' : 'core');
/** The interconnection zone a site may hold: landing zones on a core, an integration zone on an edge. */
export const interconnectionKind = (role: SiteRole): 'landing' | 'integration' => (role === 'edge' ? 'integration' : 'landing');

const isVm = (v: ZoneVm) => v.role !== 'zone router';

/** A segregation of the catalog with what OpenNebula has of it. */
export type Seg = {
  zone: string;
  name: string;
  id: string;
  kind: SegKind;
  n?: number;
  declared: boolean;
  ok: boolean | null;
  cluster?: string;
  live?: ZoneProgram;
  /** VMs that are not the zone router */
  vms: number;
};

/** Every segregation of every zone of the catalog (an older host without catalog: the zones in use). */
export function segregations(view: InfraView): Seg[] {
  const live = new Map<string, ZoneProgram>(view.zones.flatMap(z => z.programs.map(p => [`${z.name}/${p.name}`, p] as [string, ZoneProgram])));
  const catalog: CatalogZone[] =
    view.catalog ?? view.zones.map(z => ({ name: z.name, label: z.label, status: z.status, enabled: true, block: z.block, programs: z.programs.map(p => ({ name: p.name, kind: p.kind, declared: true, ok: p.ok, cluster: p.cluster?.name })) }));
  return catalog.flatMap(z =>
    z.programs.map(p => {
      const id = `${z.name}/${p.name}`;
      const l = live.get(id);
      return { zone: z.name, name: p.name, id, kind: kindOf(p.name, p.kind ?? l?.kind), n: p.n, declared: p.declared, ok: p.ok, cluster: p.cluster ?? l?.cluster?.name, live: l, vms: (l?.vms ?? []).filter(isVm).length };
    }),
  );
}

export function kindCounts(segs: Seg[]): Record<SegKind, number> {
  const out: Record<SegKind, number> = { programme: 0, common: 0, landing: 0, integration: 0 };
  for (const s of segs) out[s.kind]++;
  return out;
}

export type Why = { key: string; vars?: Record<string, string | number> };

/**
 * Why a segregation cannot be removed yet (the rules of the backend, removeSegregation), as a message key; undefined
 * when Remove may open its pull request.
 */
export function removalBlock(
  seg: Seg,
  all: Seg[],
  ctx: { admins: string[]; askedClusters: string[]; vmFiles: number; pending: string[]; allowed: boolean },
): Why | undefined {
  if (ctx.pending.includes(seg.id)) return { key: 'ic.block.pending' };
  if (ctx.admins.includes(seg.id)) return { key: 'ic.block.own' };
  if (seg.cluster) return { key: 'ic.block.cluster', vars: { name: seg.cluster } };
  if (ctx.askedClusters.includes(seg.id)) return { key: 'ic.block.clusterAsked' };
  const vms = Math.max(seg.vms, ctx.vmFiles);
  if (vms > 0) return { key: seg.kind === 'landing' || seg.kind === 'integration' ? 'ic.block.components' : 'ic.block.vms', vars: { n: vms } };
  if (seg.kind === 'common' && all.some(o => o.zone === seg.zone && o.id !== seg.id)) return { key: 'ic.block.common' };
  if (!seg.declared) return { key: 'ic.block.undeclared' };
  if (!ctx.allowed) return { key: 'ic.block.admin' };
  return undefined;
}

/** The components in the order they are offered. */
export const COMPONENT_ORDER = ['apisix', 'sftpgo', 'kafka'];
const COMPONENT_NAMES: Record<string, string> = { apisix: 'APISIX', sftpgo: 'SFTPGo', kafka: 'Kafka', clamav: 'ClamAV' };
/** APISIX U2M, SFTPGo, Kafka... */
export function componentTitle(component: string, traffic?: string): string {
  return `${COMPONENT_NAMES[component] ?? component}${traffic ? ` ${traffic.toUpperCase()}` : ''}`;
}
/** The components of the policy in the order of the marketplace (the known ones first). */
export function policyComponents(policy?: VmPolicy): string[] {
  const names = Object.keys(policy?.components ?? {});
  return [...COMPONENT_ORDER.filter(c => names.includes(c)), ...names.filter(c => !COMPONENT_ORDER.includes(c)).sort()];
}

/** The name the backend gives a new component: <component>[-<traffic>]-<n>, the first free n. */
export function componentName(taken: string[], component: string, traffic?: string): string {
  const base = `${component}${traffic ? `-${traffic}` : ''}`;
  for (let n = 0; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

/** Which component_limits a new component would pass in its segregation (empty: it fits). */
export function overLimits(limits: VmLimits | undefined, existing: VmRequest[], zone: string, program: string, ask: { cpu: number; memory_mb: number }): Array<keyof VmLimits> {
  const mine = existing.filter(v => v.zone === zone && v.program === program && v.component);
  const used: Required<VmLimits> = {
    vms: mine.length + 1,
    cpu: mine.reduce((t, v) => t + Number(v.cpu ?? 0), 0) + ask.cpu,
    memory_mb: mine.reduce((t, v) => t + Number(v.memory_mb ?? 0), 0) + ask.memory_mb,
  };
  return (['vms', 'cpu', 'memory_mb'] as const).filter(k => limits?.[k] !== undefined && used[k] > limits[k]!);
}

export type ComponentState = 'running' | 'creating' | 'waiting' | 'failed' | 'git' | 'stopped';
/** A component VM: its file in git (when it has one), its Workspace and what OpenNebula says. */
export type ComponentRow = {
  zone: string;
  program: string;
  /** name of the file (apisix-m2m-0); undefined for a VM OpenNebula has and git does not */
  name?: string;
  /** name in OpenNebula: vm-<zone>-<programme>-<name> */
  vm: string;
  component: string;
  traffic?: string;
  image?: string;
  cpu?: number;
  memoryMb?: number;
  diskGb?: number;
  state: ComponentState;
  detail: string;
  address?: string;
  requestedBy?: string;
};

const runs = (state: string) => state === 'ACTIVE' || state === 'RUNNING';

function liveState(v: ZoneVm): { state: ComponentState; detail: string } {
  if (runs(v.state)) return { state: 'running', detail: '' };
  if (v.state === 'PENDING') return { state: 'waiting', detail: '' };
  if (/FAIL|ERROR|UNKNOWN/.test(v.state)) return { state: 'failed', detail: v.state };
  if (/POWEROFF|STOPPED|SUSPENDED|UNDEPLOYED/.test(v.state)) return { state: 'stopped', detail: v.state };
  return { state: 'creating', detail: v.state };
}

/** The components of every landing and integration zone: the files in git joined with the VMs of OpenNebula. */
export function componentRows(view: InfraView | undefined, vms: VmRequest[], policy?: VmPolicy): ComponentRow[] {
  const live = new Map<string, { zone: string; program: string; vm: ZoneVm }>();
  for (const z of view?.zones ?? []) for (const p of z.programs) for (const v of p.vms) live.set(v.name, { zone: z.name, program: p.name, vm: v });
  const rows: ComponentRow[] = [];
  const seen = new Set<string>();
  for (const f of vms.filter(v => v.component)) {
    const vm = consoleVmName(f);
    seen.add(vm);
    const l = live.get(vm)?.vm;
    const st = vmStatus(f);
    let state: { state: ComponentState; detail: string };
    if (l) state = liveState(l);
    else if (st.label === 'In git') state = { state: 'git', detail: '' };
    else if (st.label === 'Failed') state = { state: 'failed', detail: st.detail };
    else if (st.label === 'Running') state = { state: 'running', detail: '' };
    else state = { state: 'creating', detail: '' };
    const ip = l?.ips[0] ?? (f.state?.outputs?.ip ? String(f.state.outputs.ip) : undefined);
    rows.push({
      zone: f.zone, program: f.program, name: f.name, vm, component: f.component!, traffic: f.traffic, image: policy?.components?.[f.component!]?.image,
      cpu: f.cpu, memoryMb: f.memory_mb, diskGb: f.disk_gb, ...state, address: ip, requestedBy: f.requested_by,
    });
  }
  // a VM with the tag of a component that git no longer has (its file was deleted and Crossplane has not removed it yet)
  for (const [name, l] of live) {
    if (!l.vm.component || seen.has(name)) continue;
    rows.push({
      zone: l.zone, program: l.program, vm: name, component: l.vm.component, traffic: l.vm.traffic, image: l.vm.disks?.[0]?.image,
      cpu: l.vm.vcpu ? Number(l.vm.vcpu) : undefined, memoryMb: l.vm.memoryGb !== undefined ? Math.round(l.vm.memoryGb * 1024) : undefined, ...liveState(l.vm), address: l.vm.ips[0], requestedBy: l.vm.requestedBy,
    });
  }
  return rows.sort((a, b) => `${a.zone}/${a.program}/${a.vm}`.localeCompare(`${b.zone}/${b.program}/${b.vm}`));
}

export type SlotState = ComponentState | 'missing';
/** A piece an interconnection zone should have, and the VMs that fill it. */
export type Slot = { key: string; component: string; traffic?: string; rows: ComponentRow[]; state: SlotState };

const BEST: SlotState[] = ['running', 'creating', 'git', 'waiting', 'stopped', 'failed', 'missing'];

/** The pieces of a landing zone (two gateways, files, events) or an integration zone (its two gateways). */
export function zoneSlots(kind: SegKind, rows: ComponentRow[]): Slot[] {
  const wanted: Array<[string, string?]> = [['apisix', 'u2m'], ['apisix', 'm2m'], ...(kind === 'landing' ? ([['sftpgo'], ['kafka']] as Array<[string, string?]>) : [])];
  return wanted.map(([component, traffic]) => {
    const mine = rows.filter(r => r.component === component && (r.traffic ?? undefined) === traffic);
    const state = mine.length ? BEST.find(s => mine.some(r => r.state === s))! : 'missing';
    return { key: `${component}${traffic ? `-${traffic}` : ''}`, component, traffic, rows: mine, state };
  });
}

/** A landing or integration zone with its pieces, the common of its zone and the programmes it serves. */
export type InterZone = {
  seg: Seg;
  slots: Slot[];
  rows: ComponentRow[];
  common?: Seg;
  /** a VM runs in common (the ClamAV of the zone) */
  clamav: boolean;
  programmes: Seg[];
  /** every piece runs */
  complete: boolean;
};

export function interconnectionZones(segs: Seg[], rows: ComponentRow[]): InterZone[] {
  return segs
    .filter(s => s.kind === 'landing' || s.kind === 'integration')
    .map(seg => {
      const mine = rows.filter(r => r.zone === seg.zone && r.program === seg.name);
      const slots = zoneSlots(seg.kind, mine);
      const common = segs.find(s => s.zone === seg.zone && s.kind === 'common');
      return { seg, slots, rows: mine, common, clamav: (common?.vms ?? 0) > 0, programmes: segs.filter(s => s.zone === seg.zone && s.kind === 'programme'), complete: slots.every(s => s.state === 'running') };
    });
}

export type InterAttention = { tone: 'neg' | 'warn'; key: string; vars: Record<string, string | number>; to: 'marketplace' | 'interconnection' };

/** What needs attention in the interconnection: a zone without a gateway, a component waiting for room or failed. */
export function interconnectionAttention(zones: InterZone[]): InterAttention[] {
  const out: InterAttention[] = [];
  for (const z of zones) {
    for (const s of z.slots.filter(x => x.component === 'apisix' && x.state === 'missing')) {
      out.push({ tone: 'neg', key: `ic.att.${z.seg.kind}.${s.traffic}`, vars: { zone: z.seg.id }, to: 'marketplace' });
    }
    for (const r of z.rows.filter(x => x.state === 'waiting')) out.push({ tone: 'warn', key: 'ic.att.waiting', vars: { name: r.vm }, to: 'interconnection' });
    for (const r of z.rows.filter(x => x.state === 'failed')) out.push({ tone: 'neg', key: 'ic.att.failed', vars: { name: r.vm }, to: 'interconnection' });
  }
  return out;
}

export type PathNode = { title: string; sub: string; state: SlotState | 'remote' | 'planned' | 'ok'; own: boolean };
export type PathLane = { id: 'u2m' | 'm2m'; nodes: PathNode[] };

/**
 * The path of the design for one interconnection zone, both lanes: client → gateway of the edge → the IPsec tunnel the
 * edge opens → gateway of the core → the cluster edge proxy (U2M) or the file and event endpoints (M2M). The pieces of
 * this site carry their state; the other site is another OpenNebula (remote) and the tunnel is not built yet (planned).
 * The texts are message keys the page translates.
 */
export function pathLanes(z: InterZone, role: SiteRole): PathLane[] {
  const slot = (key: string) => z.slots.find(s => s.key === key);
  const gateway = (traffic: 'u2m' | 'm2m', side: SiteRole): PathNode => {
    const own = side === role;
    const s = own ? slot(`apisix-${traffic}`) : undefined;
    return { title: componentTitle('apisix', traffic), sub: side === 'core' ? 'ic.path.landing' : 'ic.path.integration', state: own ? s?.state ?? 'missing' : 'remote', own };
  };
  const tunnel: PathNode = { title: 'ic.path.tunnel', sub: 'ic.path.tunnelSub', state: 'planned', own: false };
  const vips = z.programmes.map(p => p.live?.cluster?.vip).filter(Boolean).join(', ');
  const clusters = z.programmes.filter(p => p.cluster).map(p => p.cluster!);
  const core = role === 'core';
  // on the core the edge proxy and the applications are its own clusters; on an edge they are on the other site
  const there: PathNode['state'] = clusters.length ? 'ok' : 'missing';
  const proxy: PathNode = core
    ? { title: 'ic.path.proxy', sub: vips ? `VIP ${vips}` : 'ic.path.noCluster', state: there, own: true }
    : { title: 'ic.path.proxy', sub: 'ic.path.coreSide', state: 'remote', own: false };
  const app: PathNode = core
    ? { title: 'ic.path.app', sub: clusters.join(', ') || 'ic.path.noCluster', state: there, own: true }
    : { title: 'ic.path.app', sub: 'ic.path.coreSide', state: 'remote', own: false };
  const endpoint = (key: 'sftpgo' | 'kafka'): PathNode => ({ title: componentTitle(key), sub: key === 'sftpgo' ? 'ic.path.files' : 'ic.path.events', state: core ? slot(key)?.state ?? 'missing' : 'remote', own: core });
  return [
    { id: 'u2m', nodes: [{ title: 'ic.path.browser', sub: 'ic.path.browserSub', state: 'remote', own: false }, gateway('u2m', 'edge'), tunnel, gateway('u2m', 'core'), proxy, app] },
    { id: 'm2m', nodes: [{ title: 'ic.path.services', sub: 'ic.path.servicesSub', state: 'remote', own: false }, gateway('m2m', 'edge'), tunnel, gateway('m2m', 'core'), endpoint('sftpgo'), endpoint('kafka')] },
  ];
}
