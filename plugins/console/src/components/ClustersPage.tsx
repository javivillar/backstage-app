import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useConsoleConfig } from '../config';
import { useI18n } from '../i18n';
import { kindOf } from '../interconnection';
import { useClusterPost } from '../post';
import { type InfraView, useInfra, useZone } from '../zone';
import { TypeToConfirm } from './InterParts';
import { Table } from './NetworkPage';
import { RequestsTable, ResultNote, useChange } from './Requests';
import { Id, Pill, Section, TitleRow, choose } from './ui';

type Row = { id: string; programme: string; nodes?: string; state?: string; consoleTo?: string; own: boolean; url?: string; kind?: string; zone?: string; program?: string; name?: string; vms?: number };

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
        // only a programme gets a cluster: common, a landing zone and an integration zone never miss one
        if (kindOf(p.name, p.kind) === 'programme') missing.push(`${z.name}/${p.name}`);
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
        zone: z.name,
        program: p.name,
        name: p.cluster.name,
        vms: p.vms.filter(v => v.role !== 'zone router').length,
      });
      known.delete(id);
    }
  }
  if (!rows.some(r => r.own)) rows.unshift({ id: cfg.cluster.id, programme: [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join('/'), own: true, consoleTo: '/console/cluster', kind: cfg.cluster.kind });
  for (const c of known.values()) rows.push({ id: c.id, programme: '—', own: false, consoleTo: `/console/clusters/${encodeURIComponent(c.id)}`, url: c.url, kind: c.kind });
  return { rows, missing, loading: zone.loading };
}

const stateTone = (s?: string) => choose<'neu' | 'pos' | 'warn'>([[!s, 'neu'], [s && /RUNNING/.test(s), 'pos']], 'warn');

/**
 * Platform › Kubernetes clusters: every cluster with its state and its console (Open), its nodes (Scale) and Delete,
 * which asks the name and opens a pull request; never the cluster of this console. New ones: the Marketplace.
 */
export const ClustersPage = () => {
  const { t } = useI18n();
  const { rows, missing } = useClusterRows();
  const infra = useInfra();
  const zone = useZone();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { infra.reload(); zone.reload(); });
  const [target, setTarget] = useState<Row | undefined>();
  const off = rows.filter(r => r.state && !/RUNNING/.test(r.state));
  const allowed = !!infra.data?.allowed;
  const admins = infra.data?.admins ?? [];
  const market = '/console/infrastructure/marketplace?tab=clusters';
  const isCluster = (p: { branch: string }) => /^console\/cluster(del)?-/.test(p.branch);
  const go = (r: Row) => {
    setTarget(undefined);
    run(() => post('/infra/clusters/delete', { zone: r.zone ?? '', program: r.program ?? '' }), a => t('infra.deleteOpened', { n: a.pull?.number ?? '', target: r.programme }));
  };
  /** Why Delete is not offered for a cluster the host runs, or undefined. */
  const locked = (r: Row, deleting: boolean): string | undefined =>
    choose<string | undefined>(
      [
        [r.own || admins.includes(r.programme), t('ic.clusters.own')],
        [deleting, t('ic.clusters.deleting')],
        [infra.data && !allowed, t('ic.clusters.onlyAdmin')],
      ],
      undefined,
    );
  return (
    <Box sx={{ maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[t('nav.platform'), '/console/infrastructure/platform'], [t('nav.k8sClusters')]]}
        title={t('clusters.title')}
        pills={<Pill plain>{t('clusters.count', { n: rows.length })}</Pill>}
        sub={t('ic.clusters.sub')}
        finding={off.length ? t('clusters.finding', { names: off.map(r => r.id).join(', ') }) : undefined}
        actions={
          <Button variant="contained" component={Link as any} to={market}>
            {t('ic.createInMarket')}
          </Button>
        }
      />
      {target && (
        <TypeToConfirm
          title={t('ic.clusters.deleteTitle', { name: target.name ?? target.id })}
          text={t('ic.clusters.deleteText', { file: `clusters/${target.zone}-${target.program}.json`, n: target.vms ?? 0, id: target.programme })}
          name={target.name ?? target.id}
          busy={busy}
          onYes={() => go(target)}
          onNo={() => setTarget(undefined)}
        />
      )}
      <Box sx={{ mb: note ? 3 : 0 }}>
        <ResultNote note={note} />
      </Box>
      <Section flush>
        <Table
          head={[t('shell.cluster'), t('zone.programme'), t('cluster.nodes'), t('zone.state'), t('ic.actions')]}
          rows={[
            ...rows.map(r => {
              const deleting = !!infra.data?.clusters.some(c => c.zone === r.zone && c.program === r.program && c.delete);
              const why = r.zone ? locked(r, deleting) : undefined;
              return [
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
                r.state ? <Pill tone={deleting ? 'info' : stateTone(r.state)}>{deleting ? t('ic.clusters.deleting') : r.state}</Pill> : <Pill plain>{t('clusters.notRead')}</Pill>,
                <Box sx={{ display: 'grid', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                    {r.consoleTo && (
                      <Button size="small" variant="outlined" component={Link as any} to={r.consoleTo}>
                        {t('clusters.open')}
                      </Button>
                    )}
                    {r.zone && (
                      <Button size="small" variant="outlined" component={Link as any} to={`/console/infrastructure/clusters/${r.zone}/${r.program}`} disabled={deleting}>
                        {t('nav.scale')}
                      </Button>
                    )}
                    {r.zone && (
                      <Button size="small" variant="outlined" color="error" disabled={!!why || busy} onClick={() => setTarget(r)} aria-label={t('ic.clusters.deleteId', { name: r.name ?? r.id })}>
                        {t('vmr.delete')}
                      </Button>
                    )}
                  </Box>
                  {why && (
                    <Typography variant="caption" color="text.secondary">
                      {why}
                    </Typography>
                  )}
                </Box>,
              ];
            }),
            ...missing.map(m => [
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {t('clusters.none')}
              </Box>,
              m,
              '—',
              <Pill plain>{t('clusters.noneState')}</Pill>,
              <Button size="small" variant="outlined" component={Link as any} to={market}>
                {t('ic.createInMarket')}
              </Button>,
            ]),
          ]}
        />
      </Section>
      <Section title={t('infra.requests')} meta={t('infra.last7')}>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0 }}>
          {t('infra.requestsClusterSub')}
        </Typography>
        <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={(zone.data as InfraView | undefined)?.reconcile} only={isCluster} />
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
