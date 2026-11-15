import { Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { CATALOG_FILTER_EXISTS, catalogApiRef } from '@backstage/plugin-catalog-react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusinessMap } from '../../businessMap';
import { useI18n } from '../../i18n';
import { size, useProtection, when } from '../../protection';
import { useRq } from '../../theme/consoleTheme';
import { useCustomer } from '../businessMap/BusinessMapTabs';
import { consolePath } from '../businessMap/businessMapModel';
import { NamespacePicker, Segmented } from '../businessMap/DashboardParts';
import { formatMinutes } from '../businessMap/glassModel';
import { CritPill } from '../businessMap/parts';
import { Card } from '../NamespaceSections';
import { Table } from '../NetworkPage';
import { EmptyState, Facts, Kpis, Pill, TitleRow, type Tone } from '../ui';
import {
  type Box as Placed,
  copiesLight,
  instancesOf,
  KINDS,
  type Lens,
  type Light,
  lightOf,
  lossOf,
  MIN_WIDTH,
  type NavNode,
  type Navigator,
  layout,
  navigator,
  pick,
  processesOf,
  type ServiceInstance,
  threadOf,
  tourOf,
  visibleOf,
} from './navigatorModel';

type T = ReturnType<typeof useI18n>['t'];
const TONE: Record<Light, Tone> = { ok: 'pos', warn: 'warn', bad: 'neg', na: 'neu' };
const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations', 'spec.type', 'spec.system'];
const STEP_MS = 3200;

/** Where the applications of the catalog run (their namespace) and their framework line; empty until read. */
function useInstances(): Map<string, ServiceInstance> {
  const catalog = useApi(catalogApiRef);
  const [found, setFound] = useState<Map<string, ServiceInstance>>(new Map());
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter: { kind: 'component', 'metadata.annotations.backstage.io/kubernetes-namespace': CATALOG_FILTER_EXISTS }, fields: FIELDS }).then(
      r => alive && setFound(instancesOf(r.items)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return found;
}

/**
 * The map is dark in both themes (the navy of the console), so the lights and the threads read the same by day and
 * by night. Boxes and links move with CSS transitions; a selected thread flows, a simulated loss climbs back up.
 */
const STAGE = {
  overflowX: 'auto',
  borderRadius: '12px',
  bgcolor: '#0d2238',
  '--ok': '#4ade80',
  '--warn': '#fbbf24',
  '--bad': '#f87171',
  '--na': '#7b8ba0',
  '@keyframes cnFlow': { to: { strokeDashoffset: -24 } },
  '@keyframes cnBack': { to: { strokeDashoffset: 34 } },
  '@keyframes cnIn': { from: { opacity: 0 } },
  '@keyframes cnHit': { '0%': { boxShadow: '0 0 0 0 rgba(255,93,93,.95)' }, '100%': { boxShadow: '0 0 0 16px rgba(255,93,93,0)' } },
  '& .cn-stage': {
    position: 'relative',
    overflow: 'hidden',
    transition: 'height .7s cubic-bezier(.65,0,.35,1)',
    background: 'radial-gradient(900px 520px at 12% -10%, #1c4470 0%, rgba(28,68,112,0) 70%), radial-gradient(700px 500px at 100% 110%, #143457 0%, rgba(20,52,87,0) 70%), #0d2238',
  },
  '& .cn-links': { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' },
  '& .cn-link': { fill: 'none', strokeWidth: 1.1, strokeOpacity: 0.34, strokeLinecap: 'round', transition: 'd .7s cubic-bezier(.65,0,.35,1), stroke .3s, stroke-opacity .3s, stroke-width .3s', animation: 'cnIn .6s ease both' },
  '& .cn-link.ok': { stroke: 'var(--ok)' },
  '& .cn-link.warn': { stroke: 'var(--warn)' },
  '& .cn-link.bad': { stroke: 'var(--bad)' },
  '& .cn-link.na': { stroke: 'var(--na)' },
  '& .cn-link.dim': { strokeOpacity: 0.07 },
  '& .cn-link.flow': { strokeWidth: 2, strokeOpacity: 0.95, strokeDasharray: '3 9', animation: 'cnFlow 1.1s linear infinite' },
  '& .cn-link.hit': { stroke: '#ff5d5d', strokeWidth: 2.6, strokeOpacity: 1, strokeDasharray: '10 7', animation: 'cnBack .7s linear infinite' },
  '& .cn-head': { position: 'absolute', top: 14, display: 'grid', gap: '1px', fontSize: 12, lineHeight: '16px', color: 'rgba(232,238,246,.75)', fontVariantNumeric: 'tabular-nums' },
  '& .cn-head b': { fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', fontSize: 11, color: '#aac4e2' },
  '& .cn-node': {
    all: 'unset',
    boxSizing: 'border-box',
    position: 'absolute',
    left: 0,
    top: 0,
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignContent: 'center',
    columnGap: '8px',
    padding: '0 9px',
    borderRadius: '7px',
    border: '1px solid rgba(190,214,242,.2)',
    background: '#17375a',
    color: '#eef3f9',
    overflow: 'hidden',
    transition: 'transform .7s cubic-bezier(.65,0,.35,1), width .7s cubic-bezier(.65,0,.35,1), height .7s cubic-bezier(.65,0,.35,1), background .25s, border-color .25s, box-shadow .25s, filter .25s',
    animation: 'cnIn .6s ease both',
  },
  '& .cn-node .t': { gridColumn: 1, fontSize: 11.5, lineHeight: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '& .cn-node .s': { gridColumn: 1, display: 'none', fontSize: 11, lineHeight: '14px', color: 'rgba(200,218,238,.78)', overflow: 'hidden' },
  '& .cn-node .l': { gridColumn: 2, gridRow: '1 / 3', display: 'flex', gap: '4px', alignItems: 'center' },
  '& .cn-node.med .t, & .cn-node.big .t': { whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' },
  '& .cn-node.med .t': { fontSize: 12.5, lineHeight: '16px', fontWeight: 500 },
  '& .cn-node.big': { padding: '0 12px' },
  '& .cn-node.big .t': { fontSize: 13.5, lineHeight: '18px', fontWeight: 600 },
  '& .cn-node.big .s': { display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', marginTop: '3px' },
  '& .cn-node.k-dom, & .cn-node.k-sub': { background: '#1b4069' },
  '& .cn-node.k-app': { background: '#20466f', borderColor: 'rgba(190,214,242,.34)' },
  '& .cn-node.k-data, & .cn-node.k-dig': { background: '#143352' },
  '& .cn-node.fold': { cursor: 'default', background: 'transparent', borderStyle: 'dashed', borderColor: 'rgba(190,214,242,.45)' },
  '& .cn-node:not(.fold):hover': { borderColor: '#9cc8ff', background: '#245282' },
  '& .cn-node:focus-visible': { outline: '2px solid #7cb7ff', outlineOffset: '2px' },
  '& .cn-node.dim': { filter: 'saturate(.4) brightness(.62)' },
  '& .cn-node.on': { borderColor: '#9cc8ff' },
  '& .cn-node.st-bad': { borderColor: 'rgba(248,113,113,.6)' },
  '& .cn-node.sel': { background: '#fff', color: '#121820', borderColor: '#fff', boxShadow: '0 0 0 3px rgba(124,183,255,.55), 0 10px 28px rgba(0,0,0,.35)' },
  '& .cn-node.sel .s': { color: '#56606b' },
  '& .cn-node.hit:not(.sel)': { background: '#5b1f27', borderColor: '#ff5d5d', animation: 'cnHit .9s ease-out var(--wait, 0ms) 2 both' },
  '& .cn-dot': { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--na)', flex: 'none' },
  '& .cn-dot.sq': { borderRadius: '2px' },
  '& .cn-dot.ok': { background: 'var(--ok)' },
  '& .cn-dot.warn': { background: 'var(--warn)' },
  '& .cn-dot.bad': { background: 'var(--bad)', boxShadow: '0 0 0 3px rgba(248,113,113,.22)' },
  '& .cn-dot.mute': { opacity: 0.18, boxShadow: 'none' },
  '& .cn-caption': {
    position: 'absolute', left: 16, right: 16, bottom: 14, margin: 'auto', width: 'fit-content', maxWidth: 'calc(100% - 32px)', background: '#fff', color: '#121820',
    borderRadius: '999px', padding: '8px 18px', fontSize: 14, lineHeight: '20px', fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,.4)', animation: 'cnIn .4s ease both',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '& .cn-stage, & .cn-node, & .cn-link': { transition: 'none', animation: 'none' },
    '& .cn-link.flow, & .cn-link.hit, & .cn-node.hit:not(.sel), & .cn-caption': { animation: 'none' },
  },
} as const;

const span = (minutes: number | undefined) => (minutes === undefined ? '—' : formatMinutes(minutes));

/** The second line of a box. */
function subOf(n: NavNode, nav: Navigator, t: T, lang: string): string {
  switch (n.kind) {
    case 'dom':
    case 'sub':
      return t('cn.box.domain', { n: n.processes ?? 0, critical: n.critical ?? 0 });
    case 'proc':
      return t('cn.box.process', { crit: t(`bm.crit.${n.process!.criticality}`), rpo: n.process!.requirement.rpo ?? '—', rto: n.process!.requirement.rto ?? '—' });
    case 'subp':
      return t('cn.box.step', { parent: nav.nodes.get(n.up[0])?.title ?? '' });
    case 'app':
      if (n.line) return t('cn.box.line', { line: n.line });
      return n.app ? n.app.namespace : t('cn.box.noData');
    case 'data':
      return t(n.every === undefined ? 'cn.box.noCopies' : 'cn.box.every', { size: size(n.volume?.bytes, lang), every: span(n.every) });
    default:
      return t('cn.box.open');
  }
}

/** The page of the entity behind a box, when it has one. */
function pageOf(n: NavNode): string | undefined {
  if (n.kind === 'data') return n.app ? `/console/data-continuity/app/${encodeURIComponent(n.app.app)}` : undefined;
  if (n.kind === 'dig') return '/console/continuity';
  return n.ref && n.kind !== 'dom' && n.kind !== 'sub' ? consolePath(n.ref) : undefined;
}

const LinkButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => {
  const rq = useRq();
  return (
    <Box component="button" type="button" onClick={onClick} sx={{ all: 'unset', cursor: 'pointer', color: rq.data, textDecoration: 'underline', '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 } }}>
      {children}
    </Box>
  );
};

const Rows = ({ children }: { children: ReactNode[] }) => {
  const rq = useRq();
  return (
    <Box sx={{ display: 'grid', '& > *': { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', justifyContent: 'space-between', py: 1, borderTop: `1px solid ${rq.rule}` }, '& > *:first-of-type': { borderTop: 0 } }}>
      {children}
    </Box>
  );
};

/**
 * Portal › Business management › Continuity navigator: the continuity of a customer in one map, from its domains
 * down to the data of its applications. Selecting a box keeps its thread (what is above and below) and the rest
 * leaves; under the map, what the business needs, what the copies give and the digital continuity (open).
 */
export const ContinuityNavigatorPage = () => {
  const { t, lang } = useI18n();
  const rq = useRq();
  const [ns, setNs] = useCustomer();
  const map = useBusinessMap(ns);
  const protection = useProtection();
  const instances = useInstances();
  const nav = useMemo(
    () => (map.data ? navigator({ map: map.data, protection: protection.data?.available ? protection.data : undefined, instances }) : undefined),
    [map.data, protection.data, instances],
  );
  const [trail, setTrail] = useState<string[]>([]);
  const [lens, setLens] = useState<Lens>('both');
  const [hover, setHover] = useState<string>();
  const [lost, setLost] = useState<string>();
  const [tour, setTour] = useState<{ step: number; ids: string[] }>();
  const [width, setWidth] = useState(MIN_WIDTH);
  const scroll = useRef<HTMLDivElement>(null);
  // a new customer or new data: start again from the whole business
  useEffect(() => {
    setTrail([]);
    setLost(undefined);
    setTour(undefined);
  }, [map.data]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return undefined;
    setWidth(el.clientWidth || MIN_WIDTH);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || MIN_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, [nav]);

  const select = useCallback(
    (id: string) => {
      if (!nav) return;
      setTour(undefined);
      setLost(undefined);
      setTrail(tr => pick(nav, tr, id));
    },
    [nav],
  );
  const lose = useCallback((id: string) => {
    setTour(undefined);
    setLost(id);
    setTrail([id]);
  }, []);
  const back = useCallback(() => {
    setTour(undefined);
    if (lost) setLost(undefined);
    else setTrail(tr => tr.slice(0, -1));
  }, [lost]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (trail.length || lost)) back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, trail.length, lost]);
  // the guided tour: one more box of the thread every few seconds, then the loss of the last one
  useEffect(() => {
    if (!tour) return undefined;
    const timer = setTimeout(() => {
      const next = tour.step + 1;
      if (next < tour.ids.length) {
        setTrail(tour.ids.slice(0, next + 1));
        setTour({ ...tour, step: next });
      } else if (next === tour.ids.length) {
        const last = tour.ids[tour.ids.length - 1];
        setLost(last);
        setTrail([last]);
        setTour({ ...tour, step: next });
      } else setTour(undefined);
    }, tour.step === tour.ids.length ? STEP_MS * 2 : STEP_MS);
    return () => clearTimeout(timer);
  }, [tour]);

  const visible = useMemo(() => (nav ? visibleOf(nav, trail) : new Set<string>()), [nav, trail]);
  const placed = useMemo(() => (nav ? layout(nav, visible, lens, width) : undefined), [nav, visible, lens, width]);
  const loss = useMemo(() => (nav && lost ? lossOf(nav, lost) : undefined), [nav, lost]);
  const options = useMemo(() => (nav ? [...nav.nodes.values()].filter(n => n.kind !== 'dig').sort((a, b) => a.col - b.col) : []), [nav]);

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('nav.businessManagement')], [t('nav.continuityNavigator')]];
  const picker = <NamespacePicker namespaces={map.data?.namespaces ?? []} value={ns ?? map.data?.namespace} onChange={setNs} />;
  const head = <TitleRow crumbs={crumbs} title={t('nav.continuityNavigator')} sub={t('cn.sub')} actions={picker} />;
  if (map.loading) {
    return (
      <Box>
        {head}
        <Progress />
      </Box>
    );
  }
  if (map.error || !nav || !placed) {
    return (
      <Box>
        {head}
        <EmptyState tone="neg" title={t('cn.error')}>
          {map.error}
        </EmptyState>
      </Box>
    );
  }
  if (!nav.columns[2].length) {
    return (
      <Box>
        {head}
        <EmptyState title={t('cn.empty')} action={<Button component={Link} to="/console/business-map" variant="outlined">{t('cn.empty.action')}</Button>}>
          {t('cn.empty.text')}
        </EmptyState>
      </Box>
    );
  }

  const selected = trail.length ? nav.nodes.get(trail[trail.length - 1]) : undefined;
  const hl = hover && visible.has(hover) ? threadOf(nav, hover) : undefined;
  const inHl = (id: string) => !hl || hl.has(id) || id.startsWith('fold:');
  const state = (l: Light) => t(`cn.state.${l}`);
  const startTour = () => {
    const ids = tourOf(nav);
    if (!ids.length) return;
    setLost(undefined);
    setTrail([ids[0]]);
    setTour({ step: 0, ids });
    scroll.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };
  let caption: string | undefined;
  if (tour) {
    const of = `${Math.min(tour.step + 1, tour.ids.length + 1)} / ${tour.ids.length + 1}`;
    const kind = tour.step < tour.ids.length ? nav.nodes.get(tour.ids[tour.step])?.kind : undefined;
    caption = `${of} · ${t(kind ? `cn.tour.${kind}` : 'cn.tour.loss')}`;
  }

  const box = (b: Placed) => {
    const style = { transform: `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`, width: b.w, height: b.h } as CSSProperties;
    if (b.fold) {
      return (
        <button key={b.id} type="button" disabled className="cn-node big fold" style={style}>
          <span className="t">{t('cn.fold', { n: b.fold.count, what: t(`cn.col.${KINDS[b.col]}`).toLowerCase() })}</span>
          <span className="s">{t('cn.fold.sub')}</span>
        </button>
      );
    }
    const n = nav.nodes.get(b.id)!;
    const light = lightOf(n, lens);
    const cls = ['cn-node', `k-${n.kind}`, b.size, `st-${light}`];
    if (!inHl(n.id)) cls.push('dim');
    if (n === selected) cls.push('sel');
    else if (trail.includes(n.id)) cls.push('on');
    if (loss?.hit.has(n.id)) cls.push('hit');
    const wait = loss && lost ? `${Math.max(0, nav.nodes.get(lost)!.col - n.col) * 160}ms` : '0ms';
    return (
      <button
        key={b.id}
        type="button"
        className={cls.join(' ')}
        style={{ ...style, '--wait': wait } as CSSProperties}
        title={n.title}
        aria-pressed={n === selected}
        onClick={() => select(n.id)}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover(h => (h === n.id ? undefined : h))}
        onFocus={() => setHover(n.id)}
        onBlur={() => setHover(h => (h === n.id ? undefined : h))}
      >
        <span className="t">{n.title}</span>
        <span className="s">{subOf(n, nav, t, lang)}</span>
        {n.kind !== 'dig' && (
          <span className="l">
            <i className={`cn-dot ${n.check}${lens === 'data' ? ' mute' : ''}`} title={t('cn.light.check', { state: state(n.check) })} />
            <i className={`cn-dot sq ${n.data}${lens === 'check' ? ' mute' : ''}`} title={t('cn.light.data', { state: state(n.data) })} />
          </span>
        )}
      </button>
    );
  };

  // ---- under the map
  const procs = processesOf(nav, visible, lens);
  const apps = nav.columns[4].filter(id => visible.has(id)).map(id => nav.nodes.get(id)!);
  const tightest = (f: 'rpo' | 'rto') => procs.reduce<number | undefined>((m, p) => (p[f] !== undefined && (m === undefined || p[f]! < m) ? p[f] : m), undefined);
  const lights = (n: Pick<NavNode, 'check' | 'data'>) => (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary">{t('cn.check')}</Typography>
      <Pill tone={TONE[n.check]}>{state(n.check)}</Pill>
      <Typography variant="caption" color="text.secondary">{t('cn.data')}</Typography>
      <Pill tone={TONE[n.data]}>{state(n.data)}</Pill>
    </Box>
  );
  const processRow = (p: NavNode) => (
    <Box key={p.id}>
      <LinkButton onClick={() => select(p.id)}>{p.title}</LinkButton>
      {lights(p)}
    </Box>
  );

  let detail: ReactNode;
  if (!selected) {
    const top = nav.columns[2].map(id => nav.nodes.get(id)!);
    const gaps = procs.filter(p => p.kind === 'proc' && lightOf(p, 'both') === 'bad');
    detail = (
      <>
        <Kpis
          items={[
            { label: t('cn.kpi.processes'), value: top.length },
            { label: t('cn.kpi.critical'), value: top.filter(p => p.process?.criticality === 'critical').length },
            { label: t('cn.kpi.checkGaps'), value: top.filter(p => p.check === 'bad').length, tone: top.some(p => p.check === 'bad') ? 'bad' : undefined },
            { label: t('cn.kpi.dataGaps'), value: top.filter(p => p.data === 'bad').length, tone: top.some(p => p.data === 'bad') ? 'bad' : undefined },
            { label: t('cn.kpi.apps'), value: nav.columns[4].length },
            { label: t('cn.kpi.volumes'), value: nav.columns[5].length },
          ]}
        />
        <Card title={t('cn.first')} sub={t('cn.first.sub')}>
          {gaps.length ? (
            <Rows>
              {[...gaps.slice(0, 8).map(processRow), gaps.length > 8 ? <Typography key="more" variant="caption" color="text.secondary">{t('cn.more', { n: gaps.length - 8 })}</Typography> : null]}
            </Rows>
          ) : (
            <Typography color="text.secondary">{t('cn.first.none')}</Typography>
          )}
        </Card>
      </>
    );
  } else {
    const page = pageOf(selected);
    const p = selected.process;
    const above = [...threadOf(nav, selected.id)].map(id => nav.nodes.get(id)!).filter(n => n.col < selected.col && n.col < 3).sort((a, b) => a.col - b.col);
    const needs = p ? (
      <Facts
        labelWidth={170}
        items={[
          [t('cn.needs.criticality'), <CritPill key="c" value={p.criticality} />],
          [t('cn.needs.rpo'), p.requirement.rpo ?? '—'],
          [t('cn.needs.rto'), p.requirement.rto ?? '—'],
          [t('cn.needs.retention'), p.requirement.retention ?? '—'],
          [t('cn.needs.belongs'), <Box key="b" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{above.map((n, i) => <span key={n.id}>{i ? '› ' : ''}<LinkButton onClick={() => select(n.id)}>{n.title}</LinkButton></span>)}</Box>],
        ]}
      />
    ) : (
      <>
        <Facts
          labelWidth={170}
          items={[
            [t('cn.needs.tightest'), t('cn.needs.tightest.value', { rpo: span(tightest('rpo')), rto: span(tightest('rto')) })],
            [t('cn.needs.count'), procs.length],
          ]}
        />
        <Rows>{[...procs.slice(0, 7).map(processRow), procs.length > 7 ? <Typography key="more" variant="caption" color="text.secondary">{t('cn.more', { n: procs.length - 7 })}</Typography> : null]}</Rows>
      </>
    );
    const withData = apps.filter(a => a.app);
    // an application against the tightest need of the processes on screen that use it
    const needOf = (a: NavNode) => procs.filter(x => x.down.includes(a.id)).reduce<number | undefined>((m, x) => (x.rpo !== undefined && (m === undefined || x.rpo < m) ? x.rpo : m), undefined) ?? a.rpo;
    const verdict = (a: NavNode) => {
      const need = needOf(a);
      const own = a.app!.state;
      if (own === 'noplan') return <Pill key="v" tone="neg">{t('dp.state.noplan')}</Pill>;
      // the gap first; then what is wrong with the copies themselves; then that they are enough
      if (need !== undefined && a.every !== undefined && a.every > need) return <Pill key="v" tone="neg">{t('cn.data.gap', { every: span(a.every), rpo: span(need) })}</Pill>;
      if (own !== 'ok') return <Pill key="v" tone={TONE[copiesLight(a.app, a.every, need)]}>{t(`dp.state.${own}`)}</Pill>;
      if (need === undefined || a.every === undefined) return <Pill key="v" tone="neu">{t('cn.data.noNeed')}</Pill>;
      return <Pill key="v" tone="pos">{t('cn.data.meets', { rpo: span(need) })}</Pill>;
    };
    let dataBody: ReactNode;
    if (!nav.dataKnown) dataBody = <Typography color="text.secondary">{t('cn.data.unknown')}</Typography>;
    else if (!withData.length) dataBody = <Typography color="text.secondary">{t('cn.data.none')}</Typography>;
    else {
      dataBody = (
        <Table
          head={[t('cn.data.col.app'), t('cn.data.col.plan'), t('cn.data.col.every'), t('cn.data.col.snapshot'), t('cn.data.col.backup'), t('cn.data.col.need'), '']}
          rows={withData.map(a => [
            <Box key="a">
              <LinkButton onClick={() => select(a.id)}>{a.title}</LinkButton>
              <Typography variant="caption" color="text.secondary" component="div">
                {t('cn.data.volumes', { n: a.app!.volumes.length, size: size(a.app!.volumeBytes, lang) })}
              </Typography>
            </Box>,
            a.app!.plan === 'none' ? t('dp.plan.none') : protection.data?.plans[a.app!.plan]?.title ?? a.app!.plan,
            a.every === undefined ? t('cn.data.noSchedule') : t('cn.data.every', { every: span(a.every) }),
            when(a.app!.lastSnapshot, t, lang),
            when(a.app!.lastBackup, t, lang),
            verdict(a),
            <LinkButton key="l" onClick={() => lose(a.id)}>{t('cn.lose.short')}</LinkButton>,
          ])}
        />
      );
    }
    detail = (
      <>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.sheet, px: 2.25, py: 1.75 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">{t(`cn.kind.${selected.kind}`)}</Typography>
            <Typography variant="h4" component="h2" sx={{ overflowWrap: 'anywhere' }}>{selected.title}</Typography>
            {selected.description && <Typography sx={{ mt: 0.5, maxWidth: '70ch' }}>{selected.description}</Typography>}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {selected.kind !== 'dig' && lights(selected)}
            {page && <Button component={Link} to={page} variant="outlined" size="small">{t('cn.open')}</Button>}
            {(selected.kind === 'app' || selected.kind === 'data') && <Button variant="contained" size="small" onClick={() => lose(selected.id)}>{t('cn.lose')}</Button>}
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 2fr)' }, alignItems: 'start' }}>
          <Card title={t('cn.needs')} sub={t('cn.needs.sub')}>{needs}</Card>
          <Card title={t('cn.data')} sub={t('cn.data.sub')}>{dataBody}</Card>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Card title={t('cn.dig')} sub={t('cn.dig.sub')}>
              <Typography sx={{ maxWidth: '90ch' }}>{t('cn.dig.open')}</Typography>
              {apps.length > 0 && (
                <Rows>
                  {apps.slice(0, 12).map(a => (
                    <Box key={a.id}>
                      <span>{a.title}</span>
                      <Typography variant="caption" color="text.secondary">{a.line ? t('cn.dig.line', { line: a.line }) : t('cn.dig.noLine')}</Typography>
                    </Box>
                  ))}
                </Rows>
              )}
              <Box>
                <Button component={Link} to="/console/continuity" variant="outlined" size="small">{t('cn.dig.link')}</Button>
              </Box>
            </Card>
          </Box>
        </Box>
      </>
    );
  }

  const lostNode = lost ? nav.nodes.get(lost) : undefined;
  let lossText = '';
  if (loss && lostNode) {
    if (!loss.app) lossText = t('cn.loss.unknown');
    else if (loss.every === undefined) lossText = t('cn.loss.noCopies');
    else if (loss.rpo !== undefined) lossText = t(loss.every > loss.rpo ? 'cn.loss.gap' : 'cn.loss.meets', { every: span(loss.every), rpo: span(loss.rpo) });
    if (loss.app?.lastBackup) lossText += ` ${t('cn.loss.lastBackup', { when: when(loss.app.lastBackup, t, lang) })}`;
  }
  const crumb = (label: string, kind: string | undefined, on: boolean, go: () => void) => (
    <Box
      component="button"
      type="button"
      key={`${kind}-${label}`}
      aria-current={on ? 'true' : undefined}
      onClick={go}
      sx={{
        all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'inline-flex', gap: 0.75, alignItems: 'baseline', px: 1.25, py: 0.5, borderRadius: 999, fontSize: 13, lineHeight: '20px', maxWidth: 260,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: `1px solid ${on ? rq.primary : rq.control}`, bgcolor: on ? rq.primary : rq.sheet, color: on ? rq.onPrimary : rq.ink,
        '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 },
      }}
    >
      {kind && <Box component="small" sx={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', opacity: 0.75 }}>{kind}</Box>}
      {label}
    </Box>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Box sx={{ mb: -2.5 }}>{head}</Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box component="nav" aria-label={t('cn.trail')} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          {crumb(t('cn.all'), undefined, !trail.length, () => { setTour(undefined); setLost(undefined); setTrail([]); })}
          {trail.map((id, i) => {
            const n = nav.nodes.get(id)!;
            return [<Box key={`sep-${id}`} component="span" aria-hidden sx={{ color: rq.control }}>›</Box>, crumb(n.title, t(`cn.kind.${n.kind}`), i === trail.length - 1, () => { setTour(undefined); setLost(undefined); setTrail(trail.slice(0, i + 1)); })];
          })}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 12px', alignItems: 'center' }}>
          <Segmented label={t('cn.lens')} options={[['both', t('cn.lens.both')], ['check', t('cn.lens.check')], ['data', t('cn.lens.data')]]} value={lens} onChange={setLens} />
          <Autocomplete
            id="cn-jump"
            size="small"
            sx={{ width: 300, maxWidth: '100%' }}
            options={options}
            value={null}
            blurOnSelect
            getOptionLabel={o => o.title}
            groupBy={o => t(`cn.kind.${o.kind}`)}
            filterOptions={(all, s) => {
              const q = s.inputValue.trim().toLowerCase();
              return q ? all.filter(o => o.title.toLowerCase().includes(q)).slice(0, 30) : [];
            }}
            noOptionsText={t('cn.jump')}
            onChange={(_, v) => {
              if (!v) return;
              setTour(undefined);
              setLost(undefined);
              setTrail([v.id]);
            }}
            renderOption={(props, o) => (
              <li {...props} key={o.id}>
                {o.title}
              </li>
            )}
            renderInput={p => <TextField {...p} label={t('cn.jump')} />}
          />
          <Button variant="outlined" onClick={() => (tour ? setTour(undefined) : startTour())}>{t(tour ? 'cn.tour.stop' : 'cn.tour.play')}</Button>
        </Box>
      </Box>
      <Box ref={scroll} sx={STAGE} role="group" aria-label={t('cn.map')}>
        <div className="cn-stage" style={{ width: placed.width, height: placed.height }}>
          <svg className="cn-links" width={placed.width} height={placed.height} aria-hidden>
            {placed.links.map(l => {
              const hit = !!loss && loss.hit.has(l.from) && loss.hit.has(l.to);
              const lit = !!hl && inHl(l.from) && inHl(l.to);
              const cls = ['cn-link', hit ? 'hit' : l.light];
              if (!hit && ((trail.length > 0 && !hl) || lit)) cls.push('flow');
              if (hl && !lit) cls.push('dim');
              return <path key={l.key} className={cls.join(' ')} d={l.d} style={{ d: `path("${l.d}")` } as CSSProperties} />;
            })}
          </svg>
          {placed.columns.map((c, i) => (
            <div key={KINDS[i]} className="cn-head" style={{ left: c.x, width: c.w }}>
              <b>{t(`cn.col.${KINDS[i]}`)}</b>
              <span>{c.gaps ? t('cn.col.gaps', { n: c.count, gaps: c.gaps }) : c.count}</span>
            </div>
          ))}
          {placed.boxes.map(box)}
          {caption && <div className="cn-caption" role="status">{caption}</div>}
        </div>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center', mt: -1 }}>
        {(['ok', 'warn', 'bad', 'na'] as Light[]).map(l => (
          <Box key={l} sx={{ display: 'inline-flex', gap: 0.875, alignItems: 'center', fontSize: 13 }}>
            <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: { ok: rq.positive, warn: rq.warning, bad: rq.negative, na: rq.control }[l] }} />
            {t(`cn.legend.${l}`)}
          </Box>
        ))}
        <Typography variant="caption" color="text.secondary">{t('cn.legend.note')}</Typography>
      </Box>
      {loss && lostNode && (
        <Box role="status" sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', bgcolor: rq.neg.bg, color: rq.neg.fg, borderRadius: '8px', px: 2, py: 1.5 }}>
          <Box sx={{ flex: '1 1 420px', minWidth: 0 }}>
            <b>{t('cn.loss.title', { name: lostNode.title })}</b> {t('cn.loss.reach', { processes: loss.processes, domains: loss.domains, critical: loss.critical })} {lossText}
          </Box>
          <Button variant="outlined" size="small" color="inherit" onClick={() => setLost(undefined)}>{t('cn.loss.end')}</Button>
        </Box>
      )}
      {detail}
    </Box>
  );
};
