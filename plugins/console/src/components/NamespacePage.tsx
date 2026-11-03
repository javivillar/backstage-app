import { Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import { useI18n } from '../i18n';
import { Id, Pill, TitleRow } from './ui';

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
  const { t } = useI18n();
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[t('cluster.crumb'), '/console/cluster'], [t('nav.applications'), '/console/applications'], [ns]]}
        title={<Id>{ns}</Id>}
        pills={
          <>
            {n?.segment && <Pill plain>{`segment ${n.segment}`}</Pill>}
            {n && <Pill tone={({ ok: 'pos', info: 'info', warn: 'warn' } as const)[isolationTone(n.isolation)]}>{ISOLATION_TEXT[n.isolation]}</Pill>}
            {apps.map(a => (
              <Pill key={a.name} tone={a.health === 'Healthy' ? 'pos' : 'neg'}>{`Argo CD ${a.health} · ${a.sync}`}</Pill>
            ))}
          </>
        }
        sub={
          <>
            {entities.length > 0 && (
              <>
                {t('ns.inCatalog')}{' '}
                {entities.map((e, i) => (
                  <span key={e.name}>
                    {i > 0 && ', '}
                    <Link to={`/console/entity/${e.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.name}`}>{e.title ?? e.name}</Link>
                  </span>
                ))}
              </>
            )}
            {cost && (
              <>
                {entities.length > 0 && ' · '}
                {t('ns.cost')} <b style={{ fontWeight: 500 }}>{costs.money(cost.total)}</b> · <Link to="/console/costs">{t('page.costs')}</Link>
              </>
            )}
          </>
        }
        actions={
          entities[0] && (
            <Button variant="contained" component={Link as any} to={`/console/entity/${entities[0].namespace ?? 'default'}/${entities[0].kind.toLowerCase()}/${entities[0].name}`}>
              {t('ns.openApp')}
            </Button>
          )
        }
      />
      <NamespaceLiveSections namespace={ns} />
      {hosts.length > 0 && (
        <Card title="Published hosts">
          <Table head={['Host', 'Service', 'TLS']} rows={hosts.map(h => [<Id>{h.host}</Id>, h.service ?? '—', <Badge label={tlsText(h)} {...(h.tls ? TONES.ok : TONES.warn)} />])} />
        </Card>
      )}
      {volumes.length > 0 && (
        <Card title="Volumes">
          <Table
            head={['Volume', 'Size', 'Used', 'Storage class']}
            rows={volumes.map(v => [
              <Id>{v.pvc}</Id>,
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
