import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { identityApiRef, useApi, useApiHolder } from '@backstage/core-plugin-api';
import { catalogApiRef, starredEntitiesApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import HubIcon from '@mui/icons-material/Hub';
import StorefrontIcon from '@mui/icons-material/Storefront';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useConsoleConfig } from '../config';
import { type AppOverview, useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { classify, consoleEntityPath } from './classify';
import { TONES } from './Flow';
import { NeedsAttention } from './NeedsAttention';
import { useI18n } from '../i18n';
import { useRq } from '../theme/consoleTheme';
import { Kpis, TitleRow } from './ui';
import { Seg } from './ui-portal';

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

const HEALTH_DOT: Record<string, string> = { Healthy: TONES.ok.fg, Progressing: TONES.info.fg, Degraded: TONES.bad.fg, Missing: TONES.bad.fg, Suspended: TONES.off.fg };

/** One component of the catalogue: what it is (icon), its name, owner and system, and its state in Argo CD. */
const EntityCard = ({ e, app }: { e: Entity; app?: AppOverview }) => {
  const t = useRq();
  const { t: tr } = useI18n();
  const ann = e.metadata.annotations ?? {};
  const sp = (e.spec ?? {}) as { owner?: string; system?: string; lifecycle?: string };
  const business = classify(e) === 'business';
  const Icon = business ? StorefrontIcon : HubIcon;
  const suspended = ann['refresquito.io/suspended'] === 'true';
  let state = app ? app.health : tr('cat.notInArgo');
  if (suspended) state = tr('cat.suspended');
  const dot = suspended ? TONES.off.fg : HEALTH_DOT[app?.health ?? ''] ?? TONES.off.fg;
  return (
    <Box
      component={Link}
      to={consoleEntityPath(e)}
      sx={{ display: 'grid', gap: 1, alignContent: 'start', border: `1px solid ${t.border}`, borderRadius: '8px', p: 1.75, bgcolor: t.sheet, color: t.ink, textDecoration: 'none', minWidth: 0, transition: 'border-color .15s ease-out', '&:hover': { borderColor: t.control } }}
    >
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', minWidth: 0 }}>
        <Box aria-hidden sx={{ width: 32, height: 32, borderRadius: '6px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: business ? t.pos.bg : t.info.bg, color: business ? t.pos.fg : t.info.fg }}>
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{e.metadata.title ?? e.metadata.name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
            {[business ? tr('cat.business') : tr('cat.service'), sp.owner?.replace(/^group:(default\/)?/, '')].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
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
  const { t: tr } = useI18n();
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
  // problems first (not healthy in Argo CD), then business applications, then by name
  const bad = (e: Entity) => {
    const h = health.get(e.metadata.name)?.health;
    return h && h !== 'Healthy' ? 0 : 1;
  };
  const shown = items.filter(e => match(e) && keep[filter](e)).sort((a, b) => {
    const ca = classify(a) === 'business' ? 0 : 1;
    const cb = classify(b) === 'business' ? 0 : 1;
    return bad(a) - bad(b) || ca - cb || a.metadata.name.localeCompare(b.metadata.name);
  });
  const where = [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join(' / ');
  const chips: Array<[Filter, string, number]> = [
    ['all', tr('cat.all'), counts.all],
    ['business', tr('cat.businessApps'), counts.business],
    ['service', tr('cat.services'), counts.service],
    ['mine', tr('cat.mine'), counts.mine],
    ['favourites', tr('cat.favourites'), counts.favourites],
  ];
  return (
    <Box>
      <TitleRow
        crumbs={[[tr('nav.portal'), '/console'], [tr('nav.catalogue')]]}
        title={tr('nav.catalogue')}
        sub={tr('cat.sub', { where: where ? `${where} · ` : '', cluster: cfg.cluster.id })}
      />
      {error && <WarningPanel title={tr('cat.noCatalog')} message={error} />}
      <Kpis
        items={[
          { label: tr('cat.businessApps'), value: counts.business },
          { label: tr('cat.services'), value: counts.service },
          { label: tr('cat.apis'), value: apis },
          { label: tr('cat.mine'), value: counts.mine },
        ]}
      />
      <NeedsAttention limit={5} />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', my: 2 }}>
        <TextField size="small" placeholder={tr('cat.search')} value={text} onChange={e => setText(e.target.value)} inputProps={{ 'aria-label': tr('cat.searchLabel') }} sx={{ flex: '1 1 260px', maxWidth: 420 }} />
        <Seg label={tr('cat.show')} items={chips} value={filter} onChange={setFilter} />
      </Box>
      {shown.length === 0 ? (
        <Typography color="text.secondary">{filter === 'favourites' ? tr('cat.noFavourites') : tr('cat.nothing')}</Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}>
          {shown.map(e => (
            <EntityCard key={stringifyEntityRef(e)} e={e} app={health.get(e.metadata.name)} />
          ))}
        </Box>
      )}
    </Box>
  );
};
