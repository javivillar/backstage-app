import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { consoleEntityPath } from '../classify';
import { GlassBands } from '../DependencyExplorer';
import { BUSINESS_GLASS_LAYERS, buildGraph, type DepNodeModel, glassToFill, isDomainLayer, isProcessLayer, LAYER_INFO, stackLayout } from '../depsModel';
import { choose, EmptyState, Pill, TitleRow, type Tone } from '../ui';
import { BusinessMapTabs } from './BusinessMapTabs';
import { type Dot, Legend, NamespacePicker, Segmented, useDots } from './DashboardParts';
import { useBusinessData, useNamespaceParam } from './dashboardData';
import {
  affectedBy,
  type BusinessGraph,
  businessGraph,
  continuityOf,
  criticalityOf,
  deliversOf,
  formatMinutes,
  frameworkOf,
  glassDrawn,
  healthOfNode,
  litOf,
  needsOf,
  normRef,
  radiusOf,
  supportOf,
} from './glassModel';
import { appMatcher, CRIT_FILTERS, type CritFilter, GLASS_LEVELS, type GlassLevel, glassView, readGlassParams, writeGlassParams } from './glassViewModel';

type GlassLens = 'criticality' | 'continuity' | 'framework' | 'health';
const GLASS_LENSES: GlassLens[] = ['criticality', 'continuity', 'framework', 'health'];
const LEGENDS: Record<GlassLens, Array<[Dot, string]>> = {
  criticality: [['critical', 'bmd.crit.critical'], ['important', 'bmd.crit.important'], ['standard', 'bmd.crit.standard'], ['none', 'bmd.lg.noneAbove']],
  continuity: [['ok', 'bmd.lg.meets'], ['bad', 'bmd.lg.gap'], ['none', 'bmd.lg.noCheckBuild']],
  framework: [['ok', 'bmd.lg.fwOk'], ['warn', 'bmd.lg.fwEnding'], ['bad', 'bmd.lg.fwBad'], ['none', 'bmd.lg.na']],
  health: [['ok', 'bmd.lg.healthy'], ['warn', 'bmd.lg.degraded'], ['bad', 'bmd.lg.down'], ['none', 'bmd.lg.noData']],
};
const critTone: Record<string, Tone> = { critical: 'neg', important: 'warn', standard: 'neu' };
const BUSINESS = new Set(['dom', 'sub', 'proc', 'subp', 'biz']);
/** at most this many level-1 domains picked at once (the glass stays readable) */
const MAX_DOMAINS = 3;
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
 *
 * A big model (an APQC PCF) is cut down first (glassViewModel): only what is linked to applications, a level of detail
 * (domains / subdomains / processes; a click on a domain or a process opens it), level-1 domains, criticality and a
 * search of a process or an application. The view is in the URL, to share it.
 */
export const BusinessGlassPage = () => {
  const { t } = useI18n();
  const dots = useDots();
  const theme = useTheme();
  const muted = theme.palette.text.secondary;
  const paper = theme.palette.background.paper;
  const [namespace, setNamespace] = useNamespaceParam();
  const [params, setParams] = useSearchParams();
  const data = useBusinessData(namespace);
  const ns = data.full?.namespace ?? namespace ?? '';
  const opts = useMemo(() => readGlassParams(params, ns), [params, ns]);
  const setOpts = (o: Partial<typeof opts>) => setParams(writeGlassParams(params, { ...opts, ...o }), { replace: true });
  const [search, setSearch] = useState(opts.search);
  // the catalog alone, for the search of an application anywhere in a chain
  const catalogGraph = useMemo(() => buildGraph(data.catalog, data.health), [data.catalog, data.health]);
  const appMatch = useMemo(
    () => (data.full ? appMatcher(data.full, catalogGraph.nodes.map(n => ({ id: n.id, label: n.label, name: n.entity.metadata.name })), catalogGraph.links, opts.search) : undefined),
    [data.full, catalogGraph, opts.search],
  );
  const view = useMemo(
    () => (data.full ? glassView(data.full, { ...opts, appMatch }, (kind, n) => t(`bmd.glass.group.${kind}`, { n })) : undefined),
    [data.full, opts, appMatch, t],
  );
  const graph = useMemo(() => (view ? businessGraph(view.map, data.catalog, data.health) : undefined), [view, data.catalog, data.health]);
  const [lens, setLens] = useState<GlassLens>('criticality');
  const [picked, setPicked] = useState<string | null | undefined>();
  const [now] = useState(() => Date.now());
  // the glass fills what is left of the screen: as wide as its box, down to the bottom of the window
  const glassBox = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = glassBox.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(Math.max(520, window.innerHeight - r.top - 16)) };
      setSize(s => (s.w === next.w && s.h === next.h ? s : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [graph]);
  const filled = useMemo(() => glassToFill(BUSINESS_GLASS_LAYERS, size.w, size.h), [size]);
  // only the business bands are drawn, down to the business services; what is below still counts for the lenses,
  // the detail and the matrix
  const drawn = useMemo(() => (graph ? glassDrawn(graph) : { nodes: [], links: [] }), [graph]);
  const pos = useMemo(() => stackLayout(drawn.nodes, drawn.links, BUSINESS_GLASS_LAYERS, filled.shape), [drawn, filled]);

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('bmd.crumb'), '/console/business-map'], [t('bmd.glass.title')]];
  const title = namespace ? `${t('bmd.glass.title')} · ${namespace}` : t('bmd.glass.title');
  if (data.loading) return <Progress />;
  if (!data.full || !graph || !view) {
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
  const box = filled.box;
  const toggle = (id: string) => setPicked(sel === id ? null : id);
  const fullProcs = new Map(data.full.processes.map(p => [normRef(p.ref), p]));
  const openOrClose = (id: string) => {
    const open = new Set(opts.open);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    setOpts({ open });
  };
  /** a click: a folded group opens its domain; a domain, or a process with sub-processes, opens or closes; any picks */
  const click = (n: DepNodeModel) => {
    const group = view.groups.get(n.id);
    if (group?.kind === 'folded') {
      setOpts({ open: new Set([...opts.open, group.scope]) });
      return;
    }
    if (isDomainLayer(n.layer) && !opts.search) openOrClose(n.id);
    else if (isProcessLayer(n.layer) && fullProcs.get(n.id)?.subprocesses?.length && !opts.search) openOrClose(n.id);
    toggle(n.id);
  };
  const roots = data.full.domains.filter(d => !d.parent);
  const folded = [...view.groups.values()].reduce((x, gr) => x + gr.members.length, 0);

  /** a framework line a square; a group of processes a dashed box (without applications: no fill, no edges); else a circle */
  const shapeOf = (n: DepNodeModel) => {
    const r = radiusOf(graph, n.id);
    const fill = dots[dotOf(lens, graph, n.id, now)];
    const on = n.id === sel;
    const stroke = on ? theme.palette.secondary.main : paper;
    const group = view.groups.get(n.id);
    if (group) {
      return (
        <rect x={-r * 1.6} y={-r * 0.8} width={r * 3.2} height={r * 1.6} rx={10} fill={group.kind === 'unlinked' ? paper : fill} stroke={on ? stroke : muted} strokeWidth={on ? 6 : 3} strokeDasharray="10 7" />
      );
    }
    if (n.layer === 'fwk') return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={12} fill={fill} stroke={stroke} strokeWidth={on ? 6 : 3} />;
    const opened = opts.open.has(n.id);
    return <circle r={r} fill={fill} stroke={opened && !on ? muted : stroke} strokeWidth={on ? 6 : 3} strokeDasharray={opened && !on ? '6 5' : undefined} />;
  };

  const node = (n: DepNodeModel) => {
    const p = pos.get(n.id);
    if (!p) return null;
    const r = radiusOf(graph, n.id);
    const dim = !!lit && !lit.has(n.id);
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
        onClick={() => click(n)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            click(n);
          }
        }}
        style={{ cursor: 'pointer', outline: 'none' }}
        opacity={dim ? 0.25 : 1}
      >
        {shapeOf(n)}
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
    const group = view.groups.get(id);
    if (group) {
      const members = group.members.map(m => fullProcs.get(m)).filter((p): p is NonNullable<typeof p> => !!p);
      return (
        <>
          <Box>
            <Box sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>{graph.byId.get(group.scope)?.label ?? ''}</Box>
            <Typography variant="h6" component="h2">
              {selected.label}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t(`bmd.glass.group.${group.kind}.text`)}
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.5, maxHeight: 420, overflowY: 'auto' }}>
            {members.slice(0, 200).map(p => (
              <Box component="li" key={p.ref} sx={{ fontSize: 13 }}>
                <Link to={`/console/entity/${p.namespace}/businessprocess/${p.name}`}>{p.pcfId || p.modelId ? `${p.pcfId ?? p.modelId} ${p.title}` : p.title}</Link>
              </Box>
            ))}
          </Box>
          {members.length > 200 && (
            <Typography variant="caption" color="text.secondary">
              {t('bmd.glass.group.more', { n: members.length - 200 })}
            </Typography>
          )}
          {group.kind === 'unlinked' && (
            <Box>
              <Button size="small" variant="outlined" onClick={() => setOpts({ linked: false, open: new Set([...opts.open, group.scope]) })}>
                {t('bmd.glass.group.showAll')}
              </Button>
            </Box>
          )}
        </>
      );
    }
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
          <dd>{crit ? `${t(`bmd.crit.${crit}`)}${proc || isDomainLayer(selected.layer) ? '' : ` (${t('bmd.glass.inherited')})`}` : '—'}</dd>
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
      <TitleRow crumbs={crumbs} title={title} sub={t('bmd.glass.sub')} actions={<NamespacePicker namespaces={data.full.namespaces} value={namespace} onChange={setNamespace} />} />
      <BusinessMapTabs />
      <Box role="search" aria-label={t('bmd.glass.filters')} sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center', py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <FormControlLabel control={<Switch checked={opts.linked} onChange={e => setOpts({ linked: e.target.checked })} />} label={t('bmd.glass.linked')} />
        <Segmented<GlassLevel> label={t('bmd.glass.detail')} options={GLASS_LEVELS.map(k => [k, t(`bmd.glass.detail.${k}`)])} value={opts.level} onChange={v => setOpts({ level: v, open: new Set() })} />
        <Segmented<CritFilter> label={t('bmd.glass.crit')} options={CRIT_FILTERS.map(k => [k, t(`bmd.glass.crit.${k}`)])} value={opts.critical} onChange={v => setOpts({ critical: v })} />
        <Box
          component="form"
          onSubmit={e => {
            e.preventDefault();
            setOpts({ search });
          }}
          sx={{ display: 'flex', gap: 1, alignItems: 'center' }}
        >
          <TextField size="small" type="search" label={t('bmd.glass.find')} value={search} onChange={e => setSearch(e.target.value)} onBlur={() => search !== opts.search && setOpts({ search })} sx={{ minWidth: 240 }} />
        </Box>
        <Box role="group" aria-label={t('bmd.glass.domains')} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip size="small" label={t('bmd.glass.domains.all')} color={opts.domains.size ? 'default' : 'primary'} onClick={() => setOpts({ domains: new Set() })} />
          {roots.map(d => {
            const ref = normRef(d.ref);
            const on = opts.domains.has(ref);
            const full = !on && opts.domains.size >= MAX_DOMAINS;
            return (
              <Chip
                key={ref}
                size="small"
                label={d.pcfId || d.modelId ? `${d.pcfId ?? d.modelId} ${cut(d.title, 28)}` : cut(d.title, 28)}
                title={full ? t('bmd.glass.domains.max', { n: MAX_DOMAINS }) : d.title}
                color={on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                disabled={full}
                onClick={() => {
                  const next = new Set(opts.domains);
                  if (on) next.delete(ref);
                  else next.add(ref);
                  setOpts({ domains: next });
                }}
              />
            );
          })}
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
        {t('bmd.glass.status', { n: view.drawn, total: data.full.domains.length + data.full.processes.length, folded })}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center', justifyContent: 'space-between', py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Segmented label={t('bmd.colourBy')} options={GLASS_LENSES.map(k => [k, t(`bmd.glens.${k}`)])} value={lens} onChange={setLens} />
        <Legend items={LEGENDS[lens].map(([d, key]) => ({ bg: dots[d], text: t(key), round: true }))} note={t('bmd.glass.legendNote')} />
      </Box>
      {!graph.processes.size && !graph.nodes.length ? (
        <EmptyState title={t('bmd.noProcesses')}>{t('bmd.noProcesses.hint')}</EmptyState>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Box ref={glassBox} sx={{ flex: '999 1 640px', minWidth: 0, py: 1.5 }}>
            <svg
              role="img"
              aria-label={t('bmd.glass.title')}
              viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`}
              width="100%"
              height={size.h || undefined}
              style={{ display: 'block' }}
            >
              <GlassBands layers={BUSINESS_GLASS_LAYERS} muted={muted} shape={filled.shape} />
              <g>
                {drawn.links.map(l => {
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
              <g>{drawn.nodes.map(node)}</g>
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
