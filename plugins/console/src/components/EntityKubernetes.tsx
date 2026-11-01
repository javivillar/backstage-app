import { Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';
import { useClusterGet } from '../namespace';
import { Badge } from './Badge';
import { Flow, type FlowLane, TONES } from './Flow';
import { Table } from './NetworkPage';

export type K8sObjects = {
  namespace: string;
  workloads: Array<{ kind: string; name: string; desired: number; ready: number; images: string[] }>;
  services: Array<{ name: string; type: string; clusterIP?: string; ports: string[]; workloads: string[] }>;
  ingresses: Array<{ name: string; tls: boolean; routes: Array<{ host: string; path: string; service: string; port: string }> }>;
  pods: Array<{ name: string; phase: string; ready: boolean; restarts: number; node?: string; workload?: string; ip?: string }>;
  jobs: Array<{ kind: string; name: string; schedule?: string; last?: string; active: number }>;
  configMaps: string[];
  autoscalers: Array<{ name: string; target: string; min: number; max: number; current: number }>;
  networkPolicies: string[];
  errors: string[];
};

const useObjects = () => {
  const { entity } = useEntity();
  const ns = entity.metadata.annotations?.['refresquito.io/namespace'];
  return { ns, ...useClusterGet<K8sObjects>(ns ? `/namespaces/${encodeURIComponent(ns)}/objects` : undefined, 30_000) };
};

const Card = ({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.25, minWidth: 0 }}>
    <Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
        {title}
      </Typography>
      {sub && (
        <Typography variant="body2" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Box>
    {children}
  </Box>
);

const short = (image: string) => image.replace(/^[^/]+\.[^/]+\//, '').replace(/:([0-9a-f]{7})[0-9a-f]{33}$/, ':$1');

const Frame = ({ children }: { children: (o: K8sObjects) => ReactNode }) => {
  const { ns, data, loading, error } = useObjects();
  if (!ns) return <Typography color="text.secondary">The catalog does not say its namespace (refresquito.io/namespace).</Typography>;
  if (loading && !data) return <Progress />;
  if (error) return <WarningPanel title="The objects could not be read" message={error} />;
  if (!data) return null;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {data.errors.length > 0 && <WarningPanel severity="info" title="Some objects could not be read" message={data.errors.join(' · ')} />}
      {children(data)}
    </Box>
  );
};

/** The entity page › Kubernetes, in the console: every object of its namespace, read only. */
export const EntityKubernetesContent = () => (
  <Frame>
    {o => (
      <>
        <Card title="Workloads" sub={`Namespace ${o.namespace}`}>
          <Table
            head={['Kind', 'Name', 'Ready', 'Images']}
            rows={o.workloads.map(w => [
              w.kind,
              <b>{w.name}</b>,
              <Badge label={`${w.ready} / ${w.desired}`} {...TONES[w.ready >= w.desired ? 'ok' : 'bad']} />,
              <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                {w.images.map(short).join(', ')}
              </Typography>,
            ])}
          />
        </Card>
        <Card title="Pods">
          <Table
            head={['Pod', 'Workload', 'Phase', 'Restarts', 'Node', 'IP']}
            rows={o.pods.map(p => [
              p.name,
              p.workload ?? '—',
              <Badge label={p.ready ? 'Ready' : p.phase} {...TONES[p.ready ? 'ok' : 'warn']} />,
              String(p.restarts),
              p.node ?? '',
              p.ip ?? '',
            ])}
          />
        </Card>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
          <Card title="Services">
            <Table head={['Service', 'Type', 'Ports', 'Workloads']} rows={o.services.map(s => [s.name, s.type, s.ports.join(', '), s.workloads.join(', ') || '—'])} />
          </Card>
          <Card title="Ingresses">
            <Table head={['Ingress', 'Host and path', 'Service', 'TLS']} rows={o.ingresses.flatMap(i => i.routes.map(r => [i.name, `${r.host}${r.path}`, `${r.service}:${r.port}`, i.tls ? 'yes' : 'no']))} />
          </Card>
          {o.jobs.length > 0 && (
            <Card title="Jobs">
              <Table head={['Kind', 'Name', 'Schedule', 'Last', 'Running']} rows={o.jobs.map(j => [j.kind, j.name, j.schedule ?? '', j.last ? new Date(j.last).toLocaleString() : '', String(j.active)])} />
            </Card>
          )}
          {o.autoscalers.length > 0 && (
            <Card title="Autoscalers">
              <Table head={['Name', 'Target', 'Replicas']} rows={o.autoscalers.map(h => [h.name, h.target, `${h.current} (${h.min}–${h.max})`])} />
            </Card>
          )}
          <Card title="Configuration and policies">
            <Typography variant="body2">
              <b>Config maps:</b> {o.configMaps.join(', ') || '—'}
            </Typography>
            <Typography variant="body2">
              <b>Network policies:</b> {o.networkPolicies.join(', ') || 'none: open to the cluster'}
            </Typography>
          </Card>
        </Box>
      </>
    )}
  </Frame>
);

/** How traffic reaches the pods: ingress routes → services → workloads → pods. */
export function topologyLanes(o: K8sObjects): FlowLane[] {
  const routes = o.ingresses.flatMap(i => i.routes.map(r => ({ ...r, tls: i.tls })));
  const used = new Set(routes.map(r => r.service));
  const services = o.services.filter(s => used.has(s.name) || s.workloads.length);
  return [
    { label: 'Ingress', nodes: routes.length ? routes.map(r => ({ title: `${r.host}${r.path}`, sub: `→ ${r.service}:${r.port}`, state: r.tls ? 'TLS' : 'no TLS', tone: r.tls ? 'ok' : 'warn' })) : [{ title: 'Not published', tone: 'off', dashed: true }] },
    { label: 'Services', nodes: services.map(s => ({ title: s.name, sub: `${s.type} · ${s.ports.join(', ')}`, tone: s.workloads.length ? 'ok' : 'warn', state: s.workloads.length ? undefined : 'no workload' })) },
    { label: 'Workloads', nodes: o.workloads.map(w => ({ title: w.name, sub: w.kind, state: `${w.ready}/${w.desired}`, tone: w.ready >= w.desired ? 'ok' : 'bad' })) },
    { label: 'Pods', nodes: o.pods.map(p => ({ title: p.name.length > 34 ? `${p.name.slice(0, 33)}…` : p.name, sub: p.workload ?? '', state: p.ready ? 'Ready' : p.phase, tone: p.ready ? 'ok' : 'warn' })), grow: 2 },
  ];
}

/** The entity page › Topology, in the console: the path of the traffic through its objects. */
export const EntityTopologyContent = () => (
  <Frame>
    {o => (
      <Card title="Topology" sub="How a request reaches its pods: ingress → service → workload → pod. Read every 30 seconds.">
        <Flow lanes={topologyLanes(o)} label={`Topology of ${o.namespace}`} />
      </Card>
    )}
  </Frame>
);
