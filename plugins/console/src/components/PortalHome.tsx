import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { identityApiRef, useApi, useApiHolder } from '@backstage/core-plugin-api';
import { catalogApiRef, starredEntitiesApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useConsoleConfig } from '../config';
import { type AppOverview, useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { classify, consoleEntityPath } from './classify';
import { healthColour } from './ClusterOverviewPage';
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

const Kpi = ({ label, value, color }: { label: string; value: number; color?: string }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 30, fontWeight: 600, color }}>{value}</Typography>
  </Paper>
);

const EntityList = ({
  title,
  items,
  palette,
  health,
  empty = 'None in this cluster.',
}: {
  title: string;
  items: Entity[];
  palette: { bg: string; fg: string };
  health: Map<string, AppOverview>;
  empty?: string;
}) => (
  <Paper variant="outlined" component="section" sx={{ borderRadius: 2, overflow: 'hidden' }}>
    <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
      <Badge label={title} bg={palette.bg} fg={palette.fg} />
      <Typography variant="body2" color="text.secondary">
        {items.length}
      </Typography>
    </Box>
    {items.length === 0 && (
      <Typography sx={{ p: 2 }} color="text.secondary">
        {empty}
      </Typography>
    )}
    {items.map(e => {
      const ann = e.metadata.annotations ?? {};
      const stage = ann['refresquito.io/stage'];
      const segment = e.metadata.labels?.['refresquito.io/segment'];
      const suspended = ann['refresquito.io/suspended'] === 'true';
      const app = health.get(e.metadata.name);
      return (
        <Box key={stringifyEntityRef(e)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
          <Link to={consoleEntityPath(e)} underline="none" style={{ fontWeight: 600, color: palette.fg, minWidth: 0 }}>
            {e.metadata.title ?? e.metadata.name}
          </Link>
          <Box sx={{ flex: 1 }} />
          {app && app.health !== 'Healthy' && <Badge label={app.health} {...healthColour(app.health)} />}
          {stage && <Badge outlined label={stage} />}
          {segment && <Badge outlined label={segment} />}
          {suspended && <Badge label="suspended" bg="#FFF3E0" fg="#B45F06" />}
        </Box>
      );
    })}
  </Paper>
);

/** Portal layer: the software of this cluster, business applications apart from Refresquito services. */
export const PortalHome = () => {
  const cfg = useConsoleConfig();
  const { loading, items, apis, error } = useComponents();
  const ov = useClusterOverview();
  const mine = useOwnership();
  const starred = useStarred();
  const [text, setText] = useState('');
  const health = useMemo(() => new Map((ov.data?.apps ?? []).map(a => [a.name, a] as const)), [ov.data]);
  if (loading) return <Progress />;
  const t = text.trim().toLowerCase();
  const match = (e: Entity) =>
    !t || e.metadata.name.toLowerCase().includes(t) || (e.metadata.title ?? '').toLowerCase().includes(t) || (e.metadata.labels?.['refresquito.io/segment'] ?? '').includes(t);
  const byName = (a: Entity, b: Entity) => a.metadata.name.localeCompare(b.metadata.name);
  const shown = items.filter(match).sort(byName);
  const business = shown.filter(e => classify(e) === 'business');
  const services = shown.filter(e => classify(e) === 'service');
  const owned = shown.filter(e => {
    const o = ownerRef((e.spec as { owner?: string } | undefined)?.owner);
    return !!o && mine.has(o);
  });
  const favourites = shown.filter(e => starred.has(stringifyEntityRef(e)));
  const where = [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join(' / ');
  const neutral = { bg: '#EEF1F4', fg: '#14202E' };
  return (
    <Box sx={{ display: 'grid', gap: 3, maxWidth: 1240 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Portal of {cfg.cluster.id}
        </Typography>
        <Typography color="text.secondary">
          {where ? `${where} · ` : ''}the same catalog as the classic portal, grouped by what each component is.
        </Typography>
      </Box>
      {error && <WarningPanel title="The catalog did not answer" message={error} />}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Kpi label="Business applications" value={items.filter(e => classify(e) === 'business').length} color={rq.biz.fg} />
        <Kpi label="Refresquito services" value={items.filter(e => classify(e) === 'service').length} color={rq.svc.fg} />
        <Kpi label="APIs" value={apis} />
        <Kpi label="Components" value={items.length} />
      </Box>
      <NeedsAttention limit={5} />
      <TextField size="small" label="Filter by name, title or segment" value={text} onChange={e => setText(e.target.value)} sx={{ maxWidth: 420 }} />
      {(owned.length > 0 || favourites.length > 0) && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'start' }}>
          <EntityList title="Owned by your groups" items={owned} palette={neutral} health={health} empty="Nothing owned by your groups." />
          <EntityList title="Your favourites" items={favourites} palette={neutral} health={health} empty="Star an entity on its page to keep it here." />
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'start' }}>
        <EntityList title="Business applications" items={business} palette={rq.biz} health={health} />
        <EntityList title="Refresquito services" items={services} palette={rq.svc} health={health} />
      </Box>
    </Box>
  );
};
