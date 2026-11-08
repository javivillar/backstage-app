import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { consoleEntityPath } from '../classify';
import { GlassBands } from '../DependencyExplorer';
import { BUSINESS_LAYERS, type DepNodeModel, glassFor, LAYER_INFO, layerY, stackLayout } from '../depsModel';
import { choose, EmptyState, Pill, TitleRow, type Tone } from '../ui';
import { BusinessMapTabs } from './BusinessMapTabs';
import { type Dot, Legend, NamespacePicker, Segmented, useDots } from './DashboardParts';
import { useBusinessData, useNamespaceParam } from './dashboardData';
import {
  affectedBy,
  type BusinessGraph,
  continuityOf,
  criticalityOf,
  deliversOf,
  formatMinutes,
  frameworkOf,
  healthOfNode,
  litOf,
  needsOf,
  radiusOf,
  supportOf,
} from './glassModel';

type GlassLens = 'criticality' | 'continuity' | 'framework' | 'health';
const GLASS_LENSES: GlassLens[] = ['criticality', 'continuity', 'framework', 'health'];
const LEGENDS: Record<GlassLens, Array<[Dot, string]>> = {
  criticality: [['critical', 'bmd.crit.critical'], ['important', 'bmd.crit.important'], ['standard', 'bmd.crit.standard'], ['none', 'bmd.lg.noneAbove']],
  continuity: [['ok', 'bmd.lg.meets'], ['bad', 'bmd.lg.gap'], ['none', 'bmd.lg.noCheckBuild']],
  framework: [['ok', 'bmd.lg.fwOk'], ['warn', 'bmd.lg.fwEnding'], ['bad', 'bmd.lg.fwBad'], ['none', 'bmd.lg.na']],
  health: [['ok', 'bmd.lg.healthy'], ['warn', 'bmd.lg.degraded'], ['bad', 'bmd.lg.down'], ['none', 'bmd.lg.noData']],
};
const critTone: Record<string, Tone> = { critical: 'neg', important: 'warn', standard: 'neu' };
const BUSINESS = new Set(['dom', 'proc', 'biz']);
const cut = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** the dot of a node under a lens */
function dotOf(lens: GlassLens, g: BusinessGraph, id: string, now: number): Dot {
  if (lens === 'criticality') return criticalityOf(g, id) ?? 'none';
  if (lens === 'continuity') {
    const c = continuityOf(g, id);
    return choose<Dot>([[c === 'meets', 'ok'], [c === 'rpo' || c === 'rto', 'bad']], 'none');
  }
  if (lens === 'framework') {
    const f = frameworkOf(g, id, now);
    return choose<Dot>([[f === 'supported', 'ok'], [f === 'ending', 'warn'], [f === 'deprecated' || f === 'unsupported', 'bad']], 'none');
  }
  const h = healthOfNode(g, id);
  return choose<Dot>([[h === 'ok', 'ok'], [h === 'warn', 'warn'], [h === 'bad', 'bad']], 'none');
}

/**
 * Business map › Glass: the glass of Portal › Dependencies with the business on top (domains, processes, business
 * services and their pro instances, platform and development services, infrastructure). Colour by criticality
 * (inherited down), continuity (a gap flows up), framework support or health; the size of a service is its blast
 * radius. Picking a node lights its chain up and down; the panel lists the processes that stop if it fails.
 */
export const BusinessGlassPage = () => {
  const { t } = useI18n();
  const dots = useDots();
  const theme = useTheme();
  const muted = theme.palette.text.secondary;
  const paper = theme.palette.background.paper;
  const [namespace, setNamespace] = useNamespaceParam();
  const [params] = useSearchParams();
  const data = useBusinessData(namespace);
  const [lens, setLens] = useState<GlassLens>('criticality');
  const [picked, setPicked] = useState<string | null | undefined>();
  const [now] = useState(() => Date.now());
  const { graph } = data;
  const pos = useMemo(() => (graph ? stackLayout(graph.nodes, graph.links, BUSINESS_LAYERS) : new Map<string, { x: number; y: number }>()), [graph]);

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('bmd.crumb'), '/console/business-map'], [t('bmd.glass.title')]];
  const title = namespace ? `${t('bmd.glass.title')} · ${namespace}` : t('bmd.glass.title');
  if (data.loading) return <Progress />;
  if (!data.map || !graph) {
    return (
      <Box>
        <TitleRow crumbs={crumbs} title={title} />
        <BusinessMapTabs />
        <WarningPanel title={t('bmd.noMap')} message={data.error} />
      </Box>
    );
  }
  // ?node= picks a node on arrival (the heat map links here); a click on the picked node lets it go
  const fromUrl = params.get('node') ?? undefined;
  const sel = picked === undefined ? fromUrl : picked ?? undefined;
  const selected = sel ? graph.byId.get(sel) : undefined;
  const lit = selected ? litOf(graph, selected.id) : undefined;
  const g = glassFor(BUSINESS_LAYERS);
  const box = { x0: -g.halfTop - 80, x1: g.halfTop + 80, y0: g.top - 120, y1: layerY('ext', BUSINESS_LAYERS) + 120 };
  const toggle = (id: string) => setPicked(sel === id ? null : id);

  const node = (n: DepNodeModel) => {
    const p = pos.get(n.id);
    if (!p) return null;
    const r = radiusOf(graph, n.id);
    const dim = !!lit && !lit.has(n.id);
    const fill = dots[dotOf(lens, graph, n.id, now)];
    const blast = graph.above.get(n.id)?.length ?? 0;
    const on = n.id === sel;
    return (
      <g
        key={n.id}
        transform={`translate(${p.x},${p.y})`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={n.label}
        onClick={() => toggle(n.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(n.id);
          }
        }}
        style={{ cursor: 'pointer', outline: 'none' }}
        opacity={dim ? 0.25 : 1}
      >
        {n.layer === 'fwk' ? (
          <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={12} fill={fill} stroke={on ? theme.palette.secondary.main : paper} strokeWidth={on ? 6 : 3} />
        ) : (
          <circle r={r} fill={fill} stroke={on ? theme.palette.secondary.main : paper} strokeWidth={on ? 6 : 3} />
        )}
        {!BUSINESS.has(n.layer) && blast > 0 && (
          <text textAnchor="middle" y={8} fill="#fff" stroke="#000" strokeOpacity={0.35} strokeWidth={3} paintOrder="stroke" style={{ fontWeight: 700, fontSize: 22 }}>
            {blast}
          </text>
        )}
        <text textAnchor="middle" y={r + 26} fill={theme.palette.text.primary} stroke={paper} strokeWidth={5} paintOrder="stroke" style={{ fontWeight: 600, fontSize: 23, pointerEvents: 'none' }}>
          {cut(n.label)}
        </text>
      </g>
    );
  };

  const panel = () => {
    if (!selected) {
      return (
        <Typography variant="body2" color="text.secondary">
          {t('bmd.glass.pick')}
        </Typography>
      );
    }
    const id = selected.id;
    const crit = criticalityOf(graph, id);
    const proc = graph.processes.get(id);
    const cont = continuityOf(graph, id);
    const fw = frameworkOf(graph, id, now);
    const h = healthOfNode(graph, id);
    const affected = affectedBy(graph, id);
    let k2 = t('bmd.glass.dependsOn');
    let v2 = graph.links.filter(l => l.source === id).map(l => graph.byId.get(l.target)?.label).filter(Boolean).join(', ') || '—';
    if (proc) {
      k2 = t('bmd.glass.needs');
      v2 = `RPO ${proc.requirement?.rpo ?? '—'} · RTO ${proc.requirement?.rto ?? '—'}`;
    } else if (selected.layer === 'fwk') {
      const s = supportOf(selected.entity, now);
      k2 = t('bmd.glass.support');
      v2 = `${t(`bmd.fw.${s.support}`)}${s.until ? ` · ${s.until}` : ''}`;
    } else if (!BUSINESS.has(selected.layer)) {
      const d = deliversOf(selected.entity);
      const tier = selected.entity.metadata.annotations?.['refresquito.io/sla-tier'];
      k2 = t('bmd.glass.delivers');
      v2 = [tier, d.rpo !== undefined && `RPO ${formatMinutes(d.rpo)}`, d.rto !== undefined && `RTO ${formatMinutes(d.rto)}`].filter(Boolean).join(' · ') || t('bmd.glass.saysNothing');
    }
    const impTitle = choose<string>([[selected.layer === 'fwk', t('bmd.glass.cannotPatch')], [!BUSINESS.has(selected.layer) || selected.layer === 'biz', t('bmd.glass.ifFails')]], t('bmd.glass.processes'));
    return (
      <>
        <Box>
          <Box sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>{LAYER_INFO[selected.layer].label}</Box>
          <Typography variant="h6" component="h2">
            {selected.label}
          </Typography>
        </Box>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 12px', m: 0, fontSize: 13, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
          <dt>{t('bmd.glass.criticality')}</dt>
          <dd>{crit ? `${t(`bmd.crit.${crit}`)}${proc || selected.layer === 'dom' ? '' : ` (${t('bmd.glass.inherited')})`}` : '—'}</dd>
          <dt>{k2}</dt>
          <dd>{v2}</dd>
          <dt>{t('bmd.lens.continuity')}</dt>
          <dd>{t(`bmd.check.${cont}`)}</dd>
          <dt>{t('bmd.glass.framework')}</dt>
          <dd>{t(`bmd.fw.${fw}`)}</dd>
          <dt>{t('bmd.lens.health')}</dt>
          <dd>{t(`bmd.health.${h}`)}</dd>
        </Box>
        <Box sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>{impTitle}</Box>
        {affected.length ? (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}>
            {affected.map(p => (
              <Box component="li" key={p.ref} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, border: 1, borderColor: 'divider', borderRadius: '8px', px: 1.25, py: 0.75, fontSize: 13 }}>
                <span>{p.title}</span>
                <Pill tone={critTone[p.criticality] ?? 'neu'}>
                  {t(`bmd.crit.${p.criticality}`)} · RTO {needsOf(p).rto !== undefined ? formatMinutes(needsOf(p).rto!) : '—'}
                </Pill>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('bmd.glass.noneAbove')}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {t('bmd.glass.hint')}
        </Typography>
        <Box>
          <Button component={Link} to={consoleEntityPath(selected.entity)} variant="outlined" size="small">
            {t('bmd.glass.open')}
          </Button>
        </Box>
      </>
    );
  };

  return (
    <Box>
      <TitleRow crumbs={crumbs} title={title} sub={t('bmd.glass.sub')} actions={<NamespacePicker namespaces={data.map.namespaces} value={namespace} onChange={setNamespace} />} />
      <BusinessMapTabs />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center', justifyContent: 'space-between', py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Segmented label={t('bmd.colourBy')} options={GLASS_LENSES.map(k => [k, t(`bmd.glens.${k}`)])} value={lens} onChange={setLens} />
        <Legend items={LEGENDS[lens].map(([d, key]) => ({ bg: dots[d], text: t(key), round: true }))} note={t('bmd.glass.legendNote')} />
      </Box>
      {!graph.processes.size ? (
        <EmptyState title={t('bmd.noProcesses')}>{t('bmd.noProcesses.hint')}</EmptyState>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Box sx={{ flex: '999 1 640px', minWidth: 0, py: 1.5 }}>
            <svg role="img" aria-label={t('bmd.glass.title')} viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`} width="100%" style={{ display: 'block', maxHeight: '78vh' }}>
              <GlassBands layers={BUSINESS_LAYERS} muted={muted} />
              <g>
                {graph.links.map(l => {
                  const a = pos.get(l.source);
                  const b = pos.get(l.target);
                  if (!a || !b) return null;
                  const hot = !!lit && lit.has(l.source) && lit.has(l.target);
                  const my = (a.y + b.y) / 2;
                  const dev = graph.byId.get(l.target)?.layer === 'fwk';
                  return (
                    <path
                      key={`${l.source}>${l.target}`}
                      d={`M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`}
                      fill="none"
                      stroke={hot ? theme.palette.secondary.main : theme.palette.divider}
                      strokeWidth={hot ? 4 : 2}
                      strokeDasharray={dev ? '8 7' : undefined}
                      opacity={lit && !hot ? 0.15 : 1}
                    />
                  );
                })}
              </g>
              <g>{graph.nodes.map(node)}</g>
            </svg>
          </Box>
          <Box component="aside" aria-label={t('bmd.selected')} sx={{ flex: '1 0 300px', maxWidth: { md: 360 }, boxSizing: 'border-box', py: 2, pl: { md: 2.5 }, borderLeft: { md: 1 }, borderColor: 'divider', display: 'grid', gap: 1.5, alignContent: 'start' }}>
            {panel()}
          </Box>
        </Box>
      )}
    </Box>
  );
};
