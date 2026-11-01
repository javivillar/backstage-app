import { type Entity } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useClusterOverview } from '../overview';
import { consoleEntityPath } from './classify';
import { healthOf } from './EntityDependencies';
import { TONES } from './Flow';
import { BAND_H, buildGraph, type DepNodeModel, forceLayout, GLASS, type Health, LAYER_INFO, LAYERS, type Layer, layerY, reach, stackLayout, wAt } from './depsModel';

const HEALTH: Record<Health, { label: string; colour: string }> = {
  ok: { label: 'Healthy', colour: TONES.ok.fg },
  warn: { label: 'Degraded / out of sync', colour: '#B96A00' },
  bad: { label: 'Failing', colour: TONES.bad.fg },
  off: { label: 'Unknown', colour: TONES.off.fg },
};
const GLASS_COLOUR = '#61D9FF';
const FIELDS = ['kind', 'metadata', 'spec.type', 'spec.owner', 'spec.system', 'relations'];
const radius = (n: DepNodeModel) => Math.min(64, (n.layer === 'biz' ? 40 : 34) + n.deg * 2);
const cut = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type View = { k: number; x: number; y: number };
type Drag = { kind: 'pan'; sx: number; sy: number; v: View } | { kind: 'node'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean };

/** Portal › Dependencies: the platform as the Refresquito glass (Stack) or as a free graph, from the catalog and Argo CD. */
export const DependencyExplorer = () => {
  const catalog = useApi(catalogApiRef);
  const ov = useClusterOverview();
  const theme = useTheme();
  const fg = theme.palette.text.primary;
  const muted = theme.palette.text.secondary;
  const paper = theme.palette.background.paper;
  const line = theme.palette.divider;
  const [entities, setEntities] = useState<{ loading: boolean; items: Entity[]; error?: string }>({ loading: true, items: [] });
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter: [{ kind: 'component' }, { kind: 'resource' }, { kind: 'api' }], fields: FIELDS }).then(
      r => alive && setEntities({ loading: false, items: r.items }),
      e => alive && setEntities({ loading: false, items: [], error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  const apps = ov.data?.apps;
  const graph = useMemo(() => buildGraph(entities.items, e => healthOf(e.metadata.name.replace(/-oneke$/, ''), apps ?? [])), [entities.items, apps]);
  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);

  const [mode, setMode] = useState<'stack' | 'graph'>('stack');
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>(new Map());
  const relayout = (m = mode) => setPos(m === 'stack' ? stackLayout(graph.nodes, graph.links) : forceLayout(graph.nodes, graph.links, stackLayout(graph.nodes, graph.links)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => relayout(), [graph, mode]);

  const [q, setQ] = useState('');
  const [layers, setLayers] = useState<Set<Layer>>(new Set(LAYERS));
  const [health, setHealth] = useState<'all' | Health>('all');
  const [hops, setHops] = useState(4);
  const [down, setDown] = useState(false);
  const [sel, setSel] = useState<string | undefined>();
  const [showDetail, setShowDetail] = useState(true);
  const selected = sel ? byId.get(sel) : undefined;

  const around = useMemo(() => (sel && (hops < 4 || down) ? reach(sel, graph.links, hops >= 4 ? 99 : hops, down) : undefined), [sel, hops, down, graph.links]);
  const visible = (n: DepNodeModel) =>
    layers.has(n.layer) &&
    (health === 'all' || n.health === health) &&
    (!q || `${n.label} ${n.entity.metadata.name} ${n.product}`.toLowerCase().includes(q.toLowerCase())) &&
    (!around || around.has(n.id));
  const neigh = useMemo(() => {
    const s = new Set<string>(sel ? [sel] : []);
    graph.links.forEach(l => {
      if (l.source === sel) s.add(l.target);
      if (l.target === sel) s.add(l.source);
    });
    return s;
  }, [sel, graph.links]);

  // pan and zoom: the view box follows {k, x, y}; fit shows the whole glass (or every node in Graph)
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ k: 0.4, x: 0, y: 0 });
  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const w = el.clientWidth || 1000;
    const h = el.clientHeight || 700;
    let box = { x0: -GLASS.halfTop - 60, x1: GLASS.halfTop + 60, y0: GLASS.top - 60, y1: layerY('ext') + 90 };
    if (mode === 'graph' && pos.size) {
      const xs = [...pos.values()].map(p => p.x);
      const ys = [...pos.values()].map(p => p.y);
      box = { x0: Math.min(...xs) - 120, x1: Math.max(...xs) + 120, y0: Math.min(...ys) - 120, y1: Math.max(...ys) + 140 };
    }
    const k = Math.min(2, 0.95 / Math.max((box.x1 - box.x0) / w, (box.y1 - box.y0) / h));
    setView({ k, x: w / 2 - k * ((box.x0 + box.x1) / 2), y: h / 2 - k * ((box.y0 + box.y1) / 2) });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => fit(), [pos.size, mode]);
  const zoomBy = (f: number, cx?: number, cy?: number) =>
    setView(v => {
      const el = svgRef.current;
      const px = cx ?? (el?.clientWidth ?? 0) / 2;
      const py = cy ?? (el?.clientHeight ?? 0) / 2;
      const k = Math.max(0.15, Math.min(3, v.k * f));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const drag = useRef<Drag | undefined>();
  const onBackgroundDown = (e: ReactPointerEvent) => {
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v: view };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onNodeDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    const p = pos.get(id)!;
    drag.current = { kind: 'node', id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy });
      return;
    }
    const dx = (e.clientX - d.sx) / view.k;
    const dy = (e.clientY - d.sy) / view.k;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const n = byId.get(d.id)!;
    let x = d.ox + dx;
    let y = d.oy + dy;
    if (mode === 'stack') {
      // in Stack a node moves along its layer, inside the glass
      y = Math.max(layerY(n.layer) - BAND_H / 2 + 24, Math.min(layerY(n.layer) + BAND_H / 2 - 24, y));
      const lim = (n.layer === 'ext' ? GLASS.halfTop : wAt(y)) - 70;
      x = Math.max(-lim, Math.min(lim, x));
    }
    setPos(m => new Map(m).set(d.id, { x, y }));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = undefined;
    if (d?.kind === 'node' && !d.moved) {
      setSel(d.id);
      setShowDetail(true);
    }
  };

  if (entities.loading) return <Progress />;
  if (entities.error) return <WarningPanel title="The catalog could not be read" message={entities.error} />;

  const lv = (s: string, t: string) => {
    const a = byId.get(s);
    const b = byId.get(t);
    return !!a && !!b && visible(a) && visible(b);
  };
  const glassPath = (() => {
    const { top, bottom, halfTop, halfBottom } = GLASS;
    return `M${-halfTop - 40},${top - 30} L${-halfBottom - 30},${bottom + 26} Q${-halfBottom - 30},${bottom + 70} ${-halfBottom + 30},${bottom + 70} L${halfBottom - 30},${bottom + 70} Q${halfBottom + 30},${bottom + 70} ${halfBottom + 30},${bottom + 26} L${halfTop + 40},${top - 30}`;
  })();
  const out = selected ? graph.links.filter(l => l.source === selected.id) : [];
  const inc = selected ? graph.links.filter(l => l.target === selected.id) : [];
  const btn = () => ({ textTransform: 'none', borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }) as const;
  const item = (id: string, label: string) => {
    const m = byId.get(id);
    if (!m) return null;
    return (
      <Box
        key={`${id}-${label}`}
        component="button"
        type="button"
        onClick={() => setSel(id)}
        sx={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 1, alignItems: 'center', px: 0.75, py: 0.5, borderRadius: '6px', fontSize: 14, '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
      >
        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: HEALTH[m.health].colour, flexShrink: 0 }} />
        <span>{m.label}</span>
        <Box component="span" sx={{ ml: 'auto', fontSize: 12, color: 'text.secondary', bgcolor: 'action.hover', borderRadius: 999, px: 1 }}>
          {label}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600, fontSize: 28 }}>
          Dependencies
        </Typography>
        <Typography color="text.secondary">
          The platform as the Refresquito stack: business applications on top, the foundations below. From the catalog (depends on, APIs consumed) and Argo CD (state).
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.75, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '230px minmax(0, 1fr)' }, alignItems: 'stretch' }}>
        <Box component="aside" aria-label="Filters" sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.5, bgcolor: 'background.paper', display: 'grid', gap: 1.25, alignContent: 'start' }}>
          <Typography variant="overline" color="text.secondary">
            Find
          </Typography>
          <TextField size="small" placeholder="Application or service" value={q} onChange={e => setQ(e.target.value)} inputProps={{ 'aria-label': 'Search' }} />
          <Typography variant="overline" color="text.secondary">
            What
          </Typography>
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            {LAYERS.map(k => (
              <Box component="label" key={k} sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: 13.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={layers.has(k)}
                  onChange={e =>
                    setLayers(s => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(k);
                      else n.delete(k);
                      return n;
                    })
                  }
                />
                <Box component="span" sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: LAYER_INFO[k].colour, flexShrink: 0 }} />
                {LAYER_INFO[k].label}
                <Box component="span" sx={{ ml: 'auto', color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}>
                  {graph.nodes.filter(n => n.layer === k).length}
                </Box>
              </Box>
            ))}
          </Box>
          <Typography variant="overline" color="text.secondary">
            State
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {(['all', 'ok', 'warn', 'bad'] as const).map(h => (
              <Button key={h} size="small" variant={health === h ? 'contained' : 'outlined'} disableElevation aria-pressed={health === h} onClick={() => setHealth(h)} sx={btn()}>
                {{ all: 'All', ok: 'Healthy', warn: 'Degraded', bad: 'Failing' }[h]}
              </Button>
            ))}
          </Box>
          <Typography variant="overline" color="text.secondary">
            Around the selected
          </Typography>
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'text.secondary' }}>
              <span>Hops</span>
              <span>{hops >= 4 ? 'all' : hops}</span>
            </Box>
            <input type="range" min={1} max={4} value={hops} onChange={e => setHops(Number(e.target.value))} aria-label="Hops around the selected node" style={{ width: '100%' }} />
          </Box>
          <Box component="label" sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: 13.5 }}>
            <input type="checkbox" checked={down} onChange={e => setDown(e.target.checked)} /> Only what it uses (downstream)
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setQ('');
                setLayers(new Set(LAYERS));
                setHealth('all');
                setHops(4);
                setDown(false);
              }}
              sx={{ textTransform: 'none' }}
            >
              Reset filters
            </Button>
            <Button size="small" variant="outlined" onClick={() => relayout()} sx={{ textTransform: 'none' }}>
              Re-arrange
            </Button>
          </Box>
        </Box>

        <Box component="section" aria-label="Dependency graph" sx={{ position: 'relative', border: 1, borderColor: 'divider', borderRadius: '12px', bgcolor: 'background.paper', overflow: 'hidden', height: { xs: '70vh', lg: 'calc(100vh - 230px)' }, minHeight: 560 }}>
          <Box role="group" aria-label="View" sx={{ position: 'absolute', left: 10, top: 10, zIndex: 2, display: 'flex', gap: 0.5, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '10px', p: 0.4 }}>
            {(['graph', 'stack'] as const).map(m => (
              <Button key={m} size="small" variant={mode === m ? 'contained' : 'text'} disableElevation aria-pressed={mode === m} onClick={() => setMode(m)} sx={{ textTransform: 'none', minWidth: 0, px: 1.5 }}>
                {m === 'graph' ? 'Graph' : 'Stack'}
              </Button>
            ))}
          </Box>
          <Box sx={{ position: 'absolute', right: 10, top: 10, zIndex: 2, display: 'grid', gap: 0.5 }}>
            {[
              ['+', 'Zoom in', () => zoomBy(1.3)],
              ['−', 'Zoom out', () => zoomBy(1 / 1.3)],
              ['⤢', 'Fit', fit],
            ].map(([t, l, f]) => (
              <Button key={l as string} aria-label={l as string} variant="outlined" onClick={f as () => void} sx={{ minWidth: 0, width: 32, height: 32, p: 0, bgcolor: 'background.paper', fontWeight: 600 }}>
                {t as string}
              </Button>
            ))}
          </Box>
          {!showDetail && selected && (
            <Button size="small" variant="outlined" onClick={() => setShowDetail(true)} sx={{ position: 'absolute', right: 54, top: 10, zIndex: 2, textTransform: 'none', bgcolor: 'background.paper' }}>
              Show details
            </Button>
          )}
          <svg
            ref={svgRef}
            role="img"
            aria-label="Dependencies of the platform"
            width="100%"
            height="100%"
            style={{ display: 'block', cursor: drag.current?.kind === 'pan' ? 'grabbing' : 'grab', touchAction: 'none' }}
            onPointerDown={onBackgroundDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <defs>
              <filter id="dep-soft" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {mode === 'stack' && (
                <g aria-hidden>
                  {LAYERS.filter(k => k !== 'ext').map((k, i) => {
                    const y0 = layerY(k) - BAND_H / 2 + 5;
                    const y1 = layerY(k) + BAND_H / 2 - 5;
                    return (
                      <g key={k}>
                        <path d={`M${-wAt(y0)},${y0} L${wAt(y0)},${y0} L${wAt(y1)},${y1} L${-wAt(y1)},${y1} Z`} fill={LAYER_INFO[k].colour} opacity={i === 0 ? 0.2 : 0.16} />
                        <text x={-wAt(y0) + 30} y={y0 + 30} fill={muted} style={{ font: '700 19px sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                          {LAYER_INFO[k].label}
                        </text>
                      </g>
                    );
                  })}
                  <path d={glassPath} fill="none" stroke={GLASS_COLOUR} strokeWidth={14} strokeLinejoin="round" opacity={0.7} />
                  <line x1={GLASS.halfTop - 260} y1={GLASS.top - 30} x2={GLASS.halfTop - 120} y2={GLASS.top - 330} stroke={GLASS_COLOUR} strokeWidth={16} strokeLinecap="round" opacity={0.7} />
                  {[
                    [-700, GLASS.top - 150, 34],
                    [-520, GLASS.top - 270, 22],
                    [480, GLASS.top - 200, 28],
                    [150, GLASS.top - 330, 16],
                  ].map(([x, y, r]) => (
                    <circle key={`${x}`} cx={x} cy={y} r={r} fill="none" stroke={GLASS_COLOUR} strokeWidth={7} opacity={0.6} />
                  ))}
                  <text x={-GLASS.halfTop} y={layerY('ext') - 20} fill={muted} style={{ font: '700 19px sans-serif', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                    {LAYER_INFO.ext.label}
                  </text>
                </g>
              )}
              <g>
                {graph.links.map(l => {
                  const a = pos.get(l.source);
                  const b = pos.get(l.target);
                  if (!a || !b || !lv(l.source, l.target)) return null;
                  const hl = l.source === sel || l.target === sel;
                  let d: string;
                  if (mode === 'stack') {
                    const my = (a.y + b.y) / 2;
                    d = `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
                  } else {
                    const dr = Math.hypot(b.x - a.x, b.y - a.y) * 1.6;
                    d = `M${a.x},${a.y} A${dr},${dr} 0 0,1 ${b.x},${b.y}`;
                  }
                  return (
                    <g key={`${l.source}>${l.target}`} opacity={sel && !hl && !around ? 0.15 : 1}>
                      <path d={d} fill="none" stroke={hl ? theme.palette.primary.main : line} strokeWidth={hl ? 2.4 : 1.4} strokeDasharray={l.type === 'api' ? '4 3' : undefined} />
                      {hl && (
                        <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} textAnchor="middle" fontSize={11} fill={muted} stroke={paper} strokeWidth={4} paintOrder="stroke">
                          {l.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
              <g>
                {graph.nodes.map(n => {
                  const p = pos.get(n.id);
                  if (!p || !visible(n)) return null;
                  const r = radius(n);
                  const dim = !!sel && !neigh.has(n.id) && !around;
                  const hc = HEALTH[n.health].colour;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${n.label}: ${HEALTH[n.health].label}`}
                      onPointerDown={e => onNodeDown(e, n.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          setSel(n.id);
                          setShowDetail(true);
                        }
                      }}
                      onDoubleClick={() => relayout()}
                      style={{ cursor: 'pointer', outline: 'none' }}
                    >
                      {n.health !== 'off' && <circle r={r + 9} fill={hc} filter="url(#dep-soft)" opacity={dim ? 0.08 : 0.28} />}
                      <circle r={r} fill={LAYER_INFO[n.layer].colour} stroke={n.id === sel ? theme.palette.primary.main : paper} strokeWidth={n.id === sel ? 3 : 2} opacity={dim ? 0.28 : 1} />
                      {n.health !== 'off' && <circle r={r + 4} fill="none" stroke={hc} strokeWidth={2.5} opacity={dim ? 0.3 : 1} />}
                      {n.deg > 0 && (
                        <text textAnchor="middle" y={7} fill="#fff" style={{ fontWeight: 700, fontSize: 20 }}>
                          {n.deg}
                        </text>
                      )}
                      <text textAnchor="middle" y={r + 25} fill={fg} stroke={paper} strokeWidth={5} paintOrder="stroke" style={{ fontWeight: 600, fontSize: 23, pointerEvents: 'none' }} opacity={dim ? 0.6 : 1}>
                        {cut(n.label)}
                      </text>
                      <text textAnchor="middle" y={r + 46} fill={muted} stroke={paper} strokeWidth={5} paintOrder="stroke" style={{ fontSize: 18, pointerEvents: 'none' }} opacity={dim ? 0.6 : 1}>
                        {cut(n.product)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
          <Typography variant="caption" sx={{ position: 'absolute', left: 12, bottom: 10, color: 'text.secondary', bgcolor: 'background.paper', px: 1, py: 0.25, borderRadius: '6px', border: 1, borderColor: 'divider' }}>
            Drag a node to move it (in Stack, along its layer) · drag the background to pan · wheel to zoom · the number is how many depend on it
          </Typography>
          {showDetail && selected && (
            <Box
              component="aside"
              aria-label="Detail"
              sx={{ position: 'absolute', right: 54, top: 54, width: 300, maxHeight: 'calc(100% - 80px)', overflow: 'auto', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.75, display: 'grid', gap: 1.25, boxShadow: '0 10px 30px rgba(0,0,0,.14)', zIndex: 3 }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <Box component="span" sx={{ bgcolor: LAYER_INFO[selected.layer].colour, color: '#fff', borderRadius: 999, px: 1.1, fontSize: 12, fontWeight: 600 }}>
                  {LAYER_INFO[selected.layer].label}
                </Box>
                <Button size="small" onClick={() => setShowDetail(false)} sx={{ textTransform: 'none', minWidth: 0 }}>
                  Hide
                </Button>
              </Box>
              <Typography sx={{ fontWeight: 600, fontSize: 18 }}>{selected.label}</Typography>
              <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 12px', m: 0, fontSize: 14, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
                <dt>State</dt>
                <dd>
                  <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: HEALTH[selected.health].colour, mr: 0.75 }} />
                  {selected.healthLabel}
                </dd>
                <dt>Kind</dt>
                <dd>{selected.product}</dd>
                {selected.entity.spec?.owner && (
                  <>
                    <dt>Owner</dt>
                    <dd>{String(selected.entity.spec.owner).replace(/^group:(default\/)?/, '')}</dd>
                  </>
                )}
              </Box>
              {selected.entity.metadata.description && (
                <Typography variant="body2" color="text.secondary">
                  {selected.entity.metadata.description}
                </Typography>
              )}
              <Typography variant="overline" color="text.secondary">
                Uses ({out.length})
              </Typography>
              <Box sx={{ display: 'grid', gap: 0.25 }}>{out.length ? out.map(l => item(l.target, l.label)) : <Typography variant="body2" color="text.secondary">Nothing.</Typography>}</Box>
              <Typography variant="overline" color="text.secondary">
                Used by ({inc.length})
              </Typography>
              <Box sx={{ display: 'grid', gap: 0.25 }}>{inc.length ? inc.map(l => item(l.source, l.label)) : <Typography variant="body2" color="text.secondary">Nobody.</Typography>}</Box>
              <Typography variant="overline" color="text.secondary">
                If it fails
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {inc.length ? `${inc.length} direct dependents stop or degrade: ${inc.map(l => byId.get(l.source)?.label).join(', ')}.` : 'Nothing depends on it.'}
              </Typography>
              <Box>
                <Button component={Link} to={consoleEntityPath(selected.entity)} variant="contained" disableElevation size="small" sx={{ textTransform: 'none' }}>
                  Open its page
                </Button>
              </Box>
            </Box>
          )}
          {!graph.nodes.length && (
            <Typography color="text.secondary" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              The catalog has no components yet.
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
};
