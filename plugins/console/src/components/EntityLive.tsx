import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from './Badge';
import { bytes } from './ClusterOverviewPage';
import { NAMESPACE_ANNOTATION } from './EntityNetwork';
import { TONES } from './Flow';
import { Table } from './NetworkPage';

/** The answer of GET /api/cluster/namespaces/:ns/live (backend plugin cluster, clusterNamespace.ts). */
export type PodLive = {
  name: string;
  node?: string;
  phase?: string;
  ready: boolean;
  restarts24h: number;
  lastTermination?: string;
  cpu?: number;
  cpuRequest?: number;
  cpuLimit?: number;
  memory?: number;
  memoryRequest?: number;
  memoryLimit?: number;
};
export type NamespaceLive = { generatedAt: string; namespace: string; pods: PodLive[] };

function useNamespaceLive(ns?: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: NamespaceLive; error?: string }>({ loading: true });
  const load = useCallback(async () => {
    if (!ns) return;
    try {
      const res = await fetch(`${await discovery.getBaseUrl('cluster')}/namespaces/${encodeURIComponent(ns)}/live`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setState({ loading: false, data: body as NamespaceLive });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  }, [discovery, fetch, ns]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  return state;
}

const cores = (c?: number) => (c === undefined ? '—' : `${c < 1 ? Math.round(c * 1000) : Math.round(c * 10) / 10}${c < 1 ? 'm' : ''}`);

/** In use against the request (bar) and the limit (in the text); red when memory nears its limit (OOMKilled next). */
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

/** Entity tab (console only): the pods of its namespace now, read from Prometheus every 30 s. */
export const EntityLiveContent = () => {
  const { entity } = useEntity();
  const ns = entity.metadata.annotations?.[NAMESPACE_ANNOTATION];
  const { loading, data, error } = useNamespaceLive(ns);
  if (!ns) return <Typography color="text.secondary">This entity does not say its namespace (annotation {NAMESPACE_ANNOTATION}).</Typography>;
  if (loading && !data) return <Progress />;
  if (error) return <WarningPanel title="The pods could not be read" message={error} />;
  if (!data) return null;
  const pods = data.pods;
  const ready = pods.filter(p => p.ready).length;
  const restarts = pods.reduce((t, p) => t + p.restarts24h, 0);
  const oom = pods.filter(p => p.lastTermination === 'OOMKilled').length;
  const kpi = (label: string, value: string, tone: keyof typeof TONES) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone === 'off' ? undefined : TONES[tone].fg }}>{value}</Typography>
    </Paper>
  );
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {kpi('Pods ready', `${ready} / ${pods.length}`, ready === pods.length ? 'ok' : 'bad')}
        {kpi('Restarts in 24 h', String(restarts), restarts ? 'warn' : 'off')}
        {kpi('Last ended out of memory', String(oom), oom ? 'bad' : 'off')}
      </Box>
      <Paper variant="outlined" component="section" sx={{ borderRadius: 2, p: 2, display: 'grid', gap: 1 }}>
        <Typography variant="h6" component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
          Pods of {data.namespace}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Read from Prometheus at {new Date(data.generatedAt).toLocaleTimeString()}, again every 30 s. Problems first.
        </Typography>
        <Table
          head={['Pod', 'State', 'Restarts 24 h', 'CPU', 'Memory', 'Node']}
          rows={pods.map(p => [
            <b>{p.name}</b>,
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {p.ready ? <Badge label="Ready" {...TONES.ok} /> : <Badge label={p.phase === 'Running' ? 'Not ready' : p.phase ?? 'Unknown'} {...TONES.bad} />}
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
      </Paper>
    </Box>
  );
};
