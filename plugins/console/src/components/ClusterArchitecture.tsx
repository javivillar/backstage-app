import { Link } from '@backstage/core-components';
import type { Entity } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { identityHost, useClusterNetwork } from '../network';
import type { ClusterOverview, NodeOverview } from '../overview';
import { MONO } from '../theme/consoleTheme';
import { ARCH_BANDS, type ArchBand, type ArchTile, BAND_CODE, clusterBands, monogram } from './clusterArchModel';
import { type Health, LAYER_INFO } from './depsModel';
import { useArchColours } from './PlatformArchitecture';
import { choose } from './ui';

/**
 * Cluster › Overview › Architecture: what is deployed in this cluster, grouped by the bands of the Catalogue from the
 * business applications down to the infrastructure, every piece with its namespace and the state of its Argo CD
 * application. On top the way in (VIP → Traefik → Keycloak → segments), at the bottom the nodes. No connectivity lines:
 * who talks to whom is in Network and Dependencies. Colours follow the theme of the console.
 */

const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels', 'spec.type', 'spec.system', 'relations'];

function useCatalogueComponents() {
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<{ loading: boolean; items: Entity[]; error?: string }>({ loading: true, items: [] });
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter: { kind: 'component' }, fields: FIELDS }).then(
      r => alive && setState({ loading: false, items: r.items }),
      e => alive && setState({ loading: false, items: [], error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return state;
}

const TileBox = ({ tile, colour }: { tile: ArchTile; colour: string }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const dot: Record<Health, string> = { ok: c.rq.positive, warn: c.rq.warning, bad: c.rq.negative, off: c.rq.control };
  const dashed = !tile.namespace;
  return (
    <Box
      data-tile={tile.name}
      data-health={tile.health}
      sx={{ border: `1px ${dashed ? 'dashed' : 'solid'} ${tile.health === 'bad' ? c.rq.negative : c.rq.border}`, borderRadius: '10px', bgcolor: dashed ? 'transparent' : c.rq.sheet, px: 1.25, py: 1, display: 'grid', gap: 0.75, minWidth: 0 }}
    >
      <Box component="span" sx={{ fontFamily: MONO, fontSize: 10.5, color: c.rq.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tile.namespace}>
        {tile.namespace ? `ns ${tile.namespace}` : t('ic.carch.noNamespace')}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
        <Box component="span" aria-hidden sx={{ width: 28, height: 28, flex: 'none', borderRadius: '7px', bgcolor: c.wash(colour), border: `1px solid ${c.line(colour)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: c.rq.ink }}>
          {monogram(tile.name)}
        </Box>
        <Box sx={{ minWidth: 0, display: 'grid' }}>
          <Box component="span" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
            <Link to={tile.to} style={{ fontSize: 13, fontWeight: 600, color: c.rq.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tile.name}
            </Link>
            {tile.health !== 'off' && <Box component="span" role="img" aria-label={tile.healthLabel} title={tile.healthLabel} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dot[tile.health], flex: 'none' }} />}
          </Box>
          {tile.sub && (
            <Box component="span" sx={{ fontSize: 11, lineHeight: '15px', color: c.rq.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tile.sub}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

const Band = ({ band }: { band: ArchBand }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const colour = LAYER_INFO[band.layer].colour;
  const title = band.layer === 'biz' ? t('cat.businessApps') : t(`cat.layer.${band.layer}`).split(' · ')[0];
  const meta = [band.namespaces ? t('ic.carch.namespaces', { n: band.namespaces }) : '', band.without ? t('ic.carch.without', { n: band.without }) : ''].filter(Boolean).join(' · ');
  return (
    <Box component="section" data-band={band.layer} aria-label={title} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: { xs: 'wrap', md: 'nowrap' }, bgcolor: c.wash(colour), border: `1px solid ${c.rq.border}`, borderLeft: `5px solid ${colour}`, borderRadius: '12px', p: 1.5 }}>
      <Box sx={{ width: { xs: '100%', md: 180 }, flex: 'none', display: 'grid', gap: 0.5 }}>
        <Box component="span" sx={{ justifySelf: 'start', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', bgcolor: colour, color: '#1b1f24', borderRadius: '6px', px: 1 }}>
          {BAND_CODE[band.layer]}
        </Box>
        <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, m: 0 }}>
          {title}
        </Typography>
        <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, color: c.rq.muted }}>
          {meta || t('ic.carch.nothing')}
        </Box>
      </Box>
      <Box sx={{ flex: '1 1 0', minWidth: 0, display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
        {band.tiles.map(x => (
          <TileBox key={x.id} tile={x} colour={colour} />
        ))}
        {band.tiles.length === 0 && (
          <Box sx={{ fontSize: 12, color: c.rq.muted, py: 1 }}>{t('ic.carch.empty')}</Box>
        )}
      </Box>
    </Box>
  );
};

const pct = (x: number) => Math.round(x * 100);

const NodeBox = ({ n }: { n: NodeOverview }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const mem = n.memory.allocatable ? n.memory.requested / n.memory.allocatable : 0;
  const state = choose([[!n.ready, c.rq.negative], [!n.schedulable, c.rq.warning]], c.rq.positive);
  return (
    <Box data-node={n.name} sx={{ border: `1px solid ${c.rq.border}`, borderRadius: '10px', bgcolor: c.rq.sheet, p: 1.25, display: 'grid', gap: 0.5, minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
        <Box component="b" sx={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.roles.length ? n.roles.join(', ') : 'worker'}</Box>
        <Box component="span" role="img" aria-label={n.ready ? 'Ready' : 'Not ready'} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: state, flex: 'none' }} />
      </Box>
      <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, overflowWrap: 'anywhere' }}>{n.ip ?? n.name}</Box>
      <Box component="span" sx={{ fontSize: 11, color: c.rq.muted }}>
        {Math.round(n.cpu.allocatable)} vCPU · {Math.round(n.memory.allocatable / 2 ** 30)} GiB · {t('ic.carch.pods', { n: n.pods })}
      </Box>
      <Box sx={{ height: 6, borderRadius: 3, bgcolor: c.rq.rule, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${Math.min(100, pct(mem))}%`, bgcolor: mem > 0.9 ? c.rq.warning : c.rq.data }} />
      </Box>
      <Box component="span" sx={{ fontSize: 11, color: c.rq.muted }}>{t('ic.carch.memory', { pct: pct(mem) })}</Box>
    </Box>
  );
};

export const ClusterArchitecture = ({ overview, vip }: { overview: ClusterOverview; vip?: string }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const catalogue = useCatalogueComponents();
  const net = useClusterNetwork();
  const bands = useMemo(() => clusterBands(catalogue.items, overview.apps), [catalogue.items, overview.apps]);
  const n = net.data;
  const sso = n ? identityHost(n) : undefined;
  const user = n?.namespaces.filter(x => !x.system) ?? [];
  // the way in: what the network of the cluster says, each step only with what is known
  const entry: Array<[string, string, string]> = [
    ['VIP', t('ic.carch.vip'), vip ?? t('ic.carch.unknown')],
    ['TR', 'Traefik', n?.entry ? `ns ${n.entry.namespace} · ${t('ic.carch.hosts', { n: n.hosts.length })}` : t('ic.carch.unknown')],
    ['KC', 'Keycloak SSO', sso ?? t('ic.carch.unknown')],
    ['CA', t('ic.carch.segments'), n ? t('ic.carch.segmentsSub', { s: n.segments.length, ns: user.length }) : t('ic.carch.unknown')],
  ];
  const legend: Array<[Health, string]> = [['ok', t('ic.carch.legend.ok')], ['warn', t('ic.carch.legend.warn')], ['bad', t('ic.carch.legend.bad')]];
  const dot: Record<Health, string> = { ok: c.rq.positive, warn: c.rq.warning, bad: c.rq.negative, off: c.rq.control };
  const pieces = bands.reduce((sum, b) => sum + b.tiles.length, 0);
  return (
    <Box role="group" aria-label={t('ic.carch.label')} sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 12, color: c.rq.muted, justifyContent: 'space-between' }}>
        <span>{t('ic.carch.sub', { pieces, apps: overview.apps.length })}</span>
        <Box component="span" sx={{ display: 'inline-flex', gap: 1.5, flexWrap: 'wrap' }}>
          {legend.map(([h, label]) => (
            <Box component="span" key={h} sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
              <Box component="span" aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dot[h] }} />
              {label}
            </Box>
          ))}
          <Box component="span" sx={{ fontFamily: MONO }}>ns = namespace</Box>
        </Box>
      </Box>
      <Box data-entry sx={{ display: 'flex', gap: 1, alignItems: 'stretch', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        {entry.map(([mono, name, sub], i) => (
          <Fragment key={mono}>
            {i > 0 && (
              <Box component="span" aria-hidden sx={{ alignSelf: 'center', fontSize: 22, color: c.rq.control, display: { xs: 'none', md: 'block' } }}>
                ›
              </Box>
            )}
            <Box sx={{ flex: '1 1 180px', minWidth: 0, border: `1px solid ${c.rq.border}`, borderRadius: '12px', bgcolor: c.rq.sheet, px: 1.5, py: 1.25, display: 'flex', gap: 1.25, alignItems: 'center' }}>
              <Box component="span" aria-hidden sx={{ width: 34, height: 34, flex: 'none', borderRadius: '9px', bgcolor: c.rq.raised, border: `1px solid ${c.rq.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                {mono}
              </Box>
              <Box sx={{ minWidth: 0, display: 'grid' }}>
                <Box component="b" sx={{ fontSize: 13, fontWeight: 600 }}>{name}</Box>
                <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, color: c.rq.muted, overflowWrap: 'anywhere' }}>{sub}</Box>
              </Box>
            </Box>
          </Fragment>
        ))}
      </Box>
      {catalogue.error && <Typography color="error">{t('ic.carch.catalogError', { error: catalogue.error })}</Typography>}
      {catalogue.loading ? (
        <Typography color="text.secondary">{t('shell.reading')}</Typography>
      ) : (
        ARCH_BANDS.map(l => bands.find(b => b.layer === l)!).map(b => <Band key={b.layer} band={b} />)
      )}
      <Box component="section" data-nodes aria-label={t('cluster.nodes')} sx={{ border: `1px solid ${c.rq.border}`, borderRadius: '12px', bgcolor: c.rq.raised, p: 1.5, display: 'grid', gap: 1.25 }}>
        <Box component="span" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {t('cluster.nodes')} · {[...new Set(overview.nodes.map(x => x.kubelet).filter(Boolean))].join(', ') || 'Kubernetes'}
        </Box>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {overview.nodes.map(x => (
            <NodeBox key={x.name} n={x} />
          ))}
        </Box>
      </Box>
    </Box>
  );
};
