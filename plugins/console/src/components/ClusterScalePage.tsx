import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useConsoleConfig } from '../config';
import { useClusterPost } from '../post';
import { type InfraView, reconcileStep, SCALE_LIMITS, useInfra, useZone } from '../zone';
import { Badge } from './Badge';
import { Flow, TONES } from './Flow';
import { ReconcileCard, stepTone } from './InfraPages';
import { Card } from './NamespaceSections';
import { ConfirmBar, ResultNote, useChange } from './Requests';

const ROLES = ['master', 'worker', 'storage'] as const;

/**
 * Scale a cluster: masters (only added), workers and storage nodes, committed directly; the host scales it.
 * Kubernetes › Scale (this cluster) or Infrastructure › Clusters › Scale (/console/infrastructure/clusters/:zone/:program).
 */
export const ClusterScalePage = () => {
  const cfg = useConsoleConfig();
  const params = useParams();
  const target = { zone: params.zone ?? cfg.cluster.zone ?? '', program: params.program ?? cfg.cluster.program ?? '' };
  const { loading, data, error, reload } = useZone();
  const infra = useInfra();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { reload(); infra.reload(); });
  const [form, setForm] = useState<{ workers?: number; storage?: number; masters?: number }>({});
  const [confirm, setConfirm] = useState(false);
  const view = data as InfraView | undefined;
  const zone = view?.zones.find(z => z.name === target.zone);
  const prog = zone?.programs.find(p => p.name === target.program);
  const cluster = prog?.cluster;
  const roles = cluster?.roles ?? {};
  const now = { worker: Number(roles.worker ?? 0), storage: Number(roles.storage ?? 0), master: Number(roles.master ?? 0) };
  const file = (infra.data?.clusters ?? []).find(c => c.zone === zone?.name && c.program === prog?.name);
  const workers = form.workers ?? file?.workers ?? now.worker;
  const storage = form.storage ?? file?.storage ?? now.storage;
  const masters = form.masters ?? file?.masters ?? now.master;
  const profile = view?.kubernetes?.profiles.find(p => p.name === (file?.profile ?? view.kubernetes?.defaultProfile));
  const more = profile
    ? Math.max(0, workers - now.worker) * profile.roles.worker.memory_mb + Math.max(0, storage - now.storage) * profile.roles.storage.memory_mb + Math.max(0, masters - now.master) * profile.roles.master.memory_mb
    : 0;
  const free = view?.capacity?.freeMemoryMb;
  const changed = workers !== now.worker || storage !== now.storage || masters !== now.master;
  const step = reconcileStep(view?.reconcile, target.zone, target.program);
  const title = params.zone ? `${target.zone}/${target.program}` : cfg.cluster.id;
  const scale = () =>
    run(
      () => post('/infra/clusters/scale', { zone: zone!.name, program: prog!.name, workers, storage, ...(masters !== now.master ? { masters } : {}) }),
      () => `Committed: ${masters} masters, ${workers} workers and ${storage} storage nodes. The host scales the cluster within 5 minutes; new nodes join in about 10.`,
    );
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1100 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Scale cluster {title}
        </Typography>
        <Typography color="text.secondary">Masters, workers and storage nodes of this OneKE cluster. The change is committed to main directly (no review) and the host applies it.</Typography>
      </Box>
      {loading && !view && <Progress />}
      {error && <WarningPanel title="The cluster could not be read" message={error} />}
      {view && !cluster && <WarningPanel severity="info" title="No cluster published for this programme" message={`The host publishes no OneKE cluster for ${target.zone || '?'}/${target.program || '?'}.`} />}
      {cluster && (
        <>
          <Card title="Now" sub={`${cluster.name} · ${cluster.state}`}>
            <Flow
              label="Nodes of the cluster by role"
              lanes={ROLES.map(r => ({
                label: r === 'storage' ? 'Storage (Longhorn)' : `${r[0].toUpperCase()}${r.slice(1)}s`,
                nodes: now[r] ? Array.from({ length: now[r] }, (_, i) => ({ title: `${r} ${i}`, sub: profile ? `${profile.roles[r].vcpu} vCPU · ${Math.round(profile.roles[r].memory_mb / 1024)} GB` : '', tone: 'ok' as const })) : [{ title: 'none', tone: 'off' as const, dashed: true }],
              }))}
            />
            {step && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2">Host:</Typography>
                <Badge label={`${step.action} · ${step.state}`} {...TONES[stepTone(step.state)]} />
              </Box>
            )}
          </Card>
          <Card title="Change" sub="Masters and storage nodes are only added: removing a master can break the etcd quorum and a storage node holds Longhorn replicas (both by hand on the host). Keep an odd number of masters (3) for a quorum that survives one loss.">
            {!infra.data?.allowed && infra.data && <Typography variant="body2" color="text.secondary">Only backstage-admin can scale clusters for now.</Typography>}
            <Box component="form" onSubmit={e => { e.preventDefault(); setConfirm(true); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', alignItems: 'start' }}>
              <TextField size="small" type="number" label="Masters" value={masters} onChange={e => setForm(f => ({ ...f, masters: Number(e.target.value) }))} inputProps={{ min: now.master, max: SCALE_LIMITS.masters }} helperText={`now ${now.master} · only more, up to ${SCALE_LIMITS.masters}${masters % 2 === 0 ? ' · an odd number is safer' : ''}`} />
              <TextField size="small" type="number" label="Workers" value={workers} onChange={e => setForm(f => ({ ...f, workers: Number(e.target.value) }))} inputProps={{ min: 0, max: SCALE_LIMITS.workers }} helperText={`now ${now.worker} · 0 to ${SCALE_LIMITS.workers}`} />
              <TextField size="small" type="number" label="Storage nodes" value={storage} onChange={e => setForm(f => ({ ...f, storage: Number(e.target.value) }))} inputProps={{ min: now.storage, max: SCALE_LIMITS.storage }} helperText={`now ${now.storage} · up to ${SCALE_LIMITS.storage}`} />
              <Typography variant="body2" color={typeof free === 'number' && more > free ? 'error' : 'text.secondary'} sx={{ alignSelf: 'center' }}>
                New nodes need {Math.round(more / 1024)} GB · {typeof free === 'number' ? `${Math.round(free / 1024)} GB free` : 'free memory unknown'}
              </Typography>
              <Button type="submit" variant="contained" disabled={busy || !infra.data?.allowed || !changed || storage < now.storage || masters < now.master || (typeof free === 'number' && more > free)} sx={{ textTransform: 'none', justifySelf: 'start' }}>
                Scale
              </Button>
            </Box>
            {confirm && (
              <ConfirmBar
                text={`Scale ${cluster.name} to ${masters} masters, ${workers} workers and ${storage} storage nodes?${workers < now.worker ? ' OneFlow destroys the newest workers without draining them: their pods restart on the others.' : ''}`}
                onYes={() => { setConfirm(false); scale(); }}
                onNo={() => setConfirm(false)}
              />
            )}
            <ResultNote note={note} />
          </Card>
          <ReconcileCard status={view?.reconcile} only={s => s.zone === target.zone && s.program === target.program} />
        </>
      )}
    </Box>
  );
};
