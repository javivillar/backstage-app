import { Link, Progress } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import {
  type App,
  keptDays,
  monthlyCost,
  planTone,
  type Plan,
  type PlanAnswer,
  type Protection,
  schedule,
  size,
  STATE_TONE,
  useProtection,
  useProtectionPrices,
  when,
} from '../../protection';
import { useRq } from '../../theme/consoleTheme';
import { Card } from '../NamespaceSections';
import { Table } from '../NetworkPage';
import { PendingChanges } from '../PendingChanges';
import { EmptyState, Id, Kpis, Pill, TitleRow } from '../ui';
import { Seg } from '../ui-portal';

const BASE = '/console/data-continuity';
const guide = (d: Protection) => d.url.replace(/values\.yaml$/, 'INSTALL.md');
const WEEK = 7 * 24 * 3_600_000;

type T = ReturnType<typeof useI18n>['t'];
const money = (v: number, currency: string, lang: string) => v.toLocaleString(lang, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const planName = (plan: string, plans: Record<string, Plan>, t: T) => (plan === 'none' ? t('dp.plan.none') : plans[plan]?.title ?? plan);

function phaseTone(phase: string): 'pos' | 'neg' | 'info' {
  if (phase === 'Completed') return 'pos';
  return /Failed/.test(phase) ? 'neg' : 'info';
}

/** why an application is not protected, in a sentence; nothing when it is */
function why(app: App, t: T): string | undefined {
  if (app.state === 'late') return t('dp.why.late', { n: app.lateHours ?? 0 });
  if (app.state === 'failed') return t('dp.why.failed', { phase: app.backups[0]?.phase ?? '' });
  if (app.state === 'ok') return undefined;
  return t(`dp.why.${app.state}`);
}

const Note = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'pos'; children: ReactNode }) => {
  const rq = useRq();
  return <Box sx={{ bgcolor: rq[tone].bg, color: tone === 'info' ? rq.ink : rq[tone].fg, borderRadius: '8px', px: 1.5, py: 1.25, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>{children}</Box>;
};

const Facts = ({ rows }: { rows: Array<[string, ReactNode]> }) => (
  <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '170px minmax(0, 1fr)' }, gap: { xs: 0.25, sm: '8px 12px' }, m: 0 }}>
    {rows.map(([k, v]) => [
      <Typography key={`${k}-k`} component="dt" color="text.secondary">
        {k}
      </Typography>,
      <Box key={`${k}-v`} component="dd" sx={{ m: 0, mb: { xs: 1, sm: 0 }, overflowWrap: 'anywhere' }}>
        {v}
      </Box>,
    ])}
  </Box>
);

/** What every page starts with: loading, the error, or "not installed here". */
function useLoaded() {
  const { t } = useI18n();
  const p = useProtection();
  let pending: ReactNode;
  if (p.loading) pending = <Progress />;
  else if (p.error || !p.data) pending = <EmptyState tone="neg" title={t('dp.error')}>{p.error}</EmptyState>;
  else if (!p.data.available) pending = <EmptyState title={t('dp.unavailable')}>{p.data.reason}</EmptyState>;
  return { ...p, pending };
}

const crumbs = (t: T, ...more: Array<[string, string?]>): Array<[string, string?]> => [[t('nav.portal'), '/console'], [t('nav.businessManagement')], ...more];

const StoreBanner = ({ data }: { data: Protection }) => {
  const { t } = useI18n();
  const down = data.store?.phase && data.store.phase !== 'Available';
  if (!data.store?.inCluster && !down) return null;
  return (
    <Note tone="warn">
      <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
        {down ? (
          <b>{t('dp.storeDown')}</b>
        ) : (
          <>
            <b>{t('dp.inCluster')}</b> {t('dp.inCluster.text')}
          </>
        )}
      </Box>
      <Link to={`${BASE}/store`}>{t('dp.store')}</Link>
    </Note>
  );
};

// ===================================================================================================== Applications

/** Portal › Business management › Data continuity: every application with persistent data and how it is protected. */
export const DataContinuityPage = () => {
  const { t, lang } = useI18n();
  const { data, pending } = useLoaded();
  const prices = useProtectionPrices();
  const [filter, setFilter] = useState<'all' | 'bad' | 'ok'>('all');
  const [query, setQuery] = useState('');
  const head = <TitleRow crumbs={crumbs(t, [t('nav.dataContinuity')])} title={t('nav.dataContinuity')} sub={t('dp.sub')} />;
  if (pending || !data) return <>{head}{pending}</>;
  const apps = data.apps;
  const ok = apps.filter(a => a.state === 'ok').length;
  const q = query.trim().toLowerCase();
  const shown = apps.filter(a => (filter === 'all' || (filter === 'ok') === (a.state === 'ok')) && (!q || `${a.app} ${a.namespace} ${planName(a.plan, data.plans, t)}`.toLowerCase().includes(q)));
  const priced = prices.snapshot !== undefined || prices.backup !== undefined;
  const sum = (f: (a: App) => number) => apps.reduce((s, a) => s + f(a), 0);
  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      {head}
      <StoreBanner data={data} />
      <Kpis
        items={[
          { label: t('dp.kpi.apps'), value: apps.length, note: t('dp.kpi.apps.note') },
          { label: t('dp.kpi.ok'), value: ok, note: t('dp.kpi.ok.note') },
          { label: t('dp.kpi.bad'), value: apps.length - ok, note: t('dp.kpi.bad.note'), tone: apps.length - ok ? 'bad' : undefined },
          { label: t('dp.kpi.volumes'), value: sum(a => a.volumes.length), note: t('dp.kpi.volumes.note', { size: size(sum(a => a.volumeBytes), lang) }) },
          { label: t('dp.kpi.snapshots'), value: size(sum(a => a.snapshotBytes), lang), note: t('dp.kpi.snapshots.note') },
          { label: t('dp.kpi.backups'), value: size(sum(a => a.backupBytes), lang), note: t('dp.kpi.backups.note') },
        ]}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <Seg label={t('dp.filter')} value={filter} onChange={setFilter} items={[['all', t('dp.filter.all'), apps.length], ['bad', t('dp.filter.bad'), apps.length - ok], ['ok', t('dp.filter.ok'), ok]]} />
        <TextField size="small" type="search" placeholder={t('dp.search')} inputProps={{ 'aria-label': t('dp.search') }} value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: '1 1 240px', maxWidth: 360 }} />
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Button variant="outlined" component={Link} to={`${BASE}/plans`}>
            {t('dp.plans')}
          </Button>
          <Button variant="outlined" component={Link} to={`${BASE}/store`}>
            {t('dp.store')}
          </Button>
        </Box>
      </Box>
      <Card title={t('dp.apps')} sub={t('dp.apps.sub')}>
        {shown.length ? (
          <Table
            head={[t('dp.col.app'), t('dp.col.plan'), t('dp.col.volumes'), t('dp.col.snapshot'), t('dp.col.backup'), t('dp.col.protected'), ...(priced ? [t('dp.col.cost')] : []), t('dp.col.state')]}
            rows={shown.map(a => {
              const cost = monthlyCost(a, prices);
              return [
                <Box key="a">
                  <Link to={`${BASE}/app/${a.app}`}>{a.app}</Link>
                </Box>,
                <Pill key="p" tone={planTone(a.plan)} plain>
                  {planName(a.plan, data.plans, t)}
                </Pill>,
                `${a.volumes.length} · ${size(a.volumeBytes, lang)}`,
                when(a.lastSnapshot, t, lang),
                when(a.lastBackup, t, lang),
                size(a.backupBytes, lang),
                ...(priced ? [cost ? money(cost.total, prices.currency, lang) : '—'] : []),
                <Box key="s" sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
                  <Pill tone={STATE_TONE[a.state]}>{t(`dp.state.${a.state}`)}</Pill>
                  {why(a, t) && (
                    <Typography variant="caption" color="text.secondary">
                      {why(a, t)}
                    </Typography>
                  )}
                </Box>,
              ];
            })}
          />
        ) : (
          <Typography color="text.secondary">{t('dp.none')}</Typography>
        )}
      </Card>
      <Note>{t('dp.two')}</Note>
      <Typography variant="caption" color="text.secondary">
        {t('dp.readOnly')} <Link to={guide(data)}>INSTALL.md</Link>
      </Typography>
    </Box>
  );
};

// ================================================================================================== One application

/** The recovery points of seven days: one lane of snapshots, one of backups. */
const Timeline = ({ app }: { app: App }) => {
  const { t } = useI18n();
  const rq = useRq();
  const now = Date.now();
  const within = (iso?: string) => {
    const at = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(at) && now - at <= WEEK && at <= now ? at : undefined;
  };
  const lanes: Array<{ key: string; title: string; note: string; color: string; square?: boolean; points: number[] }> = [
    { key: 'snap', title: t('dp.points.snapshots'), note: t('dp.points.snapshots.note'), color: rq.data, points: app.snapshotTimes.map(within).filter((x): x is number => x !== undefined) },
    { key: 'bak', title: t('dp.points.backups'), note: t('dp.points.backups.note'), color: rq.positive, square: true, points: app.backups.filter(b => b.phase === 'Completed').map(b => within(b.completed ?? b.started)).filter((x): x is number => x !== undefined) },
  ];
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {lanes.map(l => (
        <Box key={l.key} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(0, 1fr)' }, gap: 1.5, alignItems: 'center' }}>
          <Box>
            <Box sx={{ fontWeight: 500 }}>{l.title}</Box>
            <Typography variant="caption" color="text.secondary">
              {l.note} · {t('dp.points.count', { n: l.points.length })}
            </Typography>
          </Box>
          <Box role="img" aria-label={`${l.title}: ${t('dp.points.count', { n: l.points.length })}`} sx={{ position: 'relative', height: 26, borderRadius: '6px', bgcolor: rq.raised, border: `1px solid ${rq.border}` }}>
            {l.points.map(at => (
              <Box key={at} title={new Date(at).toLocaleString()} sx={{ position: 'absolute', top: '50%', left: `${100 - ((now - at) / WEEK) * 100}%`, width: 12, height: 12, mt: '-6px', ml: '-6px', borderRadius: l.square ? '3px' : '50%', bgcolor: l.color, border: `2px solid ${rq.sheet}`, boxSizing: 'border-box' }} />
            ))}
          </Box>
        </Box>
      ))}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', ml: { sm: '202px' } }}>
        <Typography variant="caption" color="text.secondary">
          {t('dp.points.from')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('dp.points.now')}
        </Typography>
      </Box>
    </Box>
  );
};

/** What is kept of an application: its plan, its recovery points, its volumes and its last backups. */
export const AppProtection = ({ app, data }: { app: App; data: Protection }) => {
  const { t, lang } = useI18n();
  const prices = useProtectionPrices();
  const plan = data.plans[app.plan];
  const cost = monthlyCost(app, prices);
  const reason = why(app, t);
  const m = (v: number) => money(v, prices.currency, lang);
  const facts: Array<[string, ReactNode]> = [[t('dp.fact.plan'), `${planName(app.plan, data.plans, t)}${plan?.description ? ` — ${plan.description}` : ''}`]];
  if (plan) {
    facts.push([t('dp.fact.snapshots'), plan.snapshot ? t('dp.keep.last', { when: schedule(plan.snapshot.cron, t), n: plan.snapshot.retain }) : t('dp.cron.none')]);
    if (!app.holdsStore) {
      facts.push([t('dp.fact.backups'), plan.backup ? t('dp.keep.days', { when: schedule(plan.backup.cron, t), n: keptDays(plan.backup.ttl) ?? '?' }) : t('dp.cron.none')]);
      if (plan.weekly) facts.push([t('dp.fact.weekly'), t('dp.keep.days', { when: schedule(plan.weekly.cron, t), n: keptDays(plan.weekly.ttl) ?? '?' })]);
      facts.push([t('dp.fact.data'), plan.volumes ? t('dp.fact.data.yes') : t('dp.fact.data.no')]);
    }
  }
  if (cost) facts.push([t('dp.fact.cost'), t('dp.fact.cost.text', { total: m(cost.total), snapshots: `${size(app.snapshotBytes, lang)} · ${m(cost.snapshots)}`, backups: `${size(app.backupBytes, lang)} · ${m(cost.backups)}` })]);
  return (
    <>
      <Card title={t('dp.app.protection')} sub={<Id>{app.namespace}</Id>}>
        <Box>
          <Pill tone={STATE_TONE[app.state]}>{t(`dp.state.${app.state}`)}</Pill>
        </Box>
        {reason && <Note tone="warn">{reason}</Note>}
        <Facts rows={facts} />
      </Card>
      <Card title={t('dp.points')} sub={t('dp.points.sub')}>
        <Timeline app={app} />
      </Card>
      <Card title={t('dp.volumes')} sub={t('dp.volumes.sub')}>
        <Table
          head={[t('dp.col.volume'), t('dp.col.size'), t('dp.col.class'), t('dp.col.snapshot'), t('dp.col.count'), t('dp.col.space')]}
          rows={app.volumes.map(v => [<Id key="n">{v.name}</Id>, size(v.bytes, lang), v.storageClass ?? '—', when(v.lastSnapshot, t, lang), v.snapshots, size(v.snapshotBytes, lang)])}
        />
      </Card>
      <Card title={t('dp.runs')} sub={t('dp.runs.sub')}>
        {app.backups.length ? (
          <Table
            head={[t('dp.col.when'), t('dp.col.schedule'), t('dp.col.result'), t('dp.col.protected'), t('dp.col.expires')]}
            rows={app.backups.map(b => [
              when(b.completed ?? b.started, t, lang),
              b.schedule ? <Id key="s">{b.schedule}</Id> : t('dp.byHand'),
              <Pill key="p" tone={phaseTone(b.phase)}>
                {b.phase}
              </Pill>,
              b.withVolumes ? size(b.bytes, lang) : t('dp.fact.data.no'),
              b.expires ? new Date(b.expires).toLocaleDateString(lang) : '—',
            ])}
          />
        ) : (
          <Typography color="text.secondary">{t('dp.runs.none')}</Typography>
        )}
      </Card>
    </>
  );
};

/** Data continuity › one application. */
export const ProtectionAppPage = () => {
  const { t } = useI18n();
  const { app: name = '' } = useParams();
  const { data, pending } = useLoaded();
  const app = data?.apps.find(a => a.app === name);
  const head = <TitleRow crumbs={crumbs(t, [t('nav.dataContinuity'), BASE], [name])} title={name} sub={app ? t('dp.app.sub', { ns: app.namespace }) : undefined} />;
  if (pending || !data) return <>{head}{pending}</>;
  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      {head}
      {app ? <AppProtection app={app} data={data} /> : <EmptyState title={t('dp.app.missing')} />}
    </Box>
  );
};

const SharedTable = ({ apps, data }: { apps: App[]; data: Protection }) => {
  const { t, lang } = useI18n();
  return (
    <Table
      head={[t('dp.col.service'), t('dp.col.plan'), t('dp.col.snapshot'), t('dp.col.backup'), t('dp.col.state')]}
      rows={apps.map(a => [
        <Link key="a" to={`${BASE}/app/${a.app}`}>
          {a.app}
        </Link>,
        <Pill key="p" tone={planTone(a.plan)} plain>
          {planName(a.plan, data.plans, t)}
        </Pill>,
        when(a.lastSnapshot, t, lang),
        when(a.lastBackup, t, lang),
        <Box key="s" sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
          <Pill tone={STATE_TONE[a.state]}>{t(`dp.state.${a.state}`)}</Pill>
          {why(a, t) && (
            <Typography variant="caption" color="text.secondary">
              {why(a, t)}
            </Typography>
          )}
        </Box>,
      ])}
    />
  );
};

/** The tab Data continuity of an application of the catalogue: its own volumes and the shared services it depends on. */
export const EntityProtectionContent = () => {
  const { t } = useI18n();
  const { entity } = useEntity();
  const { data, pending } = useLoaded();
  const namespace = entity.metadata.annotations?.['backstage.io/kubernetes-namespace'];
  const shared = useMemo(() => {
    const names = new Set((entity.relations ?? []).filter(r => r.type === 'dependsOn').map(r => r.targetRef.split('/').pop() ?? ''));
    return (data?.apps ?? []).filter(a => names.has(a.app) && a.namespace !== namespace);
  }, [entity.relations, data?.apps, namespace]);
  if (pending || !data) return <>{pending}</>;
  const app = data.apps.find(a => a.namespace === namespace);
  const bad = shared.filter(a => a.state !== 'ok');
  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Typography variant="caption" color="text.secondary">
        <Link to={BASE}>{t('dp.all')}</Link>
      </Typography>
      {app && app.state === 'ok' && bad.length > 0 && <Note tone="warn">{t('dp.shared.bad', { n: bad.length, total: shared.length, names: bad.map(a => a.app).join(', ') })}</Note>}
      {app ? <AppProtection app={app} data={data} /> : <EmptyState title={t('dp.app.missing')} />}
      {shared.length > 0 && (
        <Card title={t('dp.shared')} sub={t('dp.shared.sub')}>
          <Box>
            <Pill tone={bad.length ? 'warn' : 'pos'}>{t('dp.shared.count', { ok: shared.length - bad.length, n: shared.length })}</Pill>
          </Box>
          <SharedTable apps={shared} data={data} />
        </Card>
      )}
    </Box>
  );
};

// ============================================================================================================ Plans

/** Data continuity › Protection plans: what each plan keeps, and the plan of each application (changed by pull request). */
export const ProtectionPlansPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const { data, pending, post } = useLoaded();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PlanAnswer>();
  const [failure, setFailure] = useState<string>();
  const head = <TitleRow crumbs={crumbs(t, [t('nav.dataContinuity'), BASE], [t('dp.plans')])} title={t('dp.plans')} sub={t('dp.plans.sub')} />;
  if (pending || !data) return <>{head}{pending}</>;
  const names = [...Object.keys(data.plans), 'none'];
  const changes = Object.fromEntries(Object.entries(draft).filter(([app, plan]) => data.apps.find(a => a.app === app)?.plan !== plan));
  const count = Object.keys(changes).length;
  const open = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      setDone(await post(changes));
      setDraft({});
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      {head}
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
        {Object.entries(data.plans).map(([id, p]) => (
          <Card key={id} title={p.title ?? id} sub={p.description}>
            <Box>
              <Pill tone={planTone(id)} plain>
                {t('dp.plans.apps', { n: data.apps.filter(a => a.plan === id).length })}
              </Pill>
            </Box>
            <Facts
              rows={[
                [t('dp.fact.snapshots'), p.snapshot ? t('dp.keep.last', { when: schedule(p.snapshot.cron, t), n: p.snapshot.retain }) : t('dp.cron.none')],
                [t('dp.fact.backups'), p.backup ? t('dp.keep.days', { when: schedule(p.backup.cron, t), n: keptDays(p.backup.ttl) ?? '?' }) : t('dp.cron.none')],
                ...(p.weekly ? [[t('dp.fact.weekly'), t('dp.keep.days', { when: schedule(p.weekly.cron, t), n: keptDays(p.weekly.ttl) ?? '?' })] as [string, ReactNode]] : []),
                [t('dp.fact.data'), p.volumes ? t('dp.fact.data.yes') : t('dp.fact.data.no')],
              ]}
            />
          </Card>
        ))}
      </Box>
      {done && (
        <Note tone="pos">
          <Box role="status" sx={{ flex: '1 1 320px' }}>
            {t('dp.plans.done', { n: done.pull.number, version: done.version })} {t('dp.plans.done.next')}
          </Box>
          <Link to={done.pull.url}>{t('dp.plans.see')}</Link>
        </Note>
      )}
      <PendingChanges plugin="protection" path="/pulls" refresh={done?.pull.number} applies={t('dp.plans.applies')} />
      {failure && <EmptyState tone="neg" title={t('dp.error')}>{failure}</EmptyState>}
      <Card title={t('dp.plans.each')} sub={t('dp.plans.each.sub')}>
        {!data.may && (
          <Typography variant="caption" color="text.secondary">
            {t('dp.plans.may', { groups: data.groups.join(', ') })}
          </Typography>
        )}
        <Table
          head={[t('dp.col.app'), t('dp.col.today'), t('dp.col.change')]}
          rows={data.apps.map(a => {
            const value = draft[a.app] ?? a.plan;
            return [
              <Link key="a" to={`${BASE}/app/${a.app}`}>
                {a.app}
              </Link>,
              <Pill key="p" tone={planTone(a.plan)} plain>
                {planName(a.plan, data.plans, t)}
              </Pill>,
              <Box
                key="s"
                component="select"
                aria-label={t('dp.plans.of', { app: a.app })}
                disabled={!data.may || busy}
                value={value}
                onChange={(e: { target: { value: string } }) => setDraft(d => ({ ...d, [a.app]: e.target.value }))}
                sx={{ font: 'inherit', px: 1, py: 0.5, borderRadius: '6px', border: `1px solid ${value !== a.plan ? rq.warning : rq.control}`, bgcolor: rq.sheet, color: 'inherit' }}
              >
                {names.map(n => (
                  <option key={n} value={n}>
                    {planName(n, data.plans, t)}
                  </option>
                ))}
              </Box>,
            ];
          })}
        />
        <Typography variant="caption" color="text.secondary">
          <Link to={data.url}>{data.path}</Link> · {data.repo}
        </Typography>
      </Card>
      {count > 0 && (
        <Box sx={{ position: 'sticky', bottom: 8, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', bgcolor: rq.sheet, border: `1px solid ${rq.ink}`, borderRadius: '8px', px: 2, py: 1.25, boxShadow: '0 4px 16px rgba(18,24,32,.12)', zIndex: 1 }}>
          <Box role="status" sx={{ fontWeight: 600 }}>
            {t('dp.plans.changed', { n: count })}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 200px', minWidth: 0 }}>
            {Object.entries(changes)
              .map(([app, plan]) => `${app}: ${planName(data.apps.find(a => a.app === app)?.plan ?? 'none', data.plans, t)} → ${planName(plan, data.plans, t)}`)
              .join(' · ')}
          </Typography>
          <Button variant="contained" disabled={busy} onClick={open}>
            {busy ? t('dp.plans.opening') : t('dp.plans.open')}
          </Button>
          <Button variant="outlined" disabled={busy} onClick={() => setDraft({})}>
            {t('dp.plans.discard')}
          </Button>
        </Box>
      )}
    </Box>
  );
};

// ============================================================================================================ Store

/** Data continuity › Backup store: where the backups are, what that covers and how the store moves outside. */
export const ProtectionStorePage = () => {
  const { t, lang } = useI18n();
  const rq = useRq();
  const { data, pending } = useLoaded();
  const head = <TitleRow crumbs={crumbs(t, [t('nav.dataContinuity'), BASE], [t('dp.store')])} title={t('dp.store')} sub={t('dp.store.sub')} />;
  if (pending || !data || !data.store) return <>{head}{pending}</>;
  const s = data.store;
  const yes = <Box sx={{ color: rq.pos.fg, fontWeight: 600 }}>{t('dp.cover.yes')}</Box>;
  const fast = <Box sx={{ color: rq.pos.fg, fontWeight: 600 }}>{t('dp.cover.fast')}</Box>;
  const no = (k: string) => <Box sx={{ color: rq.neg.fg, fontWeight: 600 }}>{t(k)}</Box>;
  const outside = !s.inCluster;
  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      {head}
      <Card title={t(s.inCluster ? 'dp.store.title.in' : 'dp.store.title.out')} sub={t('dp.store.one')}>
        <Box>
          <Pill tone={s.inCluster ? 'warn' : 'pos'}>{t(s.inCluster ? 'dp.store.in' : 'dp.store.out')}</Pill>
        </Box>
        <Facts
          rows={[
            [t('dp.store.address'), <Id key="u">{s.url}</Id>],
            [t('dp.store.bucket'), <Id key="b">{s.bucket}</Id>],
            [t('dp.store.state'), s.phase ? t('dp.store.checked', { phase: s.phase, when: when(s.validated, t, lang) }) : t('dp.store.unknown')],
            ...(s.next?.url ? [[t('dp.store.next'), <Id key="n">{`${s.next.url} · ${s.next.bucket ?? s.bucket}`}</Id>] as [string, ReactNode]] : []),
            [t('dp.store.encryption'), t('dp.store.encryption.text')],
            [t('dp.store.setting'), <Link key="l" to={data.url}>{`store · ${data.path}`}</Link>],
          ]}
        />
      </Card>
      <Card title={t('dp.cover')} sub={t(s.inCluster ? 'dp.cover.in' : 'dp.cover.out')}>
        <Table
          head={[t('dp.cover.case'), t('dp.cover.snap'), t('dp.cover.bak')]}
          rows={[
            [t('dp.cover.1'), fast, yes],
            [t('dp.cover.2'), fast, yes],
            [t('dp.cover.3'), no('dp.cover.no'), outside ? yes : no('dp.cover.no')],
            [t('dp.cover.4'), no('dp.cover.no'), outside ? yes : no('dp.cover.no')],
            [t('dp.cover.5'), no('dp.cover.no'), no('dp.cover.offsite')],
          ]}
        />
      </Card>
      {s.inCluster ? (
        <Card title={t('dp.move')} sub={t('dp.move.sub')}>
          <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <li key={n}>{t(`dp.move.${n}`)}</li>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary">
            <Link to={guide(data)}>{t('dp.move.guide')}</Link>
          </Typography>
        </Card>
      ) : (
        <Note tone="pos">{t('dp.moved')}</Note>
      )}
    </Box>
  );
};
