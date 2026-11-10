import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Fragment, useState } from 'react';
import { useI18n } from '../i18n';
import { type ComponentRow, componentTitle, interconnectionKind, type InterZone, type PathNode, pathLanes, type SiteRole } from '../interconnection';
import { useClusterPost } from '../post';
import { useRq } from '../theme/consoleTheme';
import { pullKind, vmHref } from '../zone';
import { InfraFrame } from './InfraPages';
import { KindPill, sizeText, SitePill, STATE_TONE, StatePill } from './InterParts';
import { Table } from './NetworkPage';
import { ConfirmBar, RequestsTable, ResultNote, useChange } from './Requests';
import { EmptyState, Id, Kpis, Pill, Row, Section, choose } from './ui';
import { useInterconnection } from './useInterconnection';

const MARKET = '/console/infrastructure/marketplace';

/** One piece of the path: solid when this site has it, dashed when it is missing, planned or on the other site. */
const PathBox = ({ n }: { n: PathNode }) => {
  const rq = useRq();
  const { t, has } = useI18n();
  const word = (k: string) => (has(k) ? t(k) : k);
  const solid = n.state === 'running' || n.state === 'ok';
  const tone = n.state === 'remote' || n.state === 'planned' || n.state === 'ok' ? undefined : STATE_TONE[n.state];
  const dot = { pos: rq.positive, neg: rq.negative, warn: rq.warning, info: rq.data, neu: rq.control }[solid ? 'pos' : tone ?? 'neu'];
  return (
    <Box
      data-state={n.state}
      sx={{ flex: '1 1 0', minWidth: 132, border: `1px ${solid ? 'solid' : 'dashed'} ${n.state === 'failed' ? rq.negative : rq.control}`, borderRadius: '8px', bgcolor: n.own ? rq.sheet : 'transparent', p: 1.25, display: 'grid', gap: 0.25, alignContent: 'start', opacity: n.own ? 1 : 0.85 }}
    >
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
        <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flex: 'none' }} />
        <Box component="span" sx={{ fontWeight: 600, fontSize: 13 }}>
          {word(n.title)}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {word(n.sub)}
      </Typography>
      <Typography variant="caption" sx={{ color: solid ? rq.positive : 'text.secondary', fontWeight: 500 }}>
        {n.state === 'ok' ? t('ic.state.running') : t(`ic.state.${n.state}`)}
      </Typography>
    </Box>
  );
};

const Arrow = () => {
  const rq = useRq();
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={rq.control} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', alignSelf: 'center' }}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
};

/** The path between the edge and the core through one interconnection zone: the U2M and the M2M lanes and the scan. */
export const PathDiagram = ({ zone, role }: { zone: InterZone; role: SiteRole }) => {
  const rq = useRq();
  const { t } = useI18n();
  const lanes = pathLanes(zone, role);
  const label = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, flex: 'none', alignSelf: 'center', height: 24, borderRadius: 999, fontSize: 12, fontWeight: 600, bgcolor: rq.info.bg, color: rq.info.fg };
  return (
    <Box role="group" aria-label={t('ic.path.label', { zone: zone.seg.id })} sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gap: 1.5, minWidth: 980 }}>
        {lanes.map(l => (
          <Box key={l.id} data-lane={l.id} sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
            <Box component="span" sx={label}>
              {l.id.toUpperCase()}
            </Box>
            {l.nodes.map((n, i) => (
              <Fragment key={i}>
                {i > 0 && <Arrow />}
                <PathBox n={n} />
              </Fragment>
            ))}
          </Box>
        ))}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
          <Box component="span" sx={{ ...label, bgcolor: rq.neu.bg, color: rq.neu.fg }}>
            {t('ic.path.scan')}
          </Box>
          <Box data-state={zone.clamav ? 'running' : 'missing'} sx={{ flex: '1 1 0', border: `1px ${zone.clamav ? 'solid' : 'dashed'} ${rq.control}`, borderRadius: '8px', p: 1.25, display: 'grid', gap: 0.25 }}>
            <Box component="span" sx={{ fontWeight: 600, fontSize: 13 }}>
              ClamAV · {zone.seg.zone}/common
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t(choose([[!zone.common, 'ic.path.noCommon'], [zone.clamav, 'ic.path.clamav']], 'ic.path.clamavNoVm'), { zone: zone.seg.zone })}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

/** A landing or integration zone: its networks, the programmes it serves and each piece with its state. */
const ZoneCard = ({ z }: { z: InterZone }) => {
  const { t } = useI18n();
  const rq = useRq();
  const nets = (z.seg.live?.networks ?? []).map(n => `${n.role ?? n.name} ${n.cidr}`).join(' · ');
  return (
    <Section title={z.seg.id} action={<Box sx={{ display: 'flex', gap: 0.5 }}><KindPill kind={z.seg.kind} /><Pill tone={z.complete ? 'pos' : 'warn'}>{t(z.complete ? 'ic.complete' : 'ic.incomplete')}</Pill></Box>}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {[nets, z.programmes.length ? t('ic.serves', { names: z.programmes.map(p => p.id).join(', ') }) : t('ic.servesNone')].filter(Boolean).join(' · ')}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {z.slots.map((s, i) => (
          <Box component="li" key={s.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.75, borderTop: i ? `1px solid ${rq.rule}` : 0 }}>
            <span>{componentTitle(s.component, s.traffic)}</span>
            <StatePill state={s.state} />
          </Box>
        ))}
      </Box>
    </Section>
  );
};

/**
 * Platform › Interconnection: the one path between the edge sites and the core, read-only. The zones of this site, their
 * components with Delete (a pull request) and the requests; components are created from the Marketplace.
 */
export const InterconnectionPage = () => {
  const { t } = useI18n();
  const ic = useInterconnection();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { ic.vms.reload(); ic.zone.reload(); });
  const [pending, setPending] = useState<ComponentRow | undefined>();
  const { role, zones, rows, attention } = ic;
  const kind = interconnectionKind(role);
  const running = rows.filter(r => r.state === 'running').length;
  const allowed = !!ic.vms.data?.allowed;
  const first = attention[0];
  return (
    <InfraFrame
      title={t('nav.interconnection')}
      crumb={t('nav.interconnection')}
      sub={t(`ic.page.sub.${role}`)}
      finding={() => (first ? { text: t(first.key, first.vars), tone: first.tone } : undefined)}
      actions={
        <Button variant="outlined" component={Link as any} to={`${MARKET}?tab=components`}>
          {t('ic.page.add')}
        </Button>
      }
    >
      {() => (
        <>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <SitePill role={role} />
            <Typography color="text.secondary">{t(`ic.site.${role}.what`)}</Typography>
          </Box>
          <Kpis
            items={[
              { label: t(`ic.page.zones.${kind}`), value: zones.length, note: zones.map(z => z.seg.id).join(', ') || t('ic.page.noZones') },
              { label: t(`ic.page.remote.${role}`), value: '—', note: t(`ic.page.noRemote.${role}`) },
              { label: t('ic.components'), value: `${running} / ${rows.length}`, note: t('infra.running') },
              { label: t('infra.attention'), value: attention.length, tone: attention.some(a => a.tone === 'neg') ? 'bad' : undefined },
            ]}
          />
          {ic.vms.error && <Typography color="error">{ic.vms.error}</Typography>}
          <Section title={t('ic.path.title')} meta={t('ic.path.legend')}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('ic.path.sub')}
            </Typography>
            {zones.length === 0 ? (
              <EmptyState
                title={t(`ic.page.empty.${kind}`)}
                action={
                  <Button variant="outlined" component={Link as any} to={`${MARKET}?tab=segregations`}>
                    {t('ic.createInMarket')}
                  </Button>
                }
              >
                {t('ic.page.emptyWhy')}
              </EmptyState>
            ) : (
              <Box sx={{ display: 'grid', gap: 2.5 }}>
                {zones.map(z => (
                  <Box key={z.seg.id} sx={{ display: 'grid', gap: 1 }}>
                    {zones.length > 1 && <Typography sx={{ fontWeight: 600 }}>{z.seg.id}</Typography>}
                    <PathDiagram zone={z} role={role} />
                  </Box>
                ))}
              </Box>
            )}
          </Section>
          <Typography variant="h5" component="h2" sx={{ mb: 0.5 }}>
            {t('ic.zonesTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('ic.zonesSub')}
          </Typography>
          <Row spans={[6, 6]}>
            <Box sx={{ display: 'grid', gap: 3, '& > section': { mb: 0 } }}>
              {zones.map(z => (
                <ZoneCard key={z.seg.id} z={z} />
              ))}
              {zones.length === 0 && (
                <Section title={t(`ic.page.zones.${kind}`)}>
                  <EmptyState title={t(`ic.page.empty.${kind}`)} />
                </Section>
              )}
            </Box>
            <Section title={t(`ic.page.remote.${role}`)} action={<Pill plain>{t('ic.remote')}</Pill>}>
              <EmptyState title={t(`ic.page.noRemote.${role}`)}>{t(`ic.page.remoteWhy.${role}`)}</EmptyState>
            </Section>
          </Row>
          {pending && (
            <ConfirmBar
              text={t('ic.comp.confirmDelete', { name: pending.vm })}
              onYes={() => {
                const p = pending;
                setPending(undefined);
                run(() => post('/zone/vms/delete', { zone: p.zone, program: p.program, name: p.name ?? '' }), a => t('ic.comp.deleteOpened', { n: a.pull?.number ?? '', name: p.vm }));
              }}
              onNo={() => setPending(undefined)}
            />
          )}
          <Box sx={{ mb: note || pending ? 3 : 0 }}>
            <ResultNote note={note} />
          </Box>
          <Section title={t('ic.components')} meta={rows.length} flush>
            {rows.length === 0 ? (
              <EmptyState title={t('ic.comp.none')}>{t('ic.comp.noneWhy')}</EmptyState>
            ) : (
              <Table
                head={['VM', t('shell.zone'), t('ic.component'), t('img.image'), t('vmr.size'), t('zone.state'), t('ic.address'), t('ic.actions')]}
                rows={rows.map(r => [
                  <Link to={vmHref(r.vm)}>
                    <Id>{r.vm}</Id>
                  </Link>,
                  `${r.zone}/${r.program}`,
                  componentTitle(r.component, r.traffic),
                  r.image ? <Id>{r.image}</Id> : '—',
                  sizeText(r),
                  <span>
                    <StatePill state={r.state} />
                    {(r.detail || r.state === 'waiting') && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ maxWidth: 260, overflowWrap: 'anywhere' }}>
                        {r.state === 'waiting' ? t('ic.state.waitingWhy') : r.detail}
                      </Typography>
                    )}
                  </span>,
                  r.address ? <Id>{r.address}</Id> : '—',
                  r.name ? (
                    <Button size="small" variant="outlined" color="error" disabled={!allowed || busy} onClick={() => setPending(r)} aria-label={t('ic.comp.deleteId', { name: r.vm })}>
                      {t('vmr.delete')}
                    </Button>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {t('ic.comp.notInGit')}
                    </Typography>
                  ),
                ])}
              />
            )}
          </Section>
          <Section title={t('infra.requests')} meta={t('infra.last7')}>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0 }}>
              {t('ic.page.requestsSub')}
            </Typography>
            <RequestsTable open={ic.vms.data?.pulls ?? []} merged={ic.vms.data?.merged ?? []} only={p => / component$/.test(pullKind(p))} />
          </Section>
        </>
      )}
    </InfraFrame>
  );
};
