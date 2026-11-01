import type { ClusterNetwork } from './network';
import { certificateDays } from './network';
import type { ClusterOverview } from './overview';

export type Attention = { severity: 'bad' | 'warn' | 'info'; title: string; detail: string; to: string };

const ORDER = { bad: 0, warn: 1, info: 2 } as const;

/** What an operator of this cluster should look at, from the overview and the network (either may be missing). */
export function needsAttention(o?: ClusterOverview, n?: ClusterNetwork, now = new Date()): Attention[] {
  const out: Attention[] = [];
  if (o) {
    for (const node of o.nodes) {
      if (!node.ready) out.push({ severity: 'bad', title: `Node ${node.name} is not ready`, detail: 'its pods are being moved or are down', to: '/console/cluster' });
      else if (!node.schedulable) out.push({ severity: 'warn', title: `Node ${node.name} is cordoned`, detail: 'no new pods go to it', to: '/console/cluster' });
      const mem = node.memory.allocatable ? node.memory.requested / node.memory.allocatable : 0;
      if (mem > 0.9) out.push({ severity: 'warn', title: `Node ${node.name}: ${Math.round(mem * 100)}% of its memory requested`, detail: 'new pods may not fit', to: '/console/cluster' });
    }
    for (const a of o.apps.filter(x => x.health !== 'Healthy' && x.health !== 'Suspended')) {
      out.push({ severity: a.health === 'Degraded' || a.health === 'Missing' ? 'bad' : 'warn', title: `${a.name} is ${a.health}`, detail: `Argo CD · ${a.namespace ?? ''}`, to: '/console/applications' });
    }
    const outOfSync = o.apps.filter(x => x.sync !== 'Synced');
    if (outOfSync.length) {
      out.push({ severity: 'info', title: `${outOfSync.length} application${outOfSync.length === 1 ? '' : 's'} out of sync with git`, detail: outOfSync.slice(0, 4).map(x => x.name).join(', ') + (outOfSync.length > 4 ? '…' : ''), to: '/console/applications' });
    }
    for (const v of o.volumes ?? []) {
      if (v.usedBytes === undefined || !v.capacityBytes) continue;
      const share = v.usedBytes / v.capacityBytes;
      if (share >= 0.8) out.push({ severity: share >= 0.9 ? 'bad' : 'warn', title: `Volume ${v.pvc} is ${Math.round(share * 100)}% full`, detail: v.namespace, to: '/console/storage' });
    }
  }
  if (n) {
    const days = certificateDays(n, now);
    if (days !== undefined && days < 21) out.push({ severity: days < 7 ? 'bad' : 'warn', title: `The cluster certificate expires in ${days} days`, detail: n.certificate?.name ?? '', to: '/console/network' });
    if (n.certificate && !n.certificate.ready) out.push({ severity: 'bad', title: 'The cluster certificate is not ready', detail: 'cert-manager could not issue it', to: '/console/network' });
    const open = (n.namespaces ?? []).filter(x => !x.system && x.isolation === 'open').length;
    if (open) out.push({ severity: 'info', title: `${open} namespaces are open to the whole cluster`, detail: 'no NetworkPolicy; the segment policies let everything through', to: '/console/network' });
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
