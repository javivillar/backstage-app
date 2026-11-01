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
export const SCALE_LIMITS = { workers: 8, storage: 3 };

export type ClusterFile = { zone: string; program: string; profile?: string; masters?: number; workers?: number; storage?: number; requested_by?: string; requested_at?: string };
export const clusterFileName = (zone: string, program: string) => `${zone}-${program}.json`;

/** The [[program]] blocks of network.toml: zone and n. */
export function tomlPrograms(text: string): Array<{ zone: string; n: number; name: string }> {
  const out: Array<{ zone: string; n: number; name: string }> = [];
  for (const block of text.split(/^\[\[program\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\[/m)[0];
    const get = (k: string) => body.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\n#]+?)"?\\s*(#.*)?$`, 'm'))?.[1]?.trim();
    const zone = get('zone');
    const n = Number(get('n'));
    const name = get('name');
    if (zone && name && Number.isInteger(n)) out.push({ zone, n, name });
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

/**
 * network.toml with a new programme (segregation) in a zone of the catalog, enabling the zone when it is reserved.
 * n: the highest used in network.toml or OpenNebula + 1, never reused (configuration.add_program). Returns the new
 * text and n, or the reason it cannot be done.
 */
export function addSegregation(text: string, view: ZoneView, zone: string, program: string): { text: string; n: number; enabled: boolean } | string {
  if (!PROGRAM_NAME.test(program)) return 'The programme name: lowercase letters, digits and "-", up to 31, starting with a letter or digit.';
  const z = (view.catalog ?? []).find(c => c.name === zone);
  if (!z) return `There is no zone ${zone} in the catalog.`;
  const declared = tomlPrograms(text).filter(p => p.zone === zone);
  if (declared.some(p => p.name === program) || z.programs.some(p => p.name === program)) return `${zone}/${program} already exists.`;
  const used = [...declared.map(p => p.n), ...z.programs.map(p => p.n).filter((n): n is number => typeof n === 'number')];
  const n = Math.max(0, ...used) + 1;
  if (n > (z.maxProgramN ?? 99)) return `No free programme numbers left in zone ${zone}.`;
  let out = text;
  const enabled = !z.enabled;
  if (enabled) out = enableZone(out, zone);
  out = `${out.replace(/\n+$/, '')}\n\n[[program]]\nzone = "${zone}"\nn = ${n}\nname = "${program}"\n`;
  return { text: out, n, enabled };
}

/** What a new cluster asks, or why it cannot be asked. files: the cluster files already in git. */
export function refuseCluster(view: ZoneView, files: ClusterFile[], req: { zone: string; program: string; profile: string; workers?: number }): string | undefined {
  const z = view.catalog?.find(c => c.name === req.zone);
  const known = z?.programs.find(p => p.name === req.program);
  if (!z || !known) return `There is no segregation ${req.zone}/${req.program} yet: create it first (its pull request merged and applied).`;
  const live = view.zones.find(x => x.name === req.zone)?.programs.find(p => p.name === req.program);
  if (live?.cluster) return `${req.zone}/${req.program} already has a cluster (${live.cluster.name}): scale it from its cluster.`;
  if (files.some(f => f.zone === req.zone && f.program === req.program)) return `A cluster for ${req.zone}/${req.program} is already asked.`;
  const profile = view.kubernetes?.profiles.find(p => p.name === req.profile);
  if (!profile) return `The profile is one of ${(view.kubernetes?.profiles ?? []).map(p => p.name).join(', ')}.`;
  if (req.workers !== undefined && !(Number.isInteger(req.workers) && req.workers >= 0 && req.workers <= SCALE_LIMITS.workers)) return `Workers: 0 to ${SCALE_LIMITS.workers}.`;
  const workers = req.workers ?? profile.counts.worker;
  const need = profile.memoryMb + (workers - profile.counts.worker) * profile.roles.worker.memory_mb;
  const free = view.capacity?.freeMemoryMb;
  if (typeof free === 'number' && need > free) return `It needs ${Math.round(need / 1024)} GB of memory and the hosts have ${Math.round(free / 1024)} GB unallocated.`;
  return undefined;
}

/** The scale of a cluster: its file with the new counts, or why not. */
export function scaleCluster(view: ZoneView, file: ClusterFile | undefined, req: { zone: string; program: string; workers: number; storage: number }, user: string): ClusterFile | string {
  const live = view.zones.find(x => x.name === req.zone)?.programs.find(p => p.name === req.program);
  if (!live?.cluster) return `There is no cluster in ${req.zone}/${req.program}.`;
  if (!(Number.isInteger(req.workers) && req.workers >= 0 && req.workers <= SCALE_LIMITS.workers)) return `Workers: 0 to ${SCALE_LIMITS.workers}.`;
  if (!(Number.isInteger(req.storage) && req.storage >= 0 && req.storage <= SCALE_LIMITS.storage)) return `Storage nodes: 0 to ${SCALE_LIMITS.storage}.`;
  const roles = live.cluster.roles ?? {};
  const now = { worker: Number(roles.worker ?? 0), storage: Number(roles.storage ?? 0) };
  if (now.worker === req.workers && now.storage === req.storage && file?.workers === req.workers && file?.storage === req.storage) return 'The cluster already has these nodes.';
  if (now.storage > 0 && req.storage < now.storage) return 'Storage nodes hold Longhorn replicas: the console only adds them (remove one with cluster-scale on the host, after draining it).';
  const profile = view.kubernetes?.profiles.find(p => p.name === (file?.profile ?? view.kubernetes?.defaultProfile));
  const free = view.capacity?.freeMemoryMb;
  if (profile && typeof free === 'number') {
    const more = Math.max(0, req.workers - now.worker) * profile.roles.worker.memory_mb + Math.max(0, req.storage - now.storage) * profile.roles.storage.memory_mb;
    if (more > free) return `The new nodes need ${Math.round(more / 1024)} GB of memory and the hosts have ${Math.round(free / 1024)} GB unallocated.`;
  }
  return { ...(file ?? { zone: req.zone, program: req.program }), workers: req.workers, storage: req.storage, requested_by: user, requested_at: new Date().toISOString() };
}
