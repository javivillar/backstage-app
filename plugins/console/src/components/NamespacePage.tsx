import { Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNamespaceCosts } from '../costs';
import { ISOLATION_TEXT, isolationTone, tlsText, useClusterNetwork } from '../network';
import { useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { bytes } from './ClusterOverviewPage';
import { NAMESPACE_ANNOTATION } from './EntityNetwork';
import { TONES } from './Flow';
import { Card, NamespaceLiveSections } from './NamespaceSections';
import { Table } from './NetworkPage';

/** The catalog entities that say they run in this namespace (annotation refresquito.io/namespace). */
function useEntitiesOf(ns: string) {
  const catalog = useApi(catalogApiRef);
  const [refs, setRefs] = useState<Array<{ name: string; title?: string; kind: string; namespace?: string }>>([]);
  useEffect(() => {
    let alive = true;
    catalog
      .getEntities({ filter: { [`metadata.annotations.${NAMESPACE_ANNOTATION}`]: ns }, fields: ['kind', 'metadata.name', 'metadata.title', 'metadata.namespace'] })
      .then(
        r => alive && setRefs(r.items.map(e => ({ name: e.metadata.name, title: e.metadata.title, kind: e.kind, namespace: e.metadata.namespace }))),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [catalog, ns]);
  return refs;
}

/** Cluster layer › a namespace: who it belongs to, how it is reached and isolated, and what runs in it now. */
export const NamespacePage = () => {
  const { ns = '' } = useParams();
  const net = useClusterNetwork();
  const ov = useClusterOverview();
  const entities = useEntitiesOf(ns);
  const costs = useNamespaceCosts('7d');
  const cost = costs.costs?.find(c => c.namespace === ns);
  const n = net.data?.namespaces.find(x => x.name === ns);
  const hosts = (net.data?.hosts ?? []).filter(h => h.namespace === ns);
  const volumes = (ov.data?.volumes ?? []).filter(v => v.namespace === ns);
  const apps = (ov.data?.apps ?? []).filter(a => a.namespace === ns);
  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 1240 }}>
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          <Link to="/console/cluster">Cluster</Link> / Namespace
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {ns}
          </Typography>
          {n?.segment && <Badge outlined label={`segment ${n.segment}`} />}
          {n && <Badge label={ISOLATION_TEXT[n.isolation]} {...TONES[isolationTone(n.isolation)]} />}
          {apps.map(a => (
            <Badge key={a.name} label={`Argo CD ${a.health} · ${a.sync}`} {...(a.health === 'Healthy' ? TONES.ok : TONES.bad)} />
          ))}
        </Box>
        {cost && (
          <Typography variant="body2" color="text.secondary">
            Cost of the last 7 days: <b>{costs.money(cost.total)}</b> (estimate with our prices) · <Link to="/console/costs">Costs</Link>
          </Typography>
        )}
        {entities.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            In the catalog:{' '}
            {entities.map((e, i) => (
              <span key={e.name}>
                {i > 0 && ', '}
                <Link to={`/console/entity/${e.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.name}`}>{e.title ?? e.name}</Link>
              </span>
            ))}
          </Typography>
        )}
      </Box>
      <NamespaceLiveSections namespace={ns} />
      {hosts.length > 0 && (
        <Card title="Published hosts">
          <Table head={['Host', 'Service', 'TLS']} rows={hosts.map(h => [h.host, h.service ?? '—', <Badge label={tlsText(h)} {...(h.tls ? TONES.ok : TONES.warn)} />])} />
        </Card>
      )}
      {volumes.length > 0 && (
        <Card title="Volumes">
          <Table
            head={['Volume', 'Size', 'Used', 'Storage class']}
            rows={volumes.map(v => [
              v.pvc,
              bytes(v.requestedBytes),
              v.usedBytes !== undefined && v.capacityBytes ? `${Math.round((v.usedBytes / v.capacityBytes) * 100)}% · ${bytes(v.usedBytes)}` : 'not mounted now',
              v.storageClass ?? '—',
            ])}
          />
        </Card>
      )}
      {n && n.policies.length > 0 && (
        <Card title="Network policies">
          <Table head={['Policy', 'Applies to pods', 'Lets in', 'Lets out']} rows={n.policies.map(p => [p.name, p.appliesTo, p.from.join('; ') || '—', p.egress ? p.to.join('; ') || 'nothing' : '—'])} />
        </Card>
      )}
    </Box>
  );
};
