import type { Entity } from '@backstage/catalog-model';
import { Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { classicUrl, useConsoleConfig } from '../config';
import { classify, entityPath } from './classify';
import { rq } from './tokens';

const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels', 'metadata.tags', 'spec.lifecycle', 'spec.system'];

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

const Kpi = ({ label, value, color }: { label: string; value: number; color?: string }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 30, fontWeight: 600, color }}>{value}</Typography>
  </Paper>
);

const EntityList = ({ title, items, palette }: { title: string; items: Entity[]; palette: { bg: string; fg: string } }) => {
  const cfg = useConsoleConfig();
  return (
    <Paper variant="outlined" component="section" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip size="small" label={title} sx={{ bgcolor: palette.bg, color: palette.fg, fontWeight: 600 }} />
        <Typography variant="body2" color="text.secondary">
          {items.length}
        </Typography>
      </Box>
      {items.length === 0 && (
        <Typography sx={{ p: 2 }} color="text.secondary">
          None in this cluster.
        </Typography>
      )}
      {items.map(e => {
        const ann = e.metadata.annotations ?? {};
        const stage = ann['refresquito.io/stage'];
        const segment = e.metadata.labels?.['refresquito.io/segment'];
        const suspended = ann['refresquito.io/suspended'] === 'true';
        return (
          <Box
            key={e.metadata.name}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
          >
            {/* the detail of the console comes in phase 1; until then, the classic page of the entity */}
            <a href={classicUrl(cfg, entityPath(e))} style={{ fontWeight: 600, color: palette.fg, minWidth: 0 }}>
              {e.metadata.title ?? e.metadata.name}
            </a>
            <Box sx={{ flex: 1 }} />
            {stage && <Chip size="small" variant="outlined" label={stage} />}
            {segment && <Chip size="small" variant="outlined" label={segment} />}
            {suspended && <Chip size="small" label="suspended" color="warning" />}
          </Box>
        );
      })}
    </Paper>
  );
};

/** Portal layer: the software of this cluster, business applications apart from Refresquito services. */
export const PortalHome = () => {
  const cfg = useConsoleConfig();
  const { loading, items, apis, error } = useComponents();
  if (loading) return <Progress />;
  const byName = (a: Entity, b: Entity) => a.metadata.name.localeCompare(b.metadata.name);
  const business = items.filter(e => classify(e) === 'business').sort(byName);
  const services = items.filter(e => classify(e) === 'service').sort(byName);
  const where = [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join(' / ');
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
        <Kpi label="Business applications" value={business.length} color={rq.biz.fg} />
        <Kpi label="Refresquito services" value={services.length} color={rq.svc.fg} />
        <Kpi label="APIs" value={apis} />
        <Kpi label="Components" value={items.length} />
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'start' }}>
        <EntityList title="Business applications" items={business} palette={rq.biz} />
        <EntityList title="Refresquito services" items={services} palette={rq.svc} />
      </Box>
    </Box>
  );
};
