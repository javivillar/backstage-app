import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useConsoleConfig } from '../config';
import { type ClusterNetwork, identityHost, ISOLATION_TEXT, isolationTone, useClusterNetwork, whiskerHost } from '../network';
import { Badge } from './Badge';
import { Flow, type FlowLane, TONES } from './Flow';
import { rq } from './tokens';

const Section = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <Paper variant="outlined" component="section" sx={{ borderRadius: 2, p: 2, display: 'grid', gap: 1.5 }}>
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

const cell = { px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'left' as const, verticalAlign: 'top' as const, fontSize: 14 };
export const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <Box sx={{ overflowX: 'auto' }}>
    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
      <thead>
        <tr>
          {head.map(h => (
            <Box component="th" key={h} sx={{ ...cell, fontWeight: 600, fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {h}
            </Box>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <Box component="td" key={j} sx={cell}>
                {c}
              </Box>
            ))}
          </tr>
        ))}
      </tbody>
    </Box>
  </Box>
);

export const tone = (t: keyof typeof TONES) => TONES[t];

/** The map of the cluster: entry → published hosts → segments → isolation of the namespaces. */
export function mapLanes(n: ClusterNetwork): FlowLane[] {
  const apps = n.namespaces.filter(x => !x.system);
  const count = (i: string) => apps.filter(x => x.isolation === i).length;
  const tls = n.hosts.filter(h => h.tls).length;
  const id = identityHost(n);
  return [
    {
      label: 'Entry',
      nodes: [
        { title: 'VNF · VIP', sub: 'OneKE load balancer: seen from the zone console', tone: 'off', dashed: true },
        n.entry
          ? { title: 'Traefik', sub: `${n.entry.service} · ports ${n.entry.ports.join(', ')}`, state: 'Running', tone: 'ok' }
          : { title: 'Traefik', sub: 'service not found', state: 'Unknown', tone: 'warn' },
      ],
    },
    {
      label: 'Published hosts',
      nodes: [
        { title: `${n.hosts.length} hosts`, sub: `${tls} with TLS`, state: tls === n.hosts.length ? 'OK' : 'Some without TLS', tone: tls === n.hosts.length ? 'ok' : 'warn' },
        ...(id ? [{ title: 'Keycloak', sub: id, state: 'Login', tone: 'info' as const }] : []),
      ],
    },
    {
      label: 'Segments (Calico)',
      grow: 1.4,
      nodes: n.segments.map(s => ({
        title: s.name,
        sub: `${s.namespaces} namespace${s.namespaces === 1 ? '' : 's'} · ${s.policy ?? 'no policy'}`,
        state: s.enforced ? 'Enforced' : 'Pass-through',
        tone: s.enforced ? ('ok' as const) : ('warn' as const),
      })),
    },
    {
      label: 'Namespaces (NetworkPolicy)',
      nodes: [
        { title: `${count('isolated')} isolated`, sub: 'every pod behind a policy', tone: 'ok' },
        { title: `${count('partial')} partly isolated`, sub: 'some pods behind a policy', tone: 'info' },
        { title: `${count('open')} open to the cluster`, sub: 'no ingress policy', state: count('open') ? 'Review' : 'OK', tone: count('open') ? 'warn' : 'ok' },
      ],
    },
  ];
}

/** Cluster layer › Network: how this cluster is reached and isolated, read live from Kubernetes and Calico. */
export const NetworkPage = () => {
  const cfg = useConsoleConfig();
  const { loading, data, error, reload } = useClusterNetwork();
  const [tab, setTab] = useState<'map' | 'hosts' | 'isolation'>('map');
  const [system, setSystem] = useState(false);
  const whisker = data && whiskerHost(data);
  const tabs: Array<[typeof tab, string]> = [
    ['map', 'Map'],
    ['hosts', 'Published hosts'],
    ['isolation', 'Isolation'],
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            Network of {cfg.cluster.id}
          </Typography>
          <Typography color="text.secondary">
            {data ? `read from Kubernetes and Calico at ${new Date(data.generatedAt).toLocaleTimeString()}` : 'read from Kubernetes and Calico'}
          </Typography>
        </Box>
        {whisker && (
          <a href={`https://${whisker}`} target="_blank" rel="noreferrer" style={{ color: rq.primary, fontWeight: 500 }}>
            Live flows in Calico Whisker
          </a>
        )}
        <Button variant="text" onClick={reload} disabled={loading} sx={{ textTransform: 'none' }}>
          Refresh
        </Button>
      </Box>
      <Box component="nav" aria-label="Network views" sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            variant="text"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            sx={{ textTransform: 'none', borderRadius: 0, borderBottom: 2, borderColor: tab === id ? rq.primary : 'transparent', color: tab === id ? rq.primary : 'text.primary', fontWeight: tab === id ? 600 : 400 }}
          >
            {label}
          </Button>
        ))}
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title="The network of the cluster could not be read" message={error} />}
      {data && data.warnings.length > 0 && <WarningPanel severity="info" title="Part of the network could not be read" message={data.warnings.join(' · ')} />}
      {data && tab === 'map' && (
        <Section title="Cluster map" sub="Each request enters through the VNF, Traefik picks the namespace by host name, and the policies decide who else can talk to it.">
          <Flow label="Cluster map" lanes={mapLanes(data)} />
        </Section>
      )}
      {data && tab === 'hosts' && (
        <Section title="Published hosts" sub="Every Ingress of the cluster. They share the address of the cluster; Traefik routes by name.">
          <Table
            head={['Host', 'Namespace', 'Service', 'TLS']}
            rows={data.hosts.map(h => [
              <a href={`https://${h.host}`} target="_blank" rel="noreferrer" style={{ color: rq.primary }}>
                {h.host}
              </a>,
              h.namespace,
              h.service ?? '—',
              h.tls ? <Badge label="TLS" {...tone('ok')} /> : <Badge label="No TLS" {...tone('warn')} />,
            ])}
          />
        </Section>
      )}
      {data && tab === 'isolation' && (
        <Section
          title="Isolation by namespace"
          sub={
            <FormControlLabel control={<Switch size="small" checked={system} onChange={e => setSystem(e.target.checked)} />} label="Show the namespaces of the cluster itself" />
          }
        >
          <Table
            head={['Namespace', 'Segment', 'Isolation', 'Policies', 'Pods ready']}
            rows={data.namespaces
              .filter(x => system || !x.system)
              .map(x => [
                x.name,
                x.segment ?? '—',
                <Badge label={ISOLATION_TEXT[x.isolation]} {...tone(isolationTone(x.isolation))} />,
                x.policies.length ? x.policies.map(p => p.name).join(', ') : '—',
                x.pods ? `${x.pods.ready} / ${x.pods.total}` : '—',
              ])}
          />
        </Section>
      )}
    </Box>
  );
};
