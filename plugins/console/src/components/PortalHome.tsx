import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { identityApiRef, useApi, useApiHolder } from '@backstage/core-plugin-api';
import { catalogApiRef, starredEntitiesApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import type { SvgIconComponent } from '@mui/icons-material';
import ApiIcon from '@mui/icons-material/Api';
import GroupsIcon from '@mui/icons-material/Groups';
import HubIcon from '@mui/icons-material/Hub';
import StorefrontIcon from '@mui/icons-material/Storefront';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useConsoleConfig } from '../config';
import { type AppOverview, useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { classify, consoleEntityPath } from './classify';
import { TONES } from './Flow';
import { NeedsAttention } from './NeedsAttention';
import { rq } from './tokens';

const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels', 'metadata.tags', 'spec.lifecycle', 'spec.system', 'spec.owner'];

function useComponents() {
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<{ loading: boolean; items: Entity[]; apis: number; error?: string }>({ loading: true, items: [], apis: 0 });
  useEffect(() => {
    let alive = true;
    Promise.all([
      catalog.getEntities({ filter: { kind: 'component' }, fields: FIELDS }),
      catalog.getEntities({ filter: { kind: 'api' }, fields: ['metadata.name'] }),
    ]).then(
      ([c, a]) => alive && setState({ loading: false, items: c.items, apis: a.items.length }),
      e => alive && setState({ loading: false, items: [], apis: 0, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return state;
}

/** The groups (and the user) the signed-in user owns through, as entity refs. */
function useOwnership() {
  const identity = useApi(identityApiRef);
  const [refs, setRefs] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    identity.getBackstageIdentity().then(
      id => alive && setRefs(new Set(id.ownershipEntityRefs.map(r => r.toLowerCase()))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [identity]);
  return refs;
}

/** The entities starred in the portal (the same stars as the classic pages), when the app has that API. */
function useStarred() {
  const api = useApiHolder().get(starredEntitiesApiRef);
  const [refs, setRefs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!api) return undefined;
    const sub = api.starredEntitie$().subscribe({ next: s => setRefs(new Set(s)) });
    return () => sub.unsubscribe();
  }, [api]);
  return refs;
}

export const ownerRef = (owner?: string) => {
  if (!owner) return undefined;
  const o = owner.toLowerCase();
  if (o.includes(':')) return o.includes('/') ? o : o.replace(':', ':default/');
  return `group:default/${o}`;
};

const Kpi = ({ label, value, Icon }: { label: string; value: number; Icon: SvgIconComponent }) => (
  <Paper variant="outlined" sx={{ p: 1.75, borderRadius: '12px', display: 'flex', gap: 1.5, alignItems: 'center' }}>
    <Box aria-hidden sx={{ width: 38, height: 38, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: 'rgba(26,141,255,0.10)', color: rq.blue }}>
      <Icon />
    </Box>
    <Box>
      <Typography sx={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  </Paper>
);

const HEALTH_DOT: Record<string, string> = { Healthy: TONES.ok.fg, Progressing: TONES.info.fg, Degraded: TONES.bad.fg, Missing: TONES.bad.fg, Suspended: TONES.off.fg };

/** One component of the catalogue: what it is (icon), its name, owner and system, and its state in Argo CD. */
const EntityCard = ({ e, app }: { e: Entity; app?: AppOverview }) => {
  const ann = e.metadata.annotations ?? {};
  const sp = (e.spec ?? {}) as { owner?: string; system?: string; lifecycle?: string };
  const business = classify(e) === 'business';
  const Icon = business ? StorefrontIcon : HubIcon;
  const suspended = ann['refresquito.io/suspended'] === 'true';
  let state = app ? app.health : 'not in Argo CD';
  if (suspended) state = 'suspended';
  const dot = suspended ? TONES.off.fg : HEALTH_DOT[app?.health ?? ''] ?? TONES.off.fg;
  return (
    <Box
      component={Link}
      to={consoleEntityPath(e)}
      sx={{ display: 'grid', gap: 0.75, border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.5, bgcolor: 'background.paper', color: 'text.primary', textDecoration: 'none', minWidth: 0, '&:hover': { borderColor: rq.blue } }}
    >
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', minWidth: 0 }}>
        <Box aria-hidden sx={{ width: 34, height: 34, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: 'action.hover', color: 'text.secondary' }}>
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.metadata.title ?? e.metadata.name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[business ? 'business application' : 'Refresquito service', sp.owner?.replace(/^group:(default\/)?/, '')].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
          <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot }} />
          {state}
        </Box>
        {ann['refresquito.io/stage'] && <Badge outlined label={ann['refresquito.io/stage']} />}
        {e.metadata.labels?.['refresquito.io/segment'] && <Badge outlined label={e.metadata.labels['refresquito.io/segment']} />}
      </Box>
    </Box>
  );
};

type Filter = 'all' | 'business' | 'service' | 'mine' | 'favourites';

/** Portal › Catalogue: the software of this cluster, as cards, filtered by what it is or whose it is. */
export const PortalHome = () => {
  const cfg = useConsoleConfig();
  const { loading, items, apis, error } = useComponents();
  const ov = useClusterOverview();
  const mine = useOwnership();
  const starred = useStarred();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const health = useMemo(() => new Map((ov.data?.apps ?? []).map(a => [a.name, a] as const)), [ov.data]);
  if (loading) return <Progress />;
  const t = text.trim().toLowerCase();
  const match = (e: Entity) =>
    !t || e.metadata.name.toLowerCase().includes(t) || (e.metadata.title ?? '').toLowerCase().includes(t) || (e.metadata.labels?.['refresquito.io/segment'] ?? '').includes(t);
  const owns = (e: Entity) => {
    const o = ownerRef((e.spec as { owner?: string } | undefined)?.owner);
    return !!o && mine.has(o);
  };
  const keep: Record<Filter, (e: Entity) => boolean> = {
    all: () => true,
    business: e => classify(e) === 'business',
    service: e => classify(e) === 'service',
    mine: owns,
    favourites: e => starred.has(stringifyEntityRef(e)),
  };
  const counts = Object.fromEntries((Object.keys(keep) as Filter[]).map(f => [f, items.filter(keep[f]).length])) as Record<Filter, number>;
  const shown = items.filter(e => match(e) && keep[filter](e)).sort((a, b) => {
    // business applications first, then by name
    const ca = classify(a) === 'business' ? 0 : 1;
    const cb = classify(b) === 'business' ? 0 : 1;
    return ca - cb || a.metadata.name.localeCompare(b.metadata.name);
  });
  const where = [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join(' / ');
  const chips: Array<[Filter, string]> = [
    ['all', 'All'],
    ['business', 'Business applications'],
    ['service', 'Refresquito services'],
    ['mine', 'Owned by your groups'],
    ['favourites', 'Favourites'],
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Catalogue
        </Typography>
        <Typography color="text.secondary">{where ? `${where} · ` : ''}the business applications and Refresquito services of {cfg.cluster.id}.</Typography>
      </Box>
      {error && <WarningPanel title="The catalog did not answer" message={error} />}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
        <Kpi label="Business applications" value={counts.business} Icon={StorefrontIcon} />
        <Kpi label="Refresquito services" value={counts.service} Icon={HubIcon} />
        <Kpi label="APIs" value={apis} Icon={ApiIcon} />
        <Kpi label="Owned by your groups" value={counts.mine} Icon={GroupsIcon} />
      </Box>
      <NeedsAttention limit={5} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" placeholder="Search by name, title or segment" value={text} onChange={e => setText(e.target.value)} inputProps={{ 'aria-label': 'Search the catalogue' }} sx={{ flex: '1 1 260px', maxWidth: 420 }} />
        <Box role="group" aria-label="Show" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {chips.map(([f, label]) => (
            <Chip key={f} label={`${label} ${counts[f]}`} onClick={() => setFilter(f)} color={filter === f ? 'primary' : 'default'} variant={filter === f ? 'filled' : 'outlined'} aria-pressed={filter === f} />
          ))}
        </Box>
      </Box>
      {shown.length === 0 ? (
        <Typography color="text.secondary">{filter === 'favourites' ? 'Star an entity on its page to keep it here.' : 'Nothing matches.'}</Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
          {shown.map(e => (
            <EntityCard key={stringifyEntityRef(e)} e={e} app={health.get(e.metadata.name)} />
          ))}
        </Box>
      )}
    </Box>
  );
};
