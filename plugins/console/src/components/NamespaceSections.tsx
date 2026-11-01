import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { type NamespaceLive, type NamespaceWorkloads, type PodLive, useNamespaceLive, useNamespaceWorkloads } from '../namespace';
import { Badge } from './Badge';
import { bytes } from './ClusterOverviewPage';
import { TONES } from './Flow';
import { Table } from './NetworkPage';

export const Card = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <Paper variant="outlined" component="section" sx={{ borderRadius: 2, p: 2, display: 'grid', gap: 1 }}>
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
        {title}
      </Typography>
      {sub && (
        <Typography variant="body2" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Box>
    {children}
  </Paper>
);

export const cores = (c?: number) => {
  if (c === undefined) return '—';
  return c < 1 ? `${Math.round(c * 1000)}m` : `${Math.round(c * 10) / 10}`;
};

/** In use against the request (bar) and the limit (in the text); red when it nears its limit (OOMKilled next). */
const Use = ({ used, request, limit, format }: { used?: number; request?: number; limit?: number; format: (n: number) => string }) => {
  if (used === undefined) return <Typography variant="body2" color="text.secondary">—</Typography>;
  const ref = limit ?? request;
  const share = ref ? used / ref : 0;
  let t = TONES.info;
  if (limit && share >= 0.9) t = TONES.bad;
  else if (limit && share >= 0.75) t = TONES.warn;
  return (
    <Box sx={{ minWidth: 150 }}>
      {ref ? (
        <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(share, 1) * 100}%`, bgcolor: t.fg }} />
        </Box>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        {format(used)}
        {request !== undefined && ` · requests ${format(request)}`}
        {limit !== undefined && ` · limit ${format(limit)}`}
      </Typography>
    </Box>
  );
};

const state = (p: PodLive) => {
  if (p.ready) return <Badge label="Ready" {...TONES.ok} />;
  return <Badge label={p.phase === 'Running' ? 'Not ready' : p.phase ?? 'Unknown'} {...TONES.bad} />;
};

export const Kpis = ({ live }: { live: NamespaceLive }) => {
  const pods = live.pods;
  const ready = pods.filter(p => p.ready).length;
  const restarts = pods.reduce((t, p) => t + p.restarts24h, 0);
  const oom = pods.filter(p => p.lastTermination === 'OOMKilled').length;
  const failedRuns = (live.jobs ?? []).filter(j => j.phase === 'Failed').length;
  const kpi = (label: string, value: string, tone: keyof typeof TONES) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone === 'off' ? undefined : TONES[tone].fg }}>{value}</Typography>
    </Paper>
  );
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
      {kpi('Pods ready', `${ready} / ${pods.length}`, ready === pods.length ? 'ok' : 'bad')}
      {kpi('Restarts in 24 h', String(restarts), restarts ? 'warn' : 'off')}
      {kpi('Last ended out of memory', String(oom), oom ? 'bad' : 'off')}
      {kpi('Job runs failed', String(failedRuns), failedRuns ? 'warn' : 'off')}
    </Box>
  );
};

export const PodsSection = ({ live }: { live: NamespaceLive }) => (
  <Card title={`Pods of ${live.namespace}`} sub={`Read from Prometheus at ${new Date(live.generatedAt).toLocaleTimeString()}, again every 30 s. Problems first.`}>
    {live.pods.length === 0 ? (
      <Typography color="text.secondary">No pod runs in this namespace now.</Typography>
    ) : (
      <Table
        head={['Pod', 'State', 'Restarts 24 h', 'CPU', 'Memory', 'Node']}
        rows={live.pods.map(p => [
          <b>{p.name}</b>,
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {state(p)}
            {p.lastTermination && p.lastTermination !== 'Completed' && (
              <Badge label={`last end: ${p.lastTermination}`} {...(p.lastTermination === 'OOMKilled' ? TONES.bad : TONES.off)} />
            )}
          </Box>,
          p.restarts24h ? <Badge label={String(p.restarts24h)} {...TONES.warn} /> : '0',
          <Use used={p.cpu} request={p.cpuRequest} limit={p.cpuLimit} format={cores} />,
          <Use used={p.memory} request={p.memoryRequest} limit={p.memoryLimit} format={bytes} />,
          p.node ?? '—',
        ])}
      />
    )}
  </Card>
);

const runTone = (phase?: string) => {
  if (phase === 'Failed') return TONES.bad;
  return phase === 'Succeeded' ? TONES.ok : TONES.info;
};

export const JobsSection = ({ live }: { live: NamespaceLive }) =>
  live.jobs && live.jobs.length ? (
    <Card title="Job runs still kept" sub="Pods of Jobs (e.g. cron runs) that Kubernetes still keeps, newest first.">
      <Table
        head={['Run', 'Result', 'Last end']}
        rows={live.jobs.slice(0, 10).map(j => [
          j.name,
          <Badge label={j.phase ?? 'Unknown'} {...runTone(j.phase)} />,
          j.lastTermination ?? '—',
        ])}
      />
    </Card>
  ) : null;

export const WorkloadsSection = ({ w }: { w: NamespaceWorkloads }) => (
  <Card title="Workloads" sub="Deployments, StatefulSets and DaemonSets with the images they run, read from Kubernetes.">
    {w.workloads.length === 0 ? (
      <Typography color="text.secondary">None.</Typography>
    ) : (
      <Table
        head={['Workload', 'Ready', 'Images']}
        rows={w.workloads.map(x => [
          <span>
            <b>{x.name}</b>
            <br />
            <Typography component="span" variant="caption" color="text.secondary">
              {x.kind}
            </Typography>
          </span>,
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <Badge label={`${x.ready} / ${x.desired}`} {...(x.ready < x.desired ? TONES.bad : TONES.ok)} />
            {x.rollingOut && <Badge label="Rolling out" {...TONES.info} />}
          </Box>,
          <Box sx={{ display: 'grid', gap: 0.25 }}>
            {x.images.map(i => (
              <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
                {i}
              </Typography>
            ))}
          </Box>,
        ])}
      />
    )}
  </Card>
);

export const EventsSection = ({ w }: { w: NamespaceWorkloads }) => (
  <Card title="Warnings in the last hour" sub="Kubernetes events of type Warning, the newest first.">
    {w.events.length === 0 ? (
      <Typography color="text.secondary">None in the last hour.</Typography>
    ) : (
      <Table
        head={['When', 'Reason', 'Object', 'Message', 'Times']}
        rows={w.events.map(e => [new Date(e.last).toLocaleTimeString(), <Badge label={e.reason} {...TONES.warn} />, e.object, e.message, String(e.count)])}
      />
    )}
  </Card>
);

/** Everything that runs in one namespace: KPIs, pods, workloads, warnings and job runs (Live tab and namespace page). */
export const NamespaceLiveSections = ({ namespace }: { namespace: string }) => {
  const live = useNamespaceLive(namespace);
  const wl = useNamespaceWorkloads(namespace);
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {live.loading && !live.data && <Progress />}
      {live.error && !live.data && <WarningPanel title="The pods could not be read" message={live.error} />}
      {live.data && <Kpis live={live.data} />}
      {live.data && <PodsSection live={live.data} />}
      {wl.error && !wl.data && <WarningPanel severity="info" title="The workloads could not be read" message={wl.error} />}
      {wl.data && wl.data.warnings.length > 0 && <WarningPanel severity="info" title="Part of it could not be read" message={wl.data.warnings.join(' · ')} />}
      {wl.data && <EventsSection w={wl.data} />}
      {wl.data && <WorkloadsSection w={wl.data} />}
      {live.data && <JobsSection live={live.data} />}
    </Box>
  );
};
