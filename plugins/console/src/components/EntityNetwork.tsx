import { Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { type ClusterNetwork, identityHost, ISOLATION_TEXT, isolationTone, type NamespaceNetwork, useClusterNetwork, whiskerHost } from '../network';
import { Badge } from './Badge';
import { Flow, type FlowLane, type FlowNode } from './Flow';
import { Table, tone } from './NetworkPage';
import { rq } from './tokens';

export const NAMESPACE_ANNOTATION = 'refresquito.io/namespace';

const Card = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
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

function podsNode(name: string, ns: NamespaceNetwork): FlowNode {
  const p = ns.pods;
  if (!p) return { title: name, sub: ns.name, tone: 'off' };
  let t: FlowNode['tone'] = 'ok';
  let state = 'Healthy';
  if (p.ready === 0) {
    t = 'bad';
    state = 'Down';
  } else if (p.ready < p.total) {
    t = 'warn';
    state = 'Degraded';
  }
  return { title: name, sub: `${p.ready} / ${p.total} pods ready`, state, tone: t };
}

/** User journey: browser → (zone, VNF: outside this cluster) → Traefik → Keycloak → the application. */
export function journeyLanes(name: string, ns: NamespaceNetwork, n: ClusterNetwork): FlowLane[] {
  const hosts = n.hosts.filter(h => h.namespace === ns.name);
  const id = identityHost(n);
  return [
    { label: 'User', nodes: [{ title: 'Browser', sub: 'access network of the zone', tone: 'off' }] },
    { label: 'Zone', nodes: [{ title: 'Host and zone router', sub: 'seen from the zone console', tone: 'off', dashed: true }] },
    { label: 'Cluster', nodes: [{ title: 'VNF · VIP', sub: 'OneKE load balancer', tone: 'off', dashed: true }] },
    {
      label: 'Ingress',
      grow: 1.3,
      nodes: hosts.length
        ? hosts.map(h => ({ title: h.host, sub: `Traefik → ${h.service ?? h.ingress}`, state: h.tls ? 'TLS' : 'No TLS', tone: h.tls ? ('ok' as const) : ('warn' as const), href: `https://${h.host}` }))
        : [{ title: 'Not published', sub: 'no Ingress in its namespace', state: 'Internal', tone: 'info' }],
    },
    { label: 'Login', nodes: [id ? { title: 'Keycloak', sub: id, state: 'SSO', tone: 'ok' } : { title: 'Keycloak', sub: 'not found in this cluster', tone: 'warn' }] },
    { label: 'Application', nodes: [podsNode(name, ns)] },
  ];
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** Who can reach it → the application → what it can reach, from its NetworkPolicies. */
export function networkLanes(name: string, ns: NamespaceNetwork, n: ClusterNetwork): FlowLane[] {
  const seg = n.segments.find(s => s.name === ns.segment);
  const inbound: FlowNode[] =
    ns.isolation === 'open'
      ? [{ title: 'Every namespace of the cluster', sub: seg && !seg.enforced ? `segment ${seg.name} lets everything through (Pass)` : 'no ingress policy', state: 'Open', tone: 'warn' }]
      : uniq(ns.policies.filter(p => p.ingress).flatMap(p => p.from)).map(f => ({ title: f, sub: 'allowed by policy', state: 'Allowed', tone: 'ok' as const }));
  if (ns.isolation === 'isolated') inbound.push({ title: 'Anything else', sub: 'not in any policy', state: 'Denied', tone: 'bad', dashed: true });
  if (ns.isolation === 'partial') inbound.push({ title: 'Its other pods', sub: 'not selected by any policy', state: 'Open', tone: 'warn' });
  const outbound: FlowNode[] = ns.egressRestricted
    ? uniq(ns.policies.filter(p => p.egress).flatMap(p => p.to)).map(t => ({ title: t, sub: 'allowed by policy', state: 'Allowed', tone: 'ok' as const }))
    : [{ title: 'Anything', sub: 'no egress policy', state: 'Open', tone: 'warn' }];
  if (ns.egressRestricted) outbound.push({ title: 'Anything else', sub: 'not in any policy', state: 'Denied', tone: 'bad', dashed: true });
  return [
    { label: 'Can reach it', nodes: inbound, grow: 1.3 },
    { label: 'Application', nodes: [{ ...podsNode(name, ns), sub: `${ns.name}${ns.segment ? ` · segment ${ns.segment}` : ''}` }], grow: 1.1 },
    { label: 'It can reach', nodes: outbound, grow: 1.3 },
  ];
}

function useEntityNamespace() {
  const { entity } = useEntity();
  return { entity, namespace: entity.metadata.annotations?.[NAMESPACE_ANNOTATION] };
}

const Frame = ({ children }: { children: (n: ClusterNetwork, ns: NamespaceNetwork, name: string) => ReactNode }) => {
  const { entity, namespace } = useEntityNamespace();
  const { loading, data, error } = useClusterNetwork();
  const name = entity.metadata.title ?? entity.metadata.name;
  if (!namespace) return <Typography color="text.secondary">This entity does not say its namespace (annotation {NAMESPACE_ANNOTATION}).</Typography>;
  if (loading && !data) return <Progress />;
  if (error) return <WarningPanel title="The network of the cluster could not be read" message={error} />;
  const ns = data?.namespaces.find(x => x.name === namespace);
  if (!data || !ns) return <Typography color="text.secondary">Namespace {namespace} is not in this cluster.</Typography>;
  return <Box sx={{ display: 'grid', gap: 2 }}>{children(data, ns, name)}</Box>;
};

/** Entity tab: the path of a user to this application, read live. */
export const EntityUserJourneyContent = () => (
  <Frame>
    {(n, ns, name) => (
      <>
        <Card title={`How a user reaches ${name}`} sub="Read live each time the tab opens: the first step that is not green is where to look. Dashed: outside this cluster.">
          <Flow label={`How a user reaches ${name}`} lanes={journeyLanes(name, ns, n)} />
        </Card>
        <Card title="Published hosts">
          <Table
            head={['Host', 'Ingress', 'Service', 'TLS']}
            rows={n.hosts
              .filter(h => h.namespace === ns.name)
              .map(h => [h.host, h.ingress, h.service ?? '—', h.tls ? <Badge label="TLS" {...tone('ok')} /> : <Badge label="No TLS" {...tone('warn')} />])}
          />
        </Card>
      </>
    )}
  </Frame>
);

/** Entity tab: who can talk to this application and what it can reach, from its NetworkPolicies and Calico segment. */
export const EntityNetworkContent = () => (
  <Frame>
    {(n, ns, name) => {
      const whisker = whiskerHost(n);
      return (
        <>
          <Card
            title={`Who talks to ${name}`}
            sub={
              <>
                {ISOLATION_TEXT[ns.isolation]} by its NetworkPolicies. Dashed: what the policies block.{' '}
                {whisker && (
                  <a href={`https://${whisker}`} target="_blank" rel="noreferrer" style={{ color: rq.primary }}>
                    Live flows in Calico Whisker
                  </a>
                )}
              </>
            }
          >
            <Flow label={`Who talks to ${name}`} lanes={networkLanes(name, ns, n)} />
          </Card>
          <Card title="Policies of its namespace">
            {ns.policies.length ? (
              <Table head={['Policy', 'Applies to pods', 'Lets in', 'Lets out']} rows={ns.policies.map(p => [p.name, p.appliesTo, p.from.join('; ') || '—', p.egress ? p.to.join('; ') || 'nothing' : '—'])} />
            ) : (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Badge label={ISOLATION_TEXT[ns.isolation]} {...tone(isolationTone(ns.isolation))} />
                <Typography variant="body2" color="text.secondary">
                  No NetworkPolicy in {ns.name}.
                </Typography>
              </Box>
            )}
          </Card>
        </>
      );
    }}
  </Frame>
);
