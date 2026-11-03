import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { CATALOG_FILTER_EXISTS, catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ApiIcon from '@mui/icons-material/Api';
import DescriptionIcon from '@mui/icons-material/Description';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge } from './Badge';
import { classify, consoleEntityPath } from './classify';
import { rq } from './tokens';
import { useI18n } from '../i18n';
import { useRq } from '../theme/consoleTheme';
import { Pill, Section, TitleRow } from './ui';
import { Seg } from './ui-portal';
import { openApiOperations } from './EntityBuild';

const TECHDOCS = 'backstage.io/techdocs-ref';

/** Entities of the catalog for one query, with loading and error. */
function useEntities(filter: Record<string, string | symbol | (string | symbol)[]>, fields?: string[]) {
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<{ loading: boolean; items: Entity[]; error?: string }>({ loading: true, items: [] });
  const key = JSON.stringify(filter, (_, v) => (typeof v === 'symbol' ? 'EXISTS' : v));
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter, ...(fields ? { fields } : {}) }).then(
      r => alive && setState({ loading: false, items: r.items }),
      e => alive && setState({ loading: false, items: [], error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, key]);
  return state;
}

/** the name of a reference; an owner may be written without its kind (platform-team), which parseEntityRef refuses */
const shortRef = (ref?: string) => {
  if (!ref) return '';
  try {
    return parseEntityRef(ref, { defaultKind: 'group', defaultNamespace: 'default' }).name;
  } catch {
    return ref;
  }
};
const titleOf = (e: Entity) => e.metadata.title ?? e.metadata.name;

/** Page frame of the portal lists: title, one line of what it is, a search box and filter buttons. */
const PortalList = ({
  title,
  sub,
  q,
  setQ,
  filters,
  filter,
  setFilter,
  children,
}: {
  title: string;
  sub: string;
  q: string;
  setQ: (v: string) => void;
  filters: Array<[string, string, number]>;
  filter: string;
  setFilter: (v: string) => void;
  children: ReactNode;
}) => {
  const { t } = useI18n();
  return (
    <Box>
      <TitleRow crumbs={[[t('nav.portal'), '/console'], [title]]} title={title} sub={sub} />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <TextField size="small" placeholder={t('list.search')} value={q} onChange={e => setQ(e.target.value)} inputProps={{ 'aria-label': `${t('list.search')} · ${title}` }} sx={{ flex: '1 1 260px', maxWidth: 420 }} />
        <Seg label={t('cat.show')} items={filters} value={filter} onChange={setFilter} />
      </Box>
      {children}
    </Box>
  );
};

const matches = (q: string, ...xs: Array<string | undefined>) => !q || xs.join(' ').toLowerCase().includes(q.toLowerCase());

const kindBadge = (e: Entity) => {
  const k = classify(e);
  if (k === 'business') return <Badge label="Business application" bg={rq.biz.bg} fg={rq.biz.fg} />;
  if (k === 'service') return <Badge label="Refresquito service" bg={rq.svc.bg} fg={rq.svc.fg} />;
  return <Badge label={e.kind} outlined />;
};

const cardSx = {
  border: 1,
  borderColor: 'divider',
  borderRadius: '8px',
  p: 2,
  bgcolor: 'background.paper',
  display: 'grid',
  gap: 1,
  alignContent: 'start',
  minWidth: 0,
  textDecoration: 'none',
  color: 'text.primary',
  '&:hover': { borderColor: 'primary.main', boxShadow: '0 4px 14px rgba(0,0,0,.06)' },
} as const;

/** Portal › Docs: every entity with docs, opening its Docs tab inside the console. */
export const PortalDocsPage = () => {
  const { t } = useI18n();
  const { loading, items, error } = useEntities({ [`metadata.annotations.${TECHDOCS}`]: CATALOG_FILTER_EXISTS });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const count = (k: string) => items.filter(e => k === 'all' || classify(e) === k || (k === 'system' && e.kind === 'System')).length;
  const shown = items
    .filter(e => filter === 'all' || (filter === 'system' ? e.kind === 'System' : classify(e) === filter && e.kind !== 'System'))
    .filter(e => matches(q, e.metadata.name, e.metadata.title, e.metadata.description, shortRef(e.spec?.owner as string)))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  return (
    <PortalList
      title={t('page.docs')}
      sub={t('docs.sub')}
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[
        ['all', t('cat.all'), count('all')],
        ['system', t('docs.systems'), count('system')],
        ['business', t('cat.businessApps'), items.filter(e => e.kind !== 'System' && classify(e) === 'business').length],
        ['service', t('cat.services'), items.filter(e => e.kind !== 'System' && classify(e) === 'service').length],
      ]}
    >
      {loading && <Progress />}
      {error && <WarningPanel title={t('list.noCatalog')} message={error} />}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(290px, 100%), 1fr))' }}>
        {shown.map(e => (
          <Box key={stringifyEntityRef(e)} component={Link} to={`${consoleEntityPath(e)}/docs`} sx={cardSx}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <DescriptionIcon fontSize="small" sx={{ color: rq.primary }} />
              <Typography sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(e)}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {e.metadata.description ?? '—'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
              {kindBadge(e)}
              {e.spec?.owner && (
                <Typography variant="caption" color="text.secondary">
                  {shortRef(e.spec.owner as string)}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
      {!loading && !shown.length && <Typography color="text.secondary">{t('docs.none')}</Typography>}
    </PortalList>
  );
};

/** Portal › APIs: every API of the catalog, who provides it and who consumes it. */
export const PortalApisPage = () => {
  const { t } = useI18n();
  const { loading, items, error } = useEntities({ kind: 'api' });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const types = useMemo(() => [...new Set(items.map(e => String(e.spec?.type ?? 'other')))].sort(), [items]);
  const rel = (e: Entity, type: string) => (e.relations ?? []).filter(r => r.type === type).map(r => shortRef(r.targetRef));
  // the operations of each definition, to tell which ones answer without authentication
  const ops = useMemo(() => new Map(items.map(e => [stringifyEntityRef(e), typeof e.spec?.definition === 'string' ? openApiOperations(e.spec.definition as string) : []] as const)), [items]);
  const openOf = (e: Entity) => (ops.get(stringifyEntityRef(e)) ?? []).filter(o => o.open).length;
  const shown = items
    .filter(e => filter === 'all' || (filter === 'noauth' ? openOf(e) > 0 : String(e.spec?.type ?? 'other') === filter))
    .filter(e => matches(q, e.metadata.name, e.metadata.title, e.metadata.description, String(e.spec?.system ?? ''), ...rel(e, 'apiProvidedBy'), ...rel(e, 'apiConsumedBy')))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  return (
    <PortalList
      title={t('page.apis')}
      sub={t('apis.sub')}
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[['all', t('cat.all'), items.length], ['noauth', t('apis.noAuth'), items.filter(e => openOf(e) > 0).length], ...types.map(ty => [ty, ty, items.filter(e => String(e.spec?.type ?? 'other') === ty).length] as [string, string, number])]}
    >
      {loading && <Progress />}
      {error && <WarningPanel title={t('list.noCatalog')} message={error} />}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
        {shown.map(e => {
          const by = rel(e, 'apiProvidedBy');
          const used = rel(e, 'apiConsumedBy');
          return (
            <Box key={stringifyEntityRef(e)} sx={cardSx}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <ApiIcon fontSize="small" sx={{ color: 'secondary.main' }} />
                <Link to={consoleEntityPath(e)}>
                  <Typography component="span" sx={{ fontWeight: 600 }}>
                    {titleOf(e)}
                  </Typography>
                </Link>
                <Box sx={{ flex: 1 }} />
                <Badge label={String(e.spec?.type ?? 'other')} outlined />
                {e.spec?.lifecycle && <Pill tone="neu" plain>{String(e.spec.lifecycle)}</Pill>}
              </Box>
              {(ops.get(stringifyEntityRef(e)) ?? []).length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'text.secondary' }}>
                  {t('api.ops', { n: (ops.get(stringifyEntityRef(e)) ?? []).length })}
                  {openOf(e) > 0 ? <Pill tone="warn">{t('api.open', { n: openOf(e) })}</Pill> : <Pill tone="pos">{t('apis.allAuth')}</Pill>}
                </Box>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {e.metadata.description ?? '—'}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {t('apis.providedBy')}{' '}
                </Box>
                {by.length ? by.join(', ') : '—'}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {t('apis.consumedBy')}{' '}
                </Box>
                {used.length ? `${used.slice(0, 4).join(', ')}${used.length > 4 ? ` ${t('apis.more', { n: used.length - 4 })}` : ''}` : t('apis.nobody')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" component={Link} to={`${consoleEntityPath(e)}/definition`} sx={{ px: 0 }}>
                  {t('apis.definition')}
                </Button>
                <Button size="small" component={Link} to={consoleEntityPath(e)} >
                  {t('nav.overview')}
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      {!loading && !shown.length && <Typography color="text.secondary">{t('apis.none')}</Typography>}
    </PortalList>
  );
};

type CheckRun = { entity: string; results: Array<{ check: { id: string; name?: string; description?: string }; result: unknown }> };

/** Portal › Quality: the Tech Insights checks of every component, worst first, and how each check is doing. */
type QRow = { e: Entity; results: CheckRun['results']; failed: CheckRun['results']; score?: number };
type QCheck = [string, { name: string; description?: string; pass: number; total: number }];

/** Quality as a matrix: one row per component, one cell per check (pass, fail, not run), its score, and what fails. */
const QualityMatrix = ({ rows, checks, all, passed, components, check, setCheck }: { rows: QRow[]; checks: QCheck[]; all: number; passed: number; components: number; check?: string; setCheck: (c?: string) => void }) => {
  const t = useRq();
  const { t: tr } = useI18n();
  const [open, setOpen] = useState<string | undefined>();
  const pct = all ? Math.round((passed / all) * 100) : 0;
  const state = (r: QRow, id: string): 'ok' | 'bad' | 'none' => {
    const x = r.results.find(y => y.check.id === id);
    if (!x) return 'none';
    return x.result === true ? 'ok' : 'bad';
  };
  const colour = { ok: t.positive, bad: t.negative, none: t.rule };
  const label = { ok: tr('q.ok'), bad: tr('q.fails'), none: tr('q.notRun') };
  return (
    <>
      <Section title={tr('q.matrix')} meta={tr('q.score', { pct, passed, all, n: components })} action={check ? <Button size="small" onClick={() => setCheck(undefined)}>{tr('q.showAll')}</Button> : undefined} flush>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th, & td': { borderBottom: `1px solid ${t.rule}` } }}>
          <thead>
            <tr>
              <Box component="th" sx={{ textAlign: 'left', fontSize: 12, fontWeight: 500, color: t.muted, px: 2.25, py: 1, verticalAlign: 'bottom' }}>
                {tr('q.component')}
              </Box>
              {checks.map(([id, c]) => (
                <Box component="th" key={id} title={c.description} sx={{ fontSize: 12, fontWeight: 500, color: check === id ? t.ink : t.muted, px: 0.5, py: 1, width: 64, lineHeight: '14px', verticalAlign: 'bottom', textAlign: 'center' }}>
                  <Box component="button" type="button" aria-pressed={check === id} onClick={() => setCheck(check === id ? undefined : id)} sx={{ all: 'unset', cursor: 'pointer', '&:focus-visible': { outline: `2px solid ${t.data}` } }}>
                    {c.name}
                  </Box>
                </Box>
              ))}
              <Box component="th" sx={{ fontSize: 12, fontWeight: 500, color: t.muted, px: 2, textAlign: 'right', verticalAlign: 'bottom' }}>
                {tr('q.pass')}
              </Box>
              <th aria-label={tr('q.detail')} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ref = stringifyEntityRef(r.e);
              const isOpen = open === ref;
              return (
                <Fragment key={ref}>
                  <tr>
                    <Box component="td" sx={{ px: 2.25, py: 1, minWidth: 200 }}>
                      <Link to={classify(r.e) === 'business' ? `${consoleEntityPath(r.e)}/quality` : consoleEntityPath(r.e)} style={{ fontWeight: 500 }}>
                        {titleOf(r.e)}
                      </Link>
                      <Box component="span" sx={{ display: 'block', fontSize: 12, color: t.muted }}>
                        {shortRef(r.e.spec?.owner as string)}
                      </Box>
                    </Box>
                    {checks.map(([id, c]) => {
                      const st = state(r, id);
                      return (
                        <Box component="td" key={id} sx={{ textAlign: 'center', px: 0.5 }}>
                          <Box component="span" role="img" aria-label={`${c.name}: ${label[st]}`} title={`${c.name}: ${label[st]}`} sx={{ display: 'inline-block', width: 14, height: 14, borderRadius: '4px', bgcolor: colour[st] }} />
                        </Box>
                      );
                    })}
                    <Box component="td" sx={{ textAlign: 'right', px: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {r.results.length - r.failed.length} / {r.results.length}
                    </Box>
                    <Box component="td" sx={{ pr: 2, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.failed.length > 0 ? (
                        <Button size="small" variant="outlined" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : ref)}>
                          {tr('q.failing', { n: r.failed.length })}
                        </Button>
                      ) : (
                        <Pill tone="pos">{tr('q.allPass')}</Pill>
                      )}
                    </Box>
                  </tr>
                  {isOpen && (
                    <tr>
                      <Box component="td" colSpan={checks.length + 3} sx={{ bgcolor: t.raised, px: 2.25, py: 1.5 }}>
                        <Box sx={{ fontSize: 12, color: t.muted, mb: 0.75 }}>{tr('q.whatFails')}</Box>
                        <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'grid', gap: 0.75 }}>
                          {r.failed.map(f => (
                            <li key={f.check.id}>
                              <b style={{ fontWeight: 500 }}>{f.check.name ?? f.check.id}</b>
                              {f.check.description && <Box component="span" sx={{ color: t.muted }}> · {f.check.description}</Box>}
                            </li>
                          ))}
                        </Box>
                      </Box>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Box>
      </Section>
      <Section title={tr('q.byCheck')} meta={tr('q.byCheckMeta')}>
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}>
          {checks.map(([id, c]) => {
            const sh = c.pass / c.total;
            let bar = t.negative;
            if (sh >= 0.9) bar = t.positive;
            else if (sh >= 0.6) bar = t.warning;
            return (
              <Box
                key={id}
                component="button"
                type="button"
                title={c.description}
                aria-pressed={check === id}
                onClick={() => setCheck(check === id ? undefined : id)}
                sx={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 0.5, p: 0.75, borderRadius: '6px', bgcolor: check === id ? t.active : undefined, '&:hover': { bgcolor: t.raised }, '&:focus-visible': { outline: `2px solid ${t.data}` } }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 14 }}>
                  <span>{c.name}</span>
                  <Box component="span" sx={{ color: t.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {c.pass}/{c.total}
                  </Box>
                </Box>
                <Box sx={{ height: 6, borderRadius: 3, bgcolor: t.rule, overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${sh * 100}%`, bgcolor: bar }} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Section>
    </>
  );
};

export const PortalQualityPage = () => {
  const { loading, items, error } = useEntities({ kind: 'component' }, ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels', 'spec.owner', 'spec.system']);
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [runs, setRuns] = useState<{ loading: boolean; value: Map<string, CheckRun['results']>; error?: string }>({ loading: true, value: new Map() });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [check, setCheck] = useState<string | undefined>();
  const { t } = useI18n();
  useEffect(() => {
    if (loading || !items.length) return undefined;
    let alive = true;
    (async () => {
      const base = await discovery.getBaseUrl('tech-insights');
      const r = await fetch(`${base}/checks/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entities: items.map(e => stringifyEntityRef(e)) }),
      });
      if (!r.ok) throw new Error(`Tech Insights answered ${r.status}`);
      return (await r.json()) as CheckRun[];
    })().then(
      list => alive && setRuns({ loading: false, value: new Map(list.map(x => [x.entity, x.results])) }),
      e => alive && setRuns({ loading: false, value: new Map(), error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [loading, items, discovery, fetch]);

  const rows = items
    .map(e => {
      const results = runs.value.get(stringifyEntityRef(e)) ?? [];
      const failed = results.filter(r => r.result !== true);
      return { e, results, failed, score: results.length ? (results.length - failed.length) / results.length : undefined };
    })
    .filter(r => r.results.length);
  const checks = useMemo(() => {
    const m = new Map<string, { name: string; description?: string; pass: number; total: number }>();
    for (const r of rows)
      for (const x of r.results) {
        const c = m.get(x.check.id) ?? { name: x.check.name ?? x.check.id, description: x.check.description, pass: 0, total: 0 };
        m.set(x.check.id, { ...c, pass: c.pass + (x.result === true ? 1 : 0), total: c.total + 1 });
      }
    return [...m.entries()].sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.value, items]);
  const shown = rows
    .filter(r => filter === 'all' || classify(r.e) === filter)
    .filter(r => !check || r.failed.some(f => f.check.id === check))
    .filter(r => matches(q, r.e.metadata.name, r.e.metadata.title, shortRef(r.e.spec?.owner as string)))
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1) || titleOf(a.e).localeCompare(titleOf(b.e)));
  const all = rows.reduce((sum, r) => sum + r.results.length, 0);
  const passed = rows.reduce((sum, r) => sum + r.results.length - r.failed.length, 0);
  return (
    <PortalList
      title={t('page.quality')}
      sub={t('q.sub')}
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[
        ['all', t('cat.all'), rows.length],
        ['business', t('cat.businessApps'), rows.filter(r => classify(r.e) === 'business').length],
        ['service', t('cat.services'), rows.filter(r => classify(r.e) === 'service').length],
      ]}
    >
      {(loading || runs.loading) && <Progress />}
      {(error || runs.error) && <WarningPanel title={t('q.noChecks')} message={error ?? runs.error} />}
      {rows.length > 0 && (
        <QualityMatrix rows={shown} checks={checks} all={all} passed={passed} components={rows.length} check={check} setCheck={setCheck} />
      )}
    </PortalList>
  );
};

const KIND_LABEL: Record<string, string> = { system: 'systems', component: 'components', api: 'APIs', resource: 'resources', domain: 'domains', template: 'templates' };

/**
 * Support › Resolution groups: the teams of the catalog that answer for something (they own systems, components,
 * APIs…), who is in them and what they own. A group opens its page inside the console.
 */
export const ResolutionGroupsPage = () => {
  const { t } = useI18n();
  const { loading, items, error } = useEntities({ kind: 'group' }, ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.description', 'spec.profile', 'spec.parent', 'relations']);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const groups = items
    .map(e => {
      const owns = (e.relations ?? []).filter(r => r.type === 'ownerOf').map(r => parseEntityRef(r.targetRef));
      const members = (e.relations ?? []).filter(r => r.type === 'hasMember').map(r => parseEntityRef(r.targetRef).name);
      return { e, owns, members };
    });
  const shown = groups
    .filter(g => filter === 'all' || (filter === 'owners' ? g.owns.length > 0 : g.owns.length === 0))
    .filter(g => matches(q, g.e.metadata.name, g.e.metadata.title, g.e.metadata.description, ...g.members, ...g.owns.map(o => o.name)))
    .sort((a, b) => b.owns.length - a.owns.length || titleOf(a.e).localeCompare(titleOf(b.e)));
  return (
    <PortalList
      title={t('nav.resolutionGroups')}
      sub={t('groups.sub')}
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[
        ['all', 'All', groups.length],
        ['owners', t('groups.owners'), groups.filter(g => g.owns.length).length],
        ['others', t('groups.others'), groups.filter(g => !g.owns.length).length],
      ]}
    >
      {loading && <Progress />}
      {error && <WarningPanel title={t('list.noCatalog')} message={error} />}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(330px, 100%), 1fr))' }}>
        {shown.map(({ e, owns, members }) => {
          const byKind = Object.entries(
            owns.reduce<Record<string, number>>((m, o) => {
              const k = o.kind.toLowerCase();
              return { ...m, [k]: (m[k] ?? 0) + 1 };
            }, {}),
          ).sort((a, b) => b[1] - a[1]);
          const systems = owns.filter(o => o.kind.toLowerCase() === 'system').map(o => o.name);
          const profile = (e.spec?.profile ?? {}) as { displayName?: string; email?: string };
          return (
            <Box key={stringifyEntityRef(e)} component={Link} to={consoleEntityPath(e)} sx={cardSx}>
              <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
                <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: rq.svc.bg, color: rq.svc.fg, fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                  {(profile.displayName ?? e.metadata.title ?? e.metadata.name).charAt(0).toUpperCase()}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.displayName ?? titleOf(e)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {members.length ? t(members.length === 1 ? 'groups.member' : 'groups.members', { n: members.length }) : t('groups.noMembers')}
                    {profile.email ? ` · ${profile.email}` : ''}
                  </Typography>
                </Box>
              </Box>
              {e.metadata.description && (
                <Typography variant="body2" color="text.secondary">
                  {e.metadata.description}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {byKind.map(([k, n]) => (
                  <Badge key={k} label={`${n} ${KIND_LABEL[k] ?? k}`} outlined />
                ))}
                {!byKind.length && <Badge label="owns nothing yet" />}
              </Box>
              {systems.length > 0 && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Systems{' '}
                  </Box>
                  {systems.slice(0, 5).join(', ')}
                  {systems.length > 5 ? ` and ${systems.length - 5} more` : ''}
                </Typography>
              )}
              {members.length > 0 && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Members{' '}
                  </Box>
                  {members.slice(0, 5).join(', ')}
                  {members.length > 5 ? ` and ${members.length - 5} more` : ''}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
      {!loading && !shown.length && <Typography color="text.secondary">{t('groups.none')}</Typography>}
    </PortalList>
  );
};
