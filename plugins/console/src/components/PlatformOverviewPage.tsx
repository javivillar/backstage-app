import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useI18n } from '../i18n';
import { componentTitle, interconnectionKind, kindCounts, type Slot } from '../interconnection';
import { useInfra, vmHref } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { InfraFrame, kindsNote, roomFinding } from './InfraPages';
import { KindPill, SitePill } from './InterParts';
import { Table } from './NetworkPage';
import { PlatformArchitecture } from './PlatformArchitecture';
import { RequestsTable } from './Requests';
import { Attention, EmptyState, Facts, Kpis, Pill, Row, Section } from './ui';
import { useInterconnection } from './useInterconnection';
import { PageTabs, useTab } from './ZoneInventoryPages';
import { vmRuns } from './ZonePages';

const gb = (mb?: number) => (typeof mb === 'number' ? `${Math.round(mb / 1024)} GB` : '—');
const TABS = ['summary', 'architecture'] as const;
const MARKET = '/console/infrastructure/marketplace';
const INTER = '/console/infrastructure/interconnection';

/**
 * Platform › Overview. Summary: zones, segregations by kind, clusters, the interconnection, room in the hosts and what
 * needs attention. Architecture: the same data drawn (PlatformArchitecture).
 */
export const PlatformOverviewPage = () => {
  const infra = useInfra();
  const ic = useInterconnection();
  const { t } = useI18n();
  const [tab, setTab] = useTab(TABS);
  const { role, segs, zones, rows } = ic;
  const kind = interconnectionKind(role);
  // "U2M running · M2M not created"
  const slotsText = (slots: Slot[]) => slots.map(s => `${s.traffic ? s.traffic.toUpperCase() : componentTitle(s.component)} ${t(`ic.state.${s.state}`).toLowerCase()}`).join(' · ') || '—';
  return (
    <InfraFrame
      title={t('infra.platformTitle')}
      sub={t(`ic.overview.sub.${role}`)}
      finding={v => roomFinding(v, t)}
      actions={
        <Button variant="contained" component={Link as any} to={MARKET}>
          {t('ic.overview.market')}
        </Button>
      }
    >
      {view => {
        const catalog = view.catalog ?? [];
        const programmes = view.zones.flatMap(z => z.programs.map(p => ({ zone: z.name, p })));
        const clusters = programmes.filter(x => x.p.cluster);
        const running = clusters.filter(x => /RUNNING/.test(x.p.cluster!.state)).length;
        const vms = programmes.flatMap(x => x.p.vms);
        const components = new Set(rows.map(r => r.vm));
        const waiting = vms.filter(v => v.state === 'PENDING' && !components.has(v.name));
        const drift = view.drift ?? [];
        const counts = kindCounts(segs);
        const upComponents = rows.filter(r => r.state === 'running').length;
        const attention = [
          ...ic.attention.map(a => ({ tone: a.tone, label: t('nav.interconnection'), what: t(a.key, a.vars), action: a.to === 'marketplace' ? { label: t('ic.createInMarket'), to: `${MARKET}?tab=components` } : { label: t('nav.interconnection'), to: INTER } })),
          ...clusters.filter(x => !/RUNNING/.test(x.p.cluster!.state)).map(x => ({ tone: 'neg' as const, label: t('shell.cluster'), what: t('infra.att.cluster', { name: x.p.cluster!.name, state: x.p.cluster!.state }), action: { label: t('nav.k8sClusters'), to: '/console/clusters' } })),
          ...waiting.map(v => ({ tone: 'warn' as const, label: 'VM', what: t('infra.att.vm', { name: v.name }), action: { label: t('clusters.open'), to: vmHref(v.name) } })),
          ...(drift.length ? [{ tone: 'warn' as const, label: t('infra.att.design'), what: t('zone.finding.drift', { n: drift.length }), action: { label: t('nav.infrastructure'), to: '/console/infrastructure' } }] : []),
          ...segs.filter(s => s.kind === 'programme' && s.live && !s.cluster).map(s => ({ tone: 'neu' as const, label: t('zone.programme'), what: t('infra.att.noCluster', { name: s.id }), action: { label: t('ic.createInMarket'), to: `${MARKET}?tab=clusters` } })),
        ];
        return (
          <>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                <PageTabs label={t('nav.overview')} tab={tab} onChange={setTab} tabs={TABS.map(k => [k, t(`ic.tab.${k}`)])} />
              </Box>
              <SitePill role={role} />
            </Box>
            {tab === 'architecture' ? (
              <Section title={t('ic.arch.title')} meta={t(`ic.arch.meta.${role}`, { zones: catalog.filter(c => c.enabled).length, segs: segs.length, clusters: clusters.length })}>
                <PlatformArchitecture view={view} segs={segs} inter={zones} role={role} />
              </Section>
            ) : (
              <>
                <Kpis
                  items={[
                    { label: t('infra.zonesEnabled'), value: `${catalog.filter(c => c.enabled).length} / ${catalog.length}` },
                    { label: t('ic.segregations'), value: segs.length, note: kindsNote(counts, t) },
                    { label: t('nav.k8sClusters'), value: `${running} / ${clusters.length}`, note: t('infra.running'), tone: running < clusters.length ? 'bad' : undefined },
                    { label: t('nav.interconnection'), value: `${upComponents} / ${rows.length}`, note: t(`ic.overview.tile.${kind}`, { n: zones.length }), tone: ic.attention.some(a => a.tone === 'neg') ? 'bad' : undefined },
                    { label: t('infra.memNewVm'), value: gb(view.capacity?.freeMemoryMb), note: t('infra.memNote', { r: gb(view.capacity?.reservedMemoryMb) }), tone: (view.capacity?.freeMemoryMb ?? 1) < 4096 ? 'bad' : undefined },
                    { label: 'VMs', value: `${vms.filter(v => vmRuns(v.state)).length} / ${vms.length}`, note: t('infra.running') },
                  ]}
                />
                {attention.length > 0 && (
                  <Section title={t('infra.attention')} meta={attention.length}>
                    <Attention items={attention} />
                  </Section>
                )}
                <Row spans={[8, 4]}>
                  <Section title={t('infra.clustersTitle')} flush>
                    <Table
                      head={[t('shell.cluster'), t('zone.programme'), t('cluster.nodes'), t('zone.state')]}
                      rows={clusters.map(x => [
                        <Link to={`/console/infrastructure/platform/${x.zone}/${x.p.name}`}>{x.p.cluster!.name}</Link>,
                        `${x.zone}/${x.p.name}`,
                        Object.entries(x.p.cluster!.roles ?? {}).map(([r, n]) => `${n} ${r}`).join(' · '),
                        <Badge label={x.p.cluster!.state} {...TONES[/RUNNING/.test(x.p.cluster!.state) ? 'ok' : 'warn']} />,
                      ])}
                    />
                  </Section>
                  <Section title={view.host?.name ?? t('infra.hosts')}>
                    <Facts
                      labelWidth={110}
                      items={[
                        ['CPU', view.host?.cpus !== undefined ? `${view.host.cpus}` : '—'],
                        [t('cluster.memory'), view.host?.memoryGiB !== undefined ? `${view.host.memoryGiB} GiB` : '—'],
                        [t('infra.reserve'), gb(view.capacity?.reservedMemoryMb)],
                        [t('infra.freeVms'), gb(view.capacity?.freeMemoryMb)],
                      ]}
                    />
                  </Section>
                </Row>
                <Section title={t('nav.interconnection')} action={<Link to={INTER}>{t('ic.overview.open')}</Link>} flush>
                  {zones.length === 0 ? (
                    <EmptyState title={t(`ic.page.empty.${kind}`)}>{t('ic.page.emptyWhy')}</EmptyState>
                  ) : (
                    <Table
                      head={[t('shell.zone'), t('ic.kindHead'), t('ic.gateways'), t('ic.endpoints'), t('zone.state')]}
                      rows={zones.map(z => [
                        <Link to={`/console/infrastructure/platform/${z.seg.zone}/${z.seg.name}`}>{z.seg.id}</Link>,
                        <KindPill kind={z.seg.kind} />,
                        slotsText(z.slots.filter(s => s.component === 'apisix')),
                        slotsText(z.slots.filter(s => s.component !== 'apisix')),
                        <Pill tone={z.complete ? 'pos' : 'warn'}>{t(z.complete ? 'ic.complete' : 'ic.incomplete')}</Pill>,
                      ])}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 2.25, py: 1.25 }}>
                    {t(`ic.page.noRemote.${role}`)} {t(`ic.page.remoteWhy.${role}`)}
                  </Typography>
                </Section>
                <Section title={t('infra.requests')} meta={t('infra.last7')}>
                  <RequestsTable open={[...(infra.data?.pulls ?? []), ...(ic.vms.data?.pulls ?? [])]} merged={[...(infra.data?.merged ?? []), ...(ic.vms.data?.merged ?? [])]} reconcile={view.reconcile} />
                </Section>
              </>
            )}
          </>
        );
      }}
    </InfraFrame>
  );
};
