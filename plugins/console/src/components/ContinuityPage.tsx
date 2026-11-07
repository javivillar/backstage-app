import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type ReactNode, useEffect, useState } from 'react';
import { Link as RouterLink, Route, Routes, useParams } from 'react-router-dom';
import {
  type ContinuityProfile,
  type ContinuitySummary,
  type State,
  type TrustAnchor,
  atRisk,
  expiryDay,
  exportLine,
  label,
  PROFILES_REPO,
  profileFileUrl,
  reasonDetail,
  reasonText,
} from '../continuity';
import { I18nProvider, useI18n } from '../i18n';
import { ConsoleTheme } from '../theme/consoleTheme';
import { ClassicLink } from './ClassicLink';
import { Table } from './NetworkPage';
import { Attention, EmptyState, Facts, Id, Kpis, Pill, Row, Section, TitleRow, type Tone, choose } from './ui';

const stateTone: Record<State, Tone> = { ok: 'pos', warning: 'warn', critical: 'neg' };
const lifecycleTone: Record<string, Tone> = { supported: 'neu', deprecated: 'warn', retired: 'neg', external: 'info' };
const offlineTone: Record<string, Tone> = { yes: 'pos', no: 'neg', unknown: 'warn', 'n/a': 'neu' };

/** GET /api/continuity/summary, once per page. */
function useSummary() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ContinuitySummary; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl('continuity')}/summary`);
      if (!r.ok) {
        const body = await r.json().catch(() => undefined);
        throw new Error((body as { error?: string })?.error ?? `${r.status} ${r.statusText}`);
      }
      return (await r.json()) as ContinuitySummary;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  return state;
}

/** Where the page is mounted: the console (/console/continuity) or the classic portal (/continuity). */
type Mount = { base: string; entityBase: string; classic?: boolean };
const CONSOLE: Mount = { base: '/console/continuity', entityBase: '/console/entity/default/component' };
const CLASSIC: Mount = { base: '/continuity', entityBase: '/catalog/default/component', classic: true };

const StatePill = ({ state }: { state: State }) => {
  const { t } = useI18n();
  return <Pill tone={stateTone[state]}>{t(`cont.level.${state}`)}</Pill>;
};

const AnchorsTable = ({ anchors, mount, showService = true }: { anchors: TrustAnchor[]; mount: Mount; showService?: boolean }) => {
  const { t, has } = useI18n();
  if (!anchors.length) return <EmptyState title={t('cont.noAnchors')} />;
  const head = [t('cont.col.key'), ...(showService ? [t('cont.col.service')] : []), t('cont.col.expiry'), t('cont.col.daysLeft'), t('cont.col.offline'), t('cont.col.custodians'), t('cont.col.notes')];
  return (
    <Table
      head={head}
      rows={anchors.map(a => {
        const days = a.live?.daysLeft;
        return [
          <span>
            {a.title || a.id}
            <Typography component="div" variant="caption" color="text.secondary">
              {label('anchorKind', a.kind, t, has)} · <Id>{a.id}</Id>
            </Typography>
          </span>,
          ...(showService ? [<Link to={`${mount.base}/${encodeURIComponent(a.service)}`}>{a.service}</Link>] : []),
          <span title={a.live?.subject ?? a.liveError}>
            {expiryDay(a)}
            {!a.live && a.liveError && (
              <Typography component="div" variant="caption" color="text.secondary">
                {a.liveError}
              </Typography>
            )}
          </span>,
          days === undefined ? '—' : <Pill tone={choose<Tone>([[days < 0, 'neg'], [days < 90, 'warn']], 'neu')} plain>{String(days)}</Pill>,
          <Pill tone={offlineTone[a.offlineCopy ?? 'unknown'] ?? 'neu'}>{label('offline', a.offlineCopy ?? 'unknown', t, has)}</Pill>,
          a.custodians === undefined ? '—' : String(a.custodians),
          a.notes || '—',
        ];
      })}
    />
  );
};

const Overview = ({ data, mount }: { data: ContinuitySummary; mount: Mount }) => {
  const { t, has } = useI18n();
  const [filter, setFilter] = useState<'all' | 'risk'>('all');
  const c = data.counts;
  const shown = data.profiles.filter(p => filter === 'all' || atRisk(p));
  const filters: Array<[typeof filter, string]> = [
    ['all', t('cont.filter.all')],
    ['risk', t('cont.filter.risk')],
  ];
  return (
    <>
      <Kpis
        items={[
          { label: t('cont.kpi.profiles'), value: `${c.approved ?? 0} / ${c.services ?? 0}` },
          { label: t('cont.kpi.noExport'), value: c.recordsWithoutActiveExport ?? 0, note: t('cont.kpi.ofRecords', { n: c.recordsTotal ?? 0 }), tone: c.recordsWithoutActiveExport ? 'bad' : undefined },
          { label: t('cont.kpi.noOffline'), value: c.anchorsWithoutOfflineCopy ?? 0, note: t('cont.kpi.ofAnchors', { n: c.trustAnchors ?? 0 }), tone: c.anchorsWithoutOfflineCopy ? 'bad' : undefined },
          { label: t('cont.kpi.deprecated'), value: `${c.deprecated ?? 0} / ${c.external ?? 0}` },
        ]}
      />
      <Section title={t('cont.attention')} meta={`${data.attention.length}`}>
        {data.attention.length ? (
          <Attention
            items={data.attention.map(a => ({
              tone: stateTone[a.level],
              label: t(`cont.level.${a.level}`),
              // an item about several services (drafts) has no service to link to
              what: a.service ? (
                <Link to={`${mount.base}/${encodeURIComponent(a.service)}`} style={{ color: 'inherit' }}>
                  {reasonText(a, t, has)}
                </Link>
              ) : (
                reasonText(a, t, has)
              ),
              why: reasonDetail(a, t) || undefined,
            }))}
          />
        ) : (
          <EmptyState title={t('cont.attentionNone')} />
        )}
      </Section>
      <Section title={t('cont.anchors')} meta={t('cont.anchors.meta')} flush>
        <AnchorsTable anchors={data.trustAnchors} mount={mount} />
      </Section>
      <Section
        title={t('cont.services')}
        action={
          <Box role="group" aria-label={t('cont.filter')} sx={{ display: 'inline-flex', p: '2px', gap: '2px', borderRadius: '6px', bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
            {filters.map(([id, text]) => (
              <Button key={id} size="small" variant="text" onClick={() => setFilter(id)} aria-pressed={filter === id} sx={{ px: 1.5, height: 28, color: filter === id ? 'text.primary' : 'text.secondary', bgcolor: filter === id ? 'background.paper' : 'transparent', boxShadow: filter === id ? 1 : 0 }}>
                {text}
              </Button>
            ))}
          </Box>
        }
        flush
        foot={
          <>
            <span>{t('cont.footnote')}</span>
            <a href={PROFILES_REPO} target="_blank" rel="noreferrer">
              {t('cont.footnoteLink')}
            </a>
          </>
        }
      >
        {shown.length ? (
          <Table
            head={[t('cont.col.service'), t('cont.col.tier'), t('cont.col.lifecycle'), t('cont.col.profile'), t('cont.col.records'), t('cont.col.noExport'), t('cont.col.state')]}
            rows={shown.map(p => [
              <span>
                <Link to={`${mount.base}/${encodeURIComponent(p.service)}`}>{p.title || p.service}</Link>
                <Typography component="div" variant="caption" color="text.secondary">
                  <Id>{p.service}</Id>
                </Typography>
              </span>,
              label('tier', p.tier, t, has),
              <Pill tone={lifecycleTone[p.lifecycle] ?? 'neu'}>{label('lifecycle', p.lifecycle, t, has)}</Pill>,
              <Pill tone={p.status === 'approved' ? 'pos' : 'warn'} plain>
                {label('status', p.status, t, has)}
              </Pill>,
              String(p.recordsTotal),
              p.recordsWithoutActiveExport ? <Pill tone="warn" plain>{String(p.recordsWithoutActiveExport)}</Pill> : '0',
              <span title={p.reasons[0] ? reasonText({ ...p.reasons[0], service: p.service }, t, has) : undefined}>
                <StatePill state={p.state} />
              </span>,
            ])}
          />
        ) : (
          <EmptyState title={t('cont.noServices')} />
        )}
      </Section>
    </>
  );
};

/** Whether the catalog has a component named like the service (then the detail links to it). */
function useCatalogEntity(name: string) {
  const catalog = useApi(catalogApiRef);
  const [exists, setExists] = useState(false);
  useEffect(() => {
    let alive = true;
    catalog
      .getEntityByRef({ kind: 'component', namespace: 'default', name })
      .then(e => alive && setExists(!!e))
      .catch(() => alive && setExists(false));
    return () => {
      alive = false;
    };
  }, [catalog, name]);
  return exists;
}

const Detail = ({ p, anchors, mount }: { p: ContinuityProfile; anchors: TrustAnchor[]; mount: Mount }) => {
  const { t, has } = useI18n();
  const inCatalog = useCatalogEntity(p.service);
  const upstream = p.exit?.upstream;
  return (
    <>
      <Row spans={[8, 4]}>
        <Section title={t('cont.reasons')}>
          {p.reasons.length ? (
            <Attention items={p.reasons.map(r => ({ tone: stateTone[r.level], label: t(`cont.level.${r.level}`), what: reasonText({ ...r, service: p.service }, t, has), why: reasonDetail(r, t) || undefined }))} />
          ) : (
            <EmptyState title={t('cont.attentionNone')} />
          )}
        </Section>
        <Section title={t('cont.about')}>
          <Facts
            labelWidth={120}
            items={[
              [t('cont.col.tier'), label('tier', p.tier, t, has)],
              [t('cont.col.lifecycle'), <Pill tone={lifecycleTone[p.lifecycle] ?? 'neu'}>{label('lifecycle', p.lifecycle, t, has)}</Pill>],
              [t('cont.col.profile'), label('status', p.status, t, has)],
              ...(p.replacedBy ? ([[t('cont.replacedBy'), <Link to={`${mount.base}/${encodeURIComponent(p.replacedBy)}`}>{p.replacedBy}</Link>]] as Array<[string, ReactNode]>) : []),
              ...(p.managedIn ? ([[t('cont.managedIn'), p.managedIn]] as Array<[string, ReactNode]>) : []),
              [
                t('cont.profileFile'),
                <a href={profileFileUrl(p)} target="_blank" rel="noreferrer">
                  {p.file || `${p.service}.yaml`}
                </a>,
              ],
              ...(inCatalog ? ([[t('cont.catalogEntity'), <Link to={`${mount.entityBase}/${encodeURIComponent(p.service)}`}>{p.service}</Link>]] as Array<[string, ReactNode]>) : []),
            ]}
          />
        </Section>
      </Row>
      <Section title={t('cont.records')} meta={`${p.recordsWithoutActiveExport} / ${p.recordsTotal}`} flush>
        {p.records.length ? (
          <Table
            head={[t('cont.col.information'), t('cont.col.kind'), t('cont.col.retention'), t('cont.col.export'), t('cont.col.worm')]}
            rows={p.records.map(r => {
              const status = r.export?.status;
              return [
                <span>
                  {r.title || r.id}
                  {r.notes && (
                    <Typography component="div" variant="caption" color="text.secondary">
                      {r.notes}
                    </Typography>
                  )}
                </span>,
                label('kind', r.kind, t, has),
                r.retention || '—',
                <span>
                  <Pill tone={choose<Tone>([[status === 'active', 'pos'], [r.kind === 'record', 'warn']], 'neu')} plain>
                    {status ? label('export', status, t, has) : t('cont.export.none')}
                  </Pill>
                  {exportLine(r) && (
                    <Typography component="div" variant="caption" color="text.secondary">
                      {exportLine(r)}
                    </Typography>
                  )}
                </span>,
                r.worm ? t('cont.yes') : t('cont.no'),
              ];
            })}
          />
        ) : (
          <EmptyState title={t('cont.noRecords')} />
        )}
      </Section>
      <Section title={t('cont.anchors')} flush>
        <AnchorsTable anchors={anchors} mount={mount} showService={false} />
      </Section>
      <Section title={t('cont.exit')}>
        {p.exit ? (
          <Facts
            items={[
              [t('cont.exit.alternative'), p.exit.alternative || '—'],
              [t('cont.exit.format'), p.exit.exportFormat || '—'],
              [t('cont.exit.upstream'), upstream?.project ? `${upstream.project}${upstream.license ? ` (${upstream.license})` : ''}` : '—'],
            ]}
          />
        ) : (
          <EmptyState title={t('cont.exit.none')} />
        )}
      </Section>
      {p.notes && (
        <Section title={t('cont.notes')}>
          <Typography component="div">{p.notes}</Typography>
        </Section>
      )}
    </>
  );
};

/**
 * The Continuity portal (read only): the digital continuity profile of each platform service, from
 * GET /api/continuity/summary (plugins/continuity-backend). Without service: the overview; with one: its detail.
 */
export const ContinuityPage = ({ service, mount = CONSOLE }: { service?: string; mount?: Mount }) => {
  const { t } = useI18n();
  const state = useSummary();
  const data = state.data;
  const profile = service ? data?.profiles.find(p => p.service === service) : undefined;
  const critical = data?.attention.filter(a => a.level === 'critical').length ?? 0;
  const warning = (data?.attention.length ?? 0) - critical;
  const crumbs: Array<[string, string?]> = service ? [[t('cont.crumb'), mount.base], [service]] : [[t('cont.crumb')]];
  return (
    <Box sx={{ display: 'grid', maxWidth: 1240 }}>
      <TitleRow
        crumbs={crumbs}
        title={service ? profile?.title || service : t('cont.title')}
        pills={
          (profile && <StatePill state={profile.state} />) ||
          (!service && data && <Pill plain>{t('cont.approvedN', { a: data.counts.approved ?? 0, n: data.counts.services ?? 0 })}</Pill>)
        }
        sub={service ? <Id>{service}</Id> : t('cont.sub')}
        finding={!service && data && (critical || warning ? t('cont.finding', { c: critical, w: warning }) : t('cont.findingOk'))}
        findingTone={choose<Tone>([[critical, 'neg'], [warning, 'warn']], 'pos')}
        actions={
          <>
            {service && (
              <Button variant="outlined" component={RouterLink} to={mount.base}>
                {t('cont.back')}
              </Button>
            )}
            {!mount.classic && <ClassicLink path={service ? `/continuity/${encodeURIComponent(service)}` : '/continuity'}>{t('shell.classic')}</ClassicLink>}
          </>
        }
      />
      {state.loading && <Progress />}
      {state.error && <WarningPanel title={t('cont.unreadable')} message={state.error} />}
      {data?.warnings?.length ? <WarningPanel severity="info" title={t('cont.warnings')} message={data.warnings.join(' · ')} /> : null}
      {data && !service && <Overview data={data} mount={mount} />}
      {data && service && !profile && <EmptyState title={t('cont.notFound', { service })} tone="neg" />}
      {data && profile && <Detail p={profile} anchors={data.trustAnchors.filter(a => a.service === profile.service)} mount={mount} />}
    </Box>
  );
};

/** /console/continuity/:service */
export const ContinuityServicePage = () => {
  const { service } = useParams();
  return <ContinuityPage key={service} service={service} />;
};

const ClassicService = () => {
  const { service } = useParams();
  return <ContinuityPage key={service} service={service} mount={CLASSIC} />;
};

/**
 * The same page in the classic portal (/continuity, /continuity/:service): the console's texts and theme, outside
 * the console shell.
 */
export const ContinuityClassicPage = () => (
  <I18nProvider>
    <ConsoleTheme>
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Routes>
          <Route path="/" element={<ContinuityPage mount={CLASSIC} />} />
          <Route path="/:service" element={<ClassicService />} />
        </Routes>
      </Box>
    </ConsoleTheme>
  </I18nProvider>
);
