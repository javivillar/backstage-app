import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useConsoleConfig } from '../config';
import { useI18n } from '../i18n';
import { type InfraView, useZone } from '../zone';
import { Table } from './NetworkPage';
import { Id, Pill, Section, TitleRow, choose } from './ui';

type Row = { id: string; programme: string; nodes?: string; state?: string; consoleTo?: string; own: boolean; url?: string; kind?: string };

/** The clusters of the platform: the ones the host runs (topology) and the consoles this portal knows (console.clusters). */
function useClusterRows(): { rows: Row[]; missing: string[]; loading: boolean } {
  const cfg = useConsoleConfig();
  const zone = useZone();
  const view = zone.data as InfraView | undefined;
  const known = new Map(cfg.clusters.map(c => [c.id, c]));
  const rows: Row[] = [];
  const missing: string[] = [];
  for (const z of view?.zones ?? []) {
    for (const p of z.programs) {
      const id = `${z.name}-${p.name}`;
      if (!p.cluster) {
        missing.push(`${z.name}/${p.name}`);
        continue;
      }
      const own = id === cfg.cluster.id || (cfg.cluster.zone === z.name && cfg.cluster.program === p.name);
      const other = known.get(id);
      rows.push({
        id,
        programme: `${z.name}/${p.name}`,
        nodes: Object.entries(p.cluster.roles ?? {}).map(([r, n]) => `${n} ${r}`).join(' · '),
        state: p.cluster.state,
        own,
        consoleTo: choose<string | undefined>([[own, '/console/cluster'], [other, other && `/console/clusters/${encodeURIComponent(other.id)}`]], undefined),
        url: other?.url,
        kind: other?.kind ?? (own ? cfg.cluster.kind : undefined),
      });
      known.delete(id);
    }
  }
  if (!rows.some(r => r.own)) rows.unshift({ id: cfg.cluster.id, programme: [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join('/'), own: true, consoleTo: '/console/cluster', kind: cfg.cluster.kind });
  for (const c of known.values()) rows.push({ id: c.id, programme: '—', own: false, consoleTo: `/console/clusters/${encodeURIComponent(c.id)}`, url: c.url, kind: c.kind });
  return { rows, missing, loading: zone.loading };
}

const stateTone = (s?: string) => choose<'neu' | 'pos' | 'warn'>([[!s, 'neu'], [s && /RUNNING/.test(s), 'pos']], 'warn');

/** Platform › Kubernetes clusters: every cluster with its state and its console, and the programmes without one. */
export const ClustersPage = () => {
  const { t } = useI18n();
  const { rows, missing } = useClusterRows();
  const off = rows.filter(r => r.state && !/RUNNING/.test(r.state));
  return (
    <Box sx={{ maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[t('nav.platform'), '/console/infrastructure/platform'], [t('nav.k8sClusters')]]}
        title={t('clusters.title')}
        pills={<Pill plain>{t('clusters.count', { n: rows.length })}</Pill>}
        sub={t('clusters.sub')}
        finding={off.length ? t('clusters.finding', { names: off.map(r => r.id).join(', ') }) : undefined}
        actions={
          <Button variant="contained" component={Link as any} to="/console/infrastructure/marketplace">
            {t('infra.createCluster')}
          </Button>
        }
      />
      <Section flush>
        <Table
          head={[t('shell.cluster'), t('zone.programme'), t('cluster.nodes'), t('zone.state'), '']}
          rows={[
            ...rows.map(r => [
              <span>
                {r.consoleTo ? (
                  <Link to={r.consoleTo} style={{ fontWeight: 500 }}>
                    {r.id}
                  </Link>
                ) : (
                  <Box component="span" sx={{ fontWeight: 500 }}>
                    {r.id}
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary" component="div">
                  {r.own ? t('clusters.thisOne') : r.url ?? (r.kind === 'zone' ? t('clusters.zone') : t('clusters.programme'))}
                </Typography>
              </span>,
              r.programme,
              r.nodes ?? '—',
              r.state ? <Pill tone={stateTone(r.state)}>{r.state}</Pill> : <Pill plain>{t('clusters.notRead')}</Pill>,
              r.consoleTo ? (
                <Button size="small" variant="outlined" component={Link as any} to={r.consoleTo}>
                  {t('clusters.open')}
                </Button>
              ) : (
                ''
              ),
            ]),
            ...missing.map(m => [
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {t('clusters.none')}
              </Box>,
              m,
              '—',
              <Pill plain>{t('clusters.noneState')}</Pill>,
              <Button size="small" variant="outlined" component={Link as any} to="/console/infrastructure/marketplace">
                {t('clusters.create')}
              </Button>,
            ]),
          ]}
        />
      </Section>
    </Box>
  );
};

/** Cluster › Your clusters: the clusters this person administers (today: every cluster this console knows). */
export const YourClustersPage = () => {
  const { t } = useI18n();
  const { rows } = useClusterRows();
  return (
    <Box sx={{ maxWidth: 1240 }}>
      <TitleRow crumbs={[[t('cluster.crumb')]]} title={t('cluster.crumb')} sub={t('clusters.yourSub')} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))' }}>
        {rows.map(r => (
          <Section key={r.id} title={r.id} action={r.state ? <Pill tone={stateTone(r.state)}>{r.state}</Pill> : undefined}>
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography color="text.secondary">{r.programme}</Typography>
              {r.nodes && <Id>{r.nodes}</Id>}
              {r.consoleTo && (
                <Box>
                  <Button size="small" variant={r.own ? 'contained' : 'outlined'} component={Link as any} to={r.consoleTo}>
                    {t('clusters.open')}
                  </Button>
                </Box>
              )}
            </Box>
          </Section>
        ))}
      </Box>
    </Box>
  );
};
