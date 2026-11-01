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
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge } from './Badge';
import { classify, consoleEntityPath } from './classify';
import { TONES } from './Flow';
import { rq } from './tokens';

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
}) => (
  <Box sx={{ display: 'grid', gap: 2 }}>
    <Box>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, fontSize: 28 }}>
        {title}
      </Typography>
      <Typography color="text.secondary">{sub}</Typography>
    </Box>
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField size="small" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} inputProps={{ 'aria-label': `Search ${title}` }} sx={{ minWidth: 260 }} />
      {filters.map(([id, label, n]) => (
        <Button
          key={id}
          size="small"
          variant={filter === id ? 'contained' : 'outlined'}
          disableElevation
          aria-pressed={filter === id}
          onClick={() => setFilter(id)}
          sx={{ textTransform: 'none', borderRadius: 999 }}
        >
          {label} · {n}
        </Button>
      ))}
    </Box>
    {children}
  </Box>
);

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
  borderRadius: '12px',
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
      title="Docs"
      sub="The documentation of every system, application and service, read inside the console."
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[
        ['all', 'All', count('all')],
        ['system', 'Systems', count('system')],
        ['business', 'Business applications', items.filter(e => e.kind !== 'System' && classify(e) === 'business').length],
        ['service', 'Refresquito services', items.filter(e => e.kind !== 'System' && classify(e) === 'service').length],
      ]}
    >
      {loading && <Progress />}
      {error && <WarningPanel title="The catalog could not be read" message={error} />}
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
      {!loading && !shown.length && <Typography color="text.secondary">No documentation matches.</Typography>}
    </PortalList>
  );
};

/** Portal › APIs: every API of the catalog, who provides it and who consumes it. */
export const PortalApisPage = () => {
  const { loading, items, error } = useEntities({ kind: 'api' });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const types = useMemo(() => [...new Set(items.map(e => String(e.spec?.type ?? 'other')))].sort(), [items]);
  const rel = (e: Entity, type: string) => (e.relations ?? []).filter(r => r.type === type).map(r => shortRef(r.targetRef));
  const shown = items
    .filter(e => filter === 'all' || String(e.spec?.type ?? 'other') === filter)
    .filter(e => matches(q, e.metadata.name, e.metadata.title, e.metadata.description, String(e.spec?.system ?? ''), ...rel(e, 'apiProvidedBy'), ...rel(e, 'apiConsumedBy')))
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  return (
    <PortalList
      title="APIs"
      sub="The APIs of the cluster: what each one is, who provides it and who consumes it."
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[['all', 'All', items.length], ...types.map(t => [t, t, items.filter(e => String(e.spec?.type ?? 'other') === t).length] as [string, string, number])]}
    >
      {loading && <Progress />}
      {error && <WarningPanel title="The catalog could not be read" message={error} />}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
        {shown.map(e => {
          const by = rel(e, 'apiProvidedBy');
          const used = rel(e, 'apiConsumedBy');
          return (
            <Box key={stringifyEntityRef(e)} sx={cardSx}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <ApiIcon fontSize="small" sx={{ color: rq.primary }} />
                <Link to={consoleEntityPath(e)}>
                  <Typography component="span" sx={{ fontWeight: 600 }}>
                    {titleOf(e)}
                  </Typography>
                </Link>
                <Box sx={{ flex: 1 }} />
                <Badge label={String(e.spec?.type ?? 'other')} outlined />
                {e.spec?.lifecycle && <Badge label={String(e.spec.lifecycle)} bg={TONES.info.bg} fg={TONES.info.fg} />}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {e.metadata.description ?? '—'}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  Provided by{' '}
                </Box>
                {by.length ? by.join(', ') : '—'}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  Consumed by{' '}
                </Box>
                {used.length ? `${used.slice(0, 4).join(', ')}${used.length > 4 ? ` and ${used.length - 4} more` : ''}` : 'nobody yet'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" component={Link} to={`${consoleEntityPath(e)}/definition`} sx={{ textTransform: 'none', px: 0 }}>
                  Definition
                </Button>
                <Button size="small" component={Link} to={consoleEntityPath(e)} sx={{ textTransform: 'none' }}>
                  Overview
                </Button>
              </Box>
            </Box>
          );
        })}
      </Box>
      {!loading && !shown.length && <Typography color="text.secondary">No API matches.</Typography>}
    </PortalList>
  );
};

type CheckRun = { entity: string; results: Array<{ check: { id: string; name?: string; description?: string }; result: unknown }> };

/** Portal › Quality: the Tech Insights checks of every component, worst first, and how each check is doing. */
export const PortalQualityPage = () => {
  const { loading, items, error } = useEntities({ kind: 'component' }, ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels', 'spec.owner', 'spec.system']);
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [runs, setRuns] = useState<{ loading: boolean; value: Map<string, CheckRun['results']>; error?: string }>({ loading: true, value: new Map() });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [check, setCheck] = useState<string | undefined>();
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
  const all = rows.reduce((t, r) => t + r.results.length, 0);
  const passed = rows.reduce((t, r) => t + r.results.length - r.failed.length, 0);
  const tone = (s?: number) => {
    if (s === undefined) return TONES.off;
    if (s >= 0.9) return TONES.ok;
    return s >= 0.6 ? TONES.warn : TONES.bad;
  };
  return (
    <PortalList
      title="Quality"
      sub="The checks of every component (Tech Insights): the ones that need work first. Click a check to see who fails it."
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[
        ['all', 'All', rows.length],
        ['business', 'Business applications', rows.filter(r => classify(r.e) === 'business').length],
        ['service', 'Refresquito services', rows.filter(r => classify(r.e) === 'service').length],
      ]}
    >
      {(loading || runs.loading) && <Progress />}
      {(error || runs.error) && <WarningPanel title="The checks could not be read" message={error ?? runs.error} />}
      {rows.length > 0 && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '340px minmax(0, 1fr)' }, alignItems: 'start' }}>
          <Box sx={{ ...cardSx, '&:hover': undefined }}>
            <Typography variant="overline" color="text.secondary">
              Checks
            </Typography>
            <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone(all ? passed / all : undefined).fg }}>{all ? Math.round((passed / all) * 100) : 0} %</Typography>
            <Typography variant="caption" color="text.secondary">
              {passed} of {all} checks pass in {rows.length} components
            </Typography>
            {checks.map(([id, c]) => {
              const s = c.pass / c.total;
              return (
                <Box
                  key={id}
                  component="button"
                  type="button"
                  title={c.description}
                  aria-pressed={check === id}
                  onClick={() => setCheck(check === id ? undefined : id)}
                  sx={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 0.5, p: 0.75, borderRadius: '8px', bgcolor: check === id ? 'action.selected' : undefined, '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 14 }}>
                    <span>{c.name}</span>
                    <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                      {c.pass}/{c.total}
                    </Box>
                  </Box>
                  <Box sx={{ height: 6, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${s * 100}%`, bgcolor: tone(s).fg }} />
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {check && (
              <Typography variant="body2">
                Failing <b>{checks.find(([id]) => id === check)?.[1].name}</b> ·{' '}
                <Button size="small" onClick={() => setCheck(undefined)} sx={{ textTransform: 'none', p: 0, minWidth: 0 }}>
                  show all
                </Button>
              </Typography>
            )}
            {shown.map(r => {
              const t = tone(r.score);
              return (
                <Box key={stringifyEntityRef(r.e)} sx={{ ...cardSx, gridTemplateColumns: '64px minmax(0, 1fr)', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 56, height: 56, borderRadius: '14px', display: 'grid', placeItems: 'center', bgcolor: t.bg, color: t.fg, fontWeight: 700, fontSize: 17 }}>
                    {r.results.length - r.failed.length}/{r.results.length}
                  </Box>
                  <Box sx={{ display: 'grid', gap: 0.5, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Link to={classify(r.e) === 'business' ? `${consoleEntityPath(r.e)}/quality` : consoleEntityPath(r.e)}>
                        <Typography component="span" sx={{ fontWeight: 600 }}>
                          {titleOf(r.e)}
                        </Typography>
                      </Link>
                      {kindBadge(r.e)}
                      {r.e.spec?.owner && (
                        <Typography variant="caption" color="text.secondary">
                          {shortRef(r.e.spec.owner as string)}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {r.failed.length === 0 ? (
                        <Typography variant="caption" sx={{ color: TONES.ok.fg }}>
                          Every check passes
                        </Typography>
                      ) : (
                        r.failed.map(f => <Badge key={f.check.id} label={f.check.name ?? f.check.id} bg={TONES.bad.bg} fg={TONES.bad.fg} />)
                      )}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
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
      title="Resolution groups"
      sub="Every group of the catalog: what each one owns and who is in it. Incidents on an element go to the group that owns it."
      q={q}
      setQ={setQ}
      filter={filter}
      setFilter={setFilter}
      filters={[
        ['all', 'All', groups.length],
        ['owners', 'Own elements', groups.filter(g => g.owns.length).length],
        ['others', 'Own nothing yet', groups.filter(g => !g.owns.length).length],
      ]}
    >
      {loading && <Progress />}
      {error && <WarningPanel title="The catalog could not be read" message={error} />}
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
                <Box sx={{ width: 38, height: 38, borderRadius: '11px', display: 'grid', placeItems: 'center', bgcolor: rq.svc.bg, color: rq.svc.fg, fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                  {(profile.displayName ?? e.metadata.title ?? e.metadata.name).charAt(0).toUpperCase()}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.displayName ?? titleOf(e)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {members.length ? `${members.length} ${members.length === 1 ? 'member' : 'members'}` : 'no members in the catalog'}
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
      {!loading && !shown.length && <Typography color="text.secondary">No group matches.</Typography>}
    </PortalList>
  );
};
