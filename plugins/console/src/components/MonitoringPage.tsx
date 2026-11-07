import { type Entity, parseEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { CATALOG_FILTER_EXISTS, catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import LockOutlined from '@mui/icons-material/LockOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import Refresh from '@mui/icons-material/Refresh';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useActions } from '../actions';
import { useI18n } from '../i18n';
import { MONO, useRq } from '../theme/consoleTheme';
import { grafanaUrl, RANGES, type GrafanaKind, type Range } from './EntityGrafana';
import { applicationsOf, canSee, exploreUrl, grafanaBase, grouped, servicesOf, type Target } from './monitoringModel';
import { EmptyState, Pill, TitleRow, choose } from './ui';

type Scope = 'services' | 'applications';
const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels', 'spec.owner'];

/** The Domain of the stack and the Components with a namespace (services and deployments), once. */
function useMonitoringCatalog() {
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<{ loading: boolean; domain?: Entity; components: Entity[]; error?: string }>({ loading: true, components: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      catalog.getEntities({ filter: { kind: 'domain', 'metadata.annotations.refresquito.io/grafana-services': CATALOG_FILTER_EXISTS }, fields: FIELDS }),
      catalog.getEntities({ filter: { kind: 'component', 'metadata.annotations.refresquito.io/namespace': CATALOG_FILTER_EXISTS }, fields: FIELDS }),
    ]).then(
      ([d, c]) => alive && setState({ loading: false, domain: d.items[0], components: c.items }),
      e => alive && setState({ loading: false, components: [], error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return state;
}

/** The groups of the signed-in user (ownership refs), lower case. */
function useRefs() {
  const identity = useApi(identityApiRef);
  const [refs, setRefs] = useState<Set<string>>();
  useEffect(() => {
    let alive = true;
    identity.getBackstageIdentity().then(
      id => alive && setRefs(new Set(id.ownershipEntityRefs.map(r => r.toLowerCase()))),
      () => alive && setRefs(new Set()),
    );
    return () => {
      alive = false;
    };
  }, [identity]);
  return refs;
}

/** The console page of an entity ref (as consoleEntityPath of classify.ts builds it from an entity). */
const entityPath = (ref: string) => {
  const r = parseEntityRef(ref);
  return `/console/entity/${r.namespace}/${r.kind.toLowerCase()}/${r.name}`;
};

/**
 * Portal › Support › Monitoring: pick a Refresquito service or a business application, then its Performance or
 * Logging dashboards, embedded from Grafana in kiosk mode. The state is in the URL (?scope&name&env&view&dashboard&range)
 * so a link can be shared. A user sees what their Grafana groups give them; the groups of console.actions.groups see all.
 */
export const MonitoringPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const theme = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const { loading, domain, components, error } = useMonitoringCatalog();
  const refs = useRefs();
  const actions = useActions();
  const admin = Boolean(actions.data?.allowed);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [bump, setBump] = useState(0);

  const scope: Scope = params.get('scope') === 'applications' ? 'applications' : 'services';
  const view: GrafanaKind = params.get('view') === 'logs' ? 'logs' : 'performance';
  const range: Range = (RANGES as readonly string[]).includes(params.get('range') ?? '') ? (params.get('range') as Range) : '1h';
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v === undefined ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace: true });
  };

  const base = grafanaBase(domain, components);
  const all = useMemo(
    () => ({ services: servicesOf(domain, components), applications: applicationsOf(components) }),
    [domain, components],
  );
  const mine = (list: Target[]) => (refs ? list.filter(x => canSee(x, refs, admin)) : []);
  const visible = mine(all[scope]);
  const locked = refs ? all[scope].filter(x => !canSee(x, refs, admin)) : [];
  const needle = q.trim().toLowerCase();
  const shown = visible.filter(x => !needle || `${x.title} ${x.name} ${x.group}`.toLowerCase().includes(needle));
  const target = visible.find(x => x.name === params.get('name')) ?? visible[0];
  const env = target?.envs.find(e => e.env === params.get('env')) ?? target?.envs[0];
  const boards = (env?.dashboards ?? []).filter(d => d.kind === view);
  const board = boards.find(d => d.uid === params.get('dashboard')) ?? boards[0];
  const count = (x: Target) => x.envs.reduce((n, e) => Math.max(n, e.dashboards.length), 0);
  const countLabel = (n: number) => choose<string>([[n === 0, t('mon.noDashboards')], [n === 1, t('mon.dashboard')]], t('mon.dashboards', { n }));

  const pick = (x: Target) => {
    const first = x.envs[0]?.dashboards ?? [];
    const keep = first.some(d => d.kind === view) || !first.length;
    set({ name: x.name, env: undefined, dashboard: undefined, view: keep ? view : first[0].kind });
  };

  const picker = (
    <Box sx={{ flex: '1 0 260px', maxWidth: { md: 300 }, p: 2, borderRight: { md: `1px solid ${rq.border}` }, borderBottom: { xs: `1px solid ${rq.border}`, md: 0 }, display: 'flex', flexDirection: 'column', gap: 1.25, boxSizing: 'border-box' }}>
      <ToggleButtonGroup size="small" exclusive fullWidth value={scope} aria-label={t('mon.scope')} onChange={(_, v) => v && set({ scope: v, name: undefined, env: undefined, dashboard: undefined })}>
        <ToggleButton value="services" sx={{ textTransform: 'none' }}>{t('mon.services')}</ToggleButton>
        <ToggleButton value="applications" sx={{ textTransform: 'none' }}>{t('mon.applications')}</ToggleButton>
      </ToggleButtonGroup>
      <TextField size="small" type="search" label={t('mon.search')} value={q} onChange={e => setQ(e.target.value)} />
      {grouped(shown).map(g => (
        <Box key={g.group}>
          <Typography sx={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary', px: 0.5, pt: 1, pb: 0.25 }}>{g.group}</Typography>
          {g.items.map(x => {
            const on = x.name === target?.name;
            const n = count(x);
            return (
              <Box
                key={x.name}
                component="button"
                type="button"
                aria-pressed={on}
                onClick={() => pick(x)}
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, width: '100%', minHeight: 36, border: 0, borderRadius: '6px', px: 1, py: 0.5, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'text.primary', bgcolor: on ? rq.dataSoft : 'transparent', '&:hover': { bgcolor: on ? rq.dataSoft : rq.raised } }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title}</Box>
                  <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>{x.name}</Box>
                </Box>
                <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', fontStyle: n ? 'normal' : 'italic' }}>{countLabel(n)}</Box>
              </Box>
            );
          })}
        </Box>
      ))}
      {needle && !shown.length && <Typography variant="body2" color="text.secondary">{t('mon.noMatch', { q })}</Typography>}
      {locked.length > 0 && (
        <Box sx={{ border: `1px dashed ${rq.border}`, borderRadius: '8px', p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 500 }}>
            <LockOutlined sx={{ fontSize: 16 }} aria-hidden />
            {t('mon.locked', { n: locked.length })}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {locked.slice(0, 6).map(x => x.title).join(', ')}
            {locked.length > 6 ? ` +${locked.length - 6}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">{t('mon.lockedHint')}</Typography>
          <Button size="small" variant="outlined" component={Link} to="/console/app/support" sx={{ alignSelf: 'flex-start' }}>{t('mon.requestAccess')}</Button>
        </Box>
      )}
    </Box>
  );

  const explore = base && env?.namespace ? exploreUrl(base, view, env.namespace, range) : undefined;
  const allEmpty = !env?.dashboards.length;
  const dashboards = (
    <Box component="section" aria-label={t('mon.view')} sx={{ flex: '999 1 520px', minWidth: 0, p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 1.75, boxSizing: 'border-box' }}>
      {target && env ? (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: 18, lineHeight: '24px', fontWeight: 600 }}>{target.title}</Typography>
              <Typography variant="body2" color="text.secondary" component="div">
                <Box component="span" sx={{ fontFamily: MONO, fontSize: 12.5 }} title={t('mon.folder')}>{env.folder}</Box>
                {env.namespace && (
                  <>
                    {` · ${t('mon.namespace')} `}
                    <Box component="span" sx={{ fontFamily: MONO, fontSize: 12.5 }}>{env.namespace}</Box>
                  </>
                )}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {target.envs.length > 1 ? (
                <ToggleButtonGroup size="small" exclusive value={env.env} aria-label={t('mon.environment')} onChange={(_, v) => v && set({ env: v, dashboard: undefined })}>
                  {target.envs.map(e => <ToggleButton key={e.env} value={e.env} sx={{ textTransform: 'none', px: 1.25, py: 0.25 }}>{e.env}</ToggleButton>)}
                </ToggleButtonGroup>
              ) : (
                <Pill tone={env.env === 'pro' ? 'pos' : 'warn'} plain>{`${t('mon.environment')}: ${env.env}`}</Pill>
              )}
              {env.entityRef && <Button size="small" component={Link} to={entityPath(env.entityRef)}>{t('mon.openEntity')}</Button>}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
            <ToggleButtonGroup size="small" exclusive value={view} aria-label={t('mon.view')} onChange={(_, v) => v && set({ view: v, dashboard: undefined })}>
              <ToggleButton value="performance" sx={{ textTransform: 'none', gap: 0.75 }}>
                {t('mon.performance')}
                <Box component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>{env.dashboards.filter(d => d.kind === 'performance').length}</Box>
              </ToggleButton>
              <ToggleButton value="logs" sx={{ textTransform: 'none', gap: 0.75 }}>
                {t('mon.logging')}
                <Box component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>{env.dashboards.filter(d => d.kind === 'logs').length}</Box>
              </ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <ToggleButtonGroup size="small" exclusive value={range} aria-label={t('graf.range')} onChange={(_, v) => v && set({ range: v })}>
                {RANGES.map(r => <ToggleButton key={r} value={r} sx={{ px: 1.25, py: 0.25, textTransform: 'none' }}>{r}</ToggleButton>)}
              </ToggleButtonGroup>
              <Button size="small" variant="outlined" startIcon={<Refresh fontSize="small" />} onClick={() => setBump(b => b + 1)}>{t('graf.refresh')}</Button>
              {board && base && (
                <Button size="small" variant="contained" disableElevation href={grafanaUrl(base, board.uid, { range })} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>
                  {t('graf.open')}
                </Button>
              )}
            </Box>
          </Box>

          {boards.length > 1 && (
            <Box role="group" aria-label={t('mon.dashboardPick')} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {boards.map(d => {
                const on = d.uid === board?.uid;
                return (
                  <Box
                    key={d.uid}
                    component="button"
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ dashboard: d.uid })}
                    sx={{ font: 'inherit', fontSize: 13, minHeight: 32, px: 1.5, borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? rq.data : rq.border}`, color: on ? rq.data : 'text.primary', bgcolor: on ? rq.dataSoft : rq.sheet, fontWeight: on ? 500 : 400 }}
                  >
                    {d.title}
                  </Box>
                );
              })}
            </Box>
          )}

          {board && base ? (
            <>
              <Box
                key={`${board.uid}-${bump}`}
                component="iframe"
                title={`${target.title} · ${board.title}`}
                src={grafanaUrl(base, board.uid, { range, theme, kiosk: true })}
                sx={{ width: '100%', height: 'calc(100vh - 330px)', minHeight: 560, border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.raised }}
              />
              <Typography variant="caption" color="text.secondary">{t('mon.hint')}</Typography>
            </>
          ) : (
            <Box sx={{ border: `1px dashed ${rq.border}`, borderRadius: '8px', bgcolor: rq.raised }}>
              <EmptyState
                title={choose<string>([[allEmpty, t('mon.emptyAll', { name: target.title })], [view === 'logs', t('mon.emptyLogs')]], t('mon.emptyPerf'))}
                action={
                  explore && !allEmpty ? (
                    <Button size="small" variant="contained" disableElevation href={explore} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>
                      {t('mon.explore')}
                    </Button>
                  ) : undefined
                }
              >
                {choose<string>([[allEmpty, t('mon.emptyAllText', { folder: env.folder })], [view === 'logs', t('mon.emptyLogsText')]], t('mon.emptyPerfText'))}
                {explore && !allEmpty && (
                  <Box component="code" sx={{ display: 'block', mt: 1, fontFamily: MONO, fontSize: 12, wordBreak: 'break-all' }}>
                    {view === 'logs' ? `{namespace="${env.namespace}"}` : `namespace="${env.namespace}"`}
                  </Box>
                )}
              </EmptyState>
            </Box>
          )}
        </>
      ) : (
        <EmptyState title={visible.length ? t('mon.pick') : t('mon.noneVisible')}>{visible.length ? undefined : t('mon.noneVisibleText')}</EmptyState>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TitleRow
        crumbs={[[t('nav.portal'), '/console'], [t('nav.support')], [t('nav.monitoring')]]}
        title={t('nav.monitoring')}
        sub={t('mon.sub')}
        pills={refs && <Pill>{t('mon.count', { n: visible.length, total: all[scope].length })}</Pill>}
      />
      {(loading || !refs) && <Progress />}
      {error && <WarningPanel title={t('list.noCatalog')} message={error} />}
      {!loading && !error && scope === 'services' && !domain && <WarningPanel title={t('mon.noCatalog')} message={t('mon.noCatalogText')} />}
      {!loading && refs && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', border: `1px solid ${rq.border}`, borderRadius: '12px', bgcolor: rq.sheet }}>
          {picker}
          {dashboards}
        </Box>
      )}
    </Box>
  );
};
