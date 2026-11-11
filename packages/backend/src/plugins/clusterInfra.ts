/**
 * The Infrastructure layer of the console: new network segregations, new Kubernetes clusters and their scale, as code
 * in the opennebula repository (configuration/network.toml and configuration/clusters/<zone>-<program>.json). The
 * OpenNebula host follows main (configuration.py reconcile, every 5 min): network.toml changed -> apply, a cluster
 * file -> cluster-create or cluster-scale. New segregations and clusters go through a pull request; scaling is
 * committed directly. The checks here repeat the host's, so a request that would fail is refused at once.
 */
import type { ZoneView } from './clusterZone';

/** The programme name of configuration.py (PROGRAM_RE). */
export const PROGRAM_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
/** Limits of what the console may ask (the host checks the memory again). */
export const SCALE_LIMITS = { workers: 8, storage: 3, masters: 5 };

export type ClusterFile = { zone: string; program: string; profile?: string; node_image?: string; masters?: number; workers?: number; storage?: number; delete?: boolean; requested_by?: string; requested_at?: string };
export const clusterFileName = (zone: string, program: string) => `${zone}-${program}.json`;

/** What a segregation is: a programme, the common services of its zone, or the interconnection zone of the site. */
export const SEGREGATION_KINDS = ['programme', 'common', 'landing', 'integration'] as const;
export type SegregationKind = (typeof SEGREGATION_KINDS)[number];
/** Names nobody gives a programme: the name and the kind of these segregations are the same word. */
export const RESERVED_NAMES: readonly string[] = ['common', 'landing', 'integration'];
/** The kinds asked from the console (common comes by itself with the first segregation of a zone). */
export const ASKED_KINDS = ['programme', 'landing', 'integration'] as const;
export type SiteRole = 'core' | 'edge';

/** The kind of a segregation: what network.toml or the host says, else its reserved name, else a programme. */
export function kindOf(name: string, kind?: string): SegregationKind {
  if (kind && (SEGREGATION_KINDS as readonly string[]).includes(kind)) return kind as SegregationKind;
  return RESERVED_NAMES.includes(name) ? (name as SegregationKind) : 'programme';
}
/** The role of this OpenNebula installation: a core site (landing zones) unless the host says edge. */
export const siteRole = (view: Pick<ZoneView, 'site'>): SiteRole => (view.site?.role === 'edge' ? 'edge' : 'core');

export type TomlProgram = { zone: string; n: number; name: string; kind?: string };

/** The [[program]] blocks of network.toml: zone, n, name and the kind when it says one. */
export function tomlPrograms(text: string): TomlProgram[] {
  const out: TomlProgram[] = [];
  for (const block of text.split(/^\[\[program\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\[/m)[0];
    const get = (k: string) => body.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\n#]+?)"?\\s*(#.*)?$`, 'm'))?.[1]?.trim();
    const zone = get('zone');
    const n = Number(get('n'));
    const name = get('name');
    const kind = get('kind');
    if (zone && name && Number.isInteger(n)) out.push({ zone, n, name, ...(kind ? { kind } : {}) });
  }
  return out;
}

/** 'enabled = false' -> 'enabled = true' in the [[zone]] of that name (configuration.enable_in_text). */
export function enableZone(text: string, zone: string): string {
  const lines = text.split('\n');
  const heads = [...lines.flatMap((l, i) => (l.trim().startsWith('[') ? [i] : [])), lines.length];
  for (let h = 0; h < heads.length - 1; h++) {
    const [i, end] = [heads[h], heads[h + 1]];
    if (lines[i].trim() !== '[[zone]]') continue;
    if (!lines.slice(i, end).some(l => new RegExp(`^\\s*name\\s*=\\s*"${zone}"`).test(l))) continue;
    for (let j = i; j < end; j++) {
      if (/^\s*enabled\s*=\s*false\b/.test(lines[j])) {
        lines[j] = lines[j].replace('false', 'true');
        return lines.join('\n');
      }
    }
    return text; // already enabled
  }
  throw new Error(`Zone ${zone} is not in the catalog of network.toml.`);
}

export type TomlException = { from: string; to: string; protocol: 'TCP' | 'UDP'; ports: string; reason: string };
/** The port of the ClamAV of common, and the one of the cluster edge proxy of a programme. */
const CLAMAV = { protocol: 'TCP' as const, ports: '3310' };
const HTTPS = { protocol: 'TCP' as const, ports: '443' };

const programBlock = (zone: string, n: number, name: string, kind: SegregationKind) => `[[program]]\nzone = "${zone}"\nn = ${n}\nname = "${name}"\n${kind === 'programme' ? '' : `kind = "${kind}"\n`}`;
const exceptionBlock = (e: TomlException) => `[[exception]]\nfrom = "${e.from}"\nto = "${e.to}"\nprotocol = "${e.protocol}"\nports = "${e.ports}"\nreason = "${e.reason}"\n`;

/**
 * The exceptions a new segregation brings (design 2026-11-10): a programme reaches the ClamAV of common; a landing or
 * integration zone reaches it too and the edge proxy of every programme of its zone; a new programme is reached by
 * the landing zone of its zone. declared: the programmes of the zone in the file with the new ones; only
 * destinations that are there.
 */
export function segregationExceptions(zone: string, name: string, kind: SegregationKind, declared: TomlProgram[]): TomlException[] {
  const id = `${zone}/${name}`;
  const has = (k: SegregationKind) => declared.some(p => kindOf(p.name, p.kind) === k);
  const out: TomlException[] = [];
  if (kind === 'common') return out;
  if (has('common')) out.push({ from: id, to: `${zone}/common`, ...CLAMAV, reason: `${id} scans files with the ClamAV of ${zone}/common` });
  if (kind === 'programme') {
    if (has('landing')) out.push({ from: `${zone}/landing`, to: id, ...HTTPS, reason: `the gateways of ${zone}/landing reach the edge proxy of ${id}` });
    return out;
  }
  for (const p of declared.filter(x => kindOf(x.name, x.kind) === 'programme')) {
    out.push({ from: id, to: `${zone}/${p.name}`, ...HTTPS, reason: `the gateways of ${id} reach the edge proxy of ${zone}/${p.name}` });
  }
  return out;
}

export type AddedSegregation = {
  text: string;
  /** the name written (landing and integration have a fixed one) */
  program: string;
  kind: SegregationKind;
  n: number;
  enabled: boolean;
  /** n of the common segregation created with it (the first segregation of a zone) */
  common?: number;
  exceptions: TomlException[];
  /** what the change adds besides the segregation, for the title of the pull request */
  also: string[];
};

/**
 * network.toml with a new segregation in a zone of the catalog, enabling the zone when it is reserved. kind: a
 * programme (default), or the landing zone (core site) or integration zone (edge site) of the zone, whose name is the
 * kind. The first segregation of a zone brings its common, and each one the exceptions of segregationExceptions.
 * n: the highest used in network.toml or OpenNebula + 1, never reused (configuration.add_program). Returns the new
 * text and what it added, or the reason it cannot be done.
 */
export function addSegregation(text: string, view: ZoneView, zone: string, program: string, kind: string = 'programme'): AddedSegregation | string {
  if (!(ASKED_KINDS as readonly string[]).includes(kind)) return `The kind is one of ${ASKED_KINDS.join(', ')}.`;
  const k = kind as (typeof ASKED_KINDS)[number];
  const name = k === 'programme' ? program : k;
  if (k === 'programme') {
    if (!PROGRAM_NAME.test(name)) return 'The programme name: lowercase letters, digits and "-", up to 31, starting with a letter or digit.';
    if (RESERVED_NAMES.includes(name)) return `${name} is a reserved name: ${name === 'common' ? 'the common segregation comes by itself with the first segregation of a zone' : `ask it as the ${name} zone`}.`;
  }
  const role = siteRole(view);
  if (k === 'landing' && role !== 'core') return 'A landing zone belongs to a core site, and this is an edge site: ask its integration zone.';
  if (k === 'integration' && role !== 'edge') return 'An integration zone belongs to an edge site, and this is a core site: ask its landing zone.';
  const z = (view.catalog ?? []).find(c => c.name === zone);
  if (!z) return `There is no zone ${zone} in the catalog.`;
  const declared = tomlPrograms(text).filter(p => p.zone === zone);
  if (declared.some(p => p.name === name) || z.programs.some(p => p.name === name)) return `${zone}/${name} already exists.`;
  const used = [...declared.map(p => p.n), ...z.programs.map(p => p.n).filter((n): n is number => typeof n === 'number')];
  const first = declared.length === 0 && z.programs.length === 0;
  const next = Math.max(0, ...used) + 1;
  const n = first ? next + 1 : next;
  if (n > (z.maxProgramN ?? 99)) return `No free programme numbers left in zone ${zone}.`;
  let out = text;
  const enabled = !z.enabled;
  if (enabled) out = enableZone(out, zone);
  const blocks: string[] = [];
  const after = [...declared];
  if (first) {
    blocks.push(programBlock(zone, next, 'common', 'common'));
    after.push({ zone, n: next, name: 'common', kind: 'common' });
  }
  blocks.push(programBlock(zone, n, name, k));
  const exceptions = segregationExceptions(zone, name, k, after);
  blocks.push(...exceptions.map(exceptionBlock));
  out = `${out.replace(/\n+$/, '')}\n\n${blocks.join('\n')}`;
  const also = [
    ...(first ? [`${zone}/common`] : []),
    ...(exceptions.some(e => e.to === `${zone}/common`) ? ['exception to ClamAV'] : []),
    ...(exceptions.some(e => e.ports === HTTPS.ports) ? [`${exceptions.filter(e => e.ports === HTTPS.ports).length} exception(s) to the edge proxy`] : []),
  ];
  return { text: out, program: name, kind: k, n, enabled, ...(first ? { common: next } : {}), exceptions, also };
}

/** The [[table]] blocks of a TOML text: head line, and the end of its keys (comments and blank lines after them stay). */
function tomlBlocks(lines: string[], table: string): Array<{ from: number; to: number; body: string[] }> {
  const heads = [...lines.flatMap((l, i) => (/^\s*\[/.test(l) ? [i] : [])), lines.length];
  const out: Array<{ from: number; to: number; body: string[] }> = [];
  for (let h = 0; h < heads.length - 1; h++) {
    const i = heads[h];
    if (lines[i].trim() !== `[[${table}]]`) continue;
    let end = heads[h + 1];
    // what follows the last key belongs to the next block (its heading comment), not to this one
    while (end > i + 1 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
    out.push({ from: i, to: end, body: lines.slice(i, end) });
  }
  return out;
}

/** A TOML text without the [[table]] blocks that match, and without the blank lines they leave behind. */
function withoutBlocks(text: string, table: string, drop: (body: string[]) => boolean): { text: string; removed: number } {
  const lines = text.split('\n');
  const gone = tomlBlocks(lines, table).filter(b => drop(b.body));
  for (const b of [...gone].reverse()) {
    let from = b.from;
    while (from > 0 && lines[from - 1].trim() === '') from--;
    lines.splice(from, b.to - from, ...(from > 0 && b.to < lines.length && lines[b.to].trim() !== '' ? [''] : []));
  }
  return { text: gone.length ? `${lines.join('\n').replace(/\n+$/, '')}\n` : text, removed: gone.length };
}

const hasKey = (body: string[], k: string, v: string) => body.some(l => new RegExp(`^\\s*${k}\\s*=\\s*"${v}"`).test(l));

/**
 * network.toml without the [[program]] block of zone/program (the host then destroys it) and without every
 * [[exception]] from or to it (the host rejects an exception that names a programme that is not there).
 */
export function withoutProgram(text: string, zone: string, program: string): string | undefined {
  const out = withoutBlocks(text, 'program', b => hasKey(b, 'zone', zone) && hasKey(b, 'name', program));
  if (!out.removed) return undefined;
  const id = `${zone}/${program}`;
  return withoutBlocks(out.text, 'exception', b => hasKey(b, 'from', id) || hasKey(b, 'to', id)).text;
}

/**
 * Removing a segregation: never an admin programme (the console runs there), never one with a cluster (asked or
 * running) or VMs (they would be destroyed with its networks: the components of a landing or integration zone are
 * deleted first), and common goes last, when no other segregation of its zone is left. Returns the new network.toml
 * (without the exceptions that name it) or the reason.
 */
export function removeSegregation(text: string, view: ZoneView, files: ClusterFile[], vmCount: number, admins: string[], zone: string, program: string): string | { text: string } {
  const id = `${zone}/${program}`;
  if (admins.includes(id)) return `${id} is the programme of this console: it is not removed from here.`;
  const live = view.zones.find(z => z.name === zone)?.programs.find(p => p.name === program);
  if (live?.cluster) return `${id} has the cluster ${live.cluster.name}: delete the cluster first.`;
  if (files.some(f => f.zone === zone && f.program === program && !f.delete)) return `A cluster of ${id} is asked in git: delete it first.`;
  const declared = tomlPrograms(text).filter(p => p.zone === zone);
  const kind = kindOf(program, declared.find(p => p.name === program)?.kind ?? live?.kind);
  const vms = (live?.vms ?? []).filter(v => v.role !== 'zone router').length + vmCount;
  if (vms > 0) return `${id} has ${vms} VM(s): delete ${kind === 'landing' || kind === 'integration' ? 'its components' : 'them'} first.`;
  if (kind === 'common') {
    const others = new Set([...declared.map(p => p.name), ...((view.catalog ?? []).find(c => c.name === zone)?.programs ?? []).map(p => p.name)]);
    others.delete(program);
    if (others.size) return `${id} holds the services shared by the zone: it is removed last, after ${[...others].sort().map(o => `${zone}/${o}`).join(', ')}.`;
  }
  const out = withoutProgram(text, zone, program);
  if (!out) return `${id} is not in network.toml.`;
  return { text: out };
}

/** Deleting a cluster: its file with delete = true (the host runs cluster-destroy); never the console's own. */
export function deleteCluster(view: ZoneView, file: ClusterFile | undefined, admins: string[], zone: string, program: string, user: string): ClusterFile | string {
  const id = `${zone}/${program}`;
  if (admins.includes(id)) return `${id} is the cluster of this console: it is not deleted from here.`;
  const live = view.zones.find(z => z.name === zone)?.programs.find(p => p.name === program);
  if (!live?.cluster && !file) return `There is no cluster in ${id}.`;
  if (file?.delete) return `The deletion of the cluster of ${id} is already asked.`;
  return { ...(file ?? { zone, program }), delete: true, requested_by: user, requested_at: new Date().toISOString() };
}

/** What a new cluster asks, or why it cannot be asked. files: the cluster files already in git. */
export function refuseCluster(view: ZoneView, files: ClusterFile[], req: { zone: string; program: string; profile: string; workers?: number; nodeImage?: string }): string | undefined {
  const z = view.catalog?.find(c => c.name === req.zone);
  const known = z?.programs.find(p => p.name === req.program);
  if (!z || !known) return `There is no segregation ${req.zone}/${req.program} yet: create it first (its pull request merged and applied).`;
  const kind = kindOf(known.name, known.kind);
  if (kind !== 'programme') return `${req.zone}/${req.program} is a ${kind} segregation: only a programme has a Kubernetes cluster.`;
  const live = view.zones.find(x => x.name === req.zone)?.programs.find(p => p.name === req.program);
  if (live?.cluster) return `${req.zone}/${req.program} already has a cluster (${live.cluster.name}): scale it from its cluster.`;
  if (files.some(f => f.zone === req.zone && f.program === req.program)) return `A cluster for ${req.zone}/${req.program} is already asked.`;
  const profile = view.kubernetes?.profiles.find(p => p.name === req.profile);
  if (!profile) return `The profile is one of ${(view.kubernetes?.profiles ?? []).map(p => p.name).join(', ')}.`;
  // the node image (its OS and Kubernetes version) is one the host offers; none asked: the one of the profile
  const images = view.kubernetes?.nodeImages ?? [];
  if (req.nodeImage !== undefined && !images.some(i => i.name === req.nodeImage)) return images.length ? `The node image is one of ${images.map(i => i.name).join(', ')}.` : 'This host offers no choice of node image: the profile sets it.';
  if (req.workers !== undefined && !(Number.isInteger(req.workers) && req.workers >= 0 && req.workers <= SCALE_LIMITS.workers)) return `Workers: 0 to ${SCALE_LIMITS.workers}.`;
  const workers = req.workers ?? profile.counts.worker;
  const need = profile.memoryMb + (workers - profile.counts.worker) * profile.roles.worker.memory_mb;
  const free = view.capacity?.freeMemoryMb;
  if (typeof free === 'number' && need > free) return `It needs ${Math.round(need / 1024)} GB of memory and the hosts have ${Math.round(free / 1024)} GB unallocated.`;
  return undefined;
}

/** The scale of a cluster: its file with the new counts, or why not. */
export function scaleCluster(view: ZoneView, file: ClusterFile | undefined, req: { zone: string; program: string; workers: number; storage: number; masters?: number }, user: string): ClusterFile | string {
  const live = view.zones.find(x => x.name === req.zone)?.programs.find(p => p.name === req.program);
  if (!live?.cluster) return `There is no cluster in ${req.zone}/${req.program}.`;
  if (!(Number.isInteger(req.workers) && req.workers >= 0 && req.workers <= SCALE_LIMITS.workers)) return `Workers: 0 to ${SCALE_LIMITS.workers}.`;
  if (!(Number.isInteger(req.storage) && req.storage >= 0 && req.storage <= SCALE_LIMITS.storage)) return `Storage nodes: 0 to ${SCALE_LIMITS.storage}.`;
  if (file?.delete) return `The cluster of ${req.zone}/${req.program} is being deleted.`;
  const roles = live.cluster.roles ?? {};
  const now = { worker: Number(roles.worker ?? 0), storage: Number(roles.storage ?? 0), master: Number(roles.master ?? 0) };
  const masters = req.masters ?? now.master;
  if (!(Number.isInteger(masters) && masters >= 1 && masters <= SCALE_LIMITS.masters)) return `Masters: 1 to ${SCALE_LIMITS.masters}.`;
  if (masters < now.master) return 'Masters are only added from the console: removing one can break the etcd quorum (cluster-scale on the host, one at a time).';
  if (now.worker === req.workers && now.storage === req.storage && now.master === masters && file?.workers === req.workers && file?.storage === req.storage) return 'The cluster already has these nodes.';
  if (now.storage > 0 && req.storage < now.storage) return 'Storage nodes hold Longhorn replicas: the console only adds them (remove one with cluster-scale on the host, after draining it).';
  const profile = view.kubernetes?.profiles.find(p => p.name === (file?.profile ?? view.kubernetes?.defaultProfile));
  const free = view.capacity?.freeMemoryMb;
  if (profile && typeof free === 'number') {
    const more = Math.max(0, req.workers - now.worker) * profile.roles.worker.memory_mb + Math.max(0, req.storage - now.storage) * profile.roles.storage.memory_mb + Math.max(0, masters - now.master) * profile.roles.master.memory_mb;
    if (more > free) return `The new nodes need ${Math.round(more / 1024)} GB of memory and the hosts have ${Math.round(free / 1024)} GB unallocated.`;
  }
  return { ...(file ?? { zone: req.zone, program: req.program }), workers: req.workers, storage: req.storage, ...(masters !== now.master || file?.masters !== undefined ? { masters } : {}), requested_by: user, requested_at: new Date().toISOString() };
}

export const ACTION_KINDS = ['vm-poweroff', 'vm-resume', 'vm-reboot', 'cluster-stop', 'cluster-start', 'cluster-restart'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionFile = { kind: ActionKind; zone: string; program: string; vm?: string; requested_by: string; requested_at: string };

/** A one-off operation (file of configuration/actions, run once by the host), or why not. vms: names of console VMs. */
export function actionRequest(view: ZoneView, admins: string[], vms: Array<{ zone: string; program: string; name: string }>, b: { kind: string; zone: string; program: string; vm?: string }, user: string): { file: string; body: ActionFile } | string {
  if (!(ACTION_KINDS as readonly string[]).includes(b.kind)) return `The action is one of ${ACTION_KINDS.join(', ')}.`;
  const kind = b.kind as ActionKind;
  const id = `${b.zone}/${b.program}`;
  const live = view.zones.find(z => z.name === b.zone)?.programs.find(p => p.name === b.program);
  if (!live) return `There is no programme ${id}.`;
  if (kind.startsWith('vm-')) {
    if (!b.vm || !vms.some(v => v.zone === b.zone && v.program === b.program && v.name === b.vm)) return `There is no VM ${b.vm ?? ''} of the console in ${id}.`;
  } else {
    if (!live.cluster) return `There is no cluster in ${id}.`;
    if (kind === 'cluster-stop' && admins.includes(id)) return `${id} is the cluster of this console: it can be restarted, not stopped, from here.`;
  }
  const at = new Date().toISOString();
  const stamp = at.replace(/[-:]/g, '').replace(/\..*$/, '');
  const file = `${stamp}-${kind}-${b.zone}-${b.program}${b.vm ? `-${b.vm}` : ''}.json`;
  return { file, body: { kind, zone: b.zone, program: b.program, ...(b.vm ? { vm: b.vm } : {}), requested_by: user, requested_at: at } };
}
