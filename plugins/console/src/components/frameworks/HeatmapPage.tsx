import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { type RqTokens, useRq } from '../../theme/consoleTheme';
import { EmptyState, Row, Section, TitleRow, choose } from '../ui';
import { CHECKS, type Cell, type Lens, type Level, METRICS, type Metric, cell, isEventMetric, riskScore, weekly, weeklyCounts } from './heatmap';
import { type AppRow, type Stage, STAGES, behindOf, latestLines, statusOf } from './model';
import { argoName, entityPath, todayIso } from './shared';
import { useEvents, useFrameworksData, useWeekly } from './useFrameworksData';

const WEEKS = 10;
const LENSES: Lens[] = ['all', 'framework', 'security', 'quality', 'running'];

type Col = { key: string; label: string; source: string; to: string };
type HRow = { app: AppRow; ref: string; meta: string; cells: Cell[]; score: number };

const cellColour = (t: RqTokens, l: Level) => {
  if (l === null) return { bg: 'transparent', fg: t.muted, border: `1px dashed ${t.control}` };
  const c = [t.pos, t.neu, t.warn, t.neg][l];
  return { bg: c.bg, fg: c.fg, border: `1px solid ${t.sheet}` };
};

/**
 * Portal › Development › Application heatmap: the applications of a stage against the checks (or a metric over the
 * last 10 ISO weeks), worst row first. Every cell is a button with its value as text; the panel tells where the
 * value comes from and opens the tab of the instance that shows it.
 */
export const HeatmapPage = () => {
  const { t: tr } = useI18n();
  const t = useRq();
  const { loading, error, lines, apps, facts, health, entities } = useFrameworksData();
  const [mode, setMode] = useState<'checks' | 'weeks'>('checks');
  const [stage, setStage] = useState<Stage>('pro');
  const [lens, setLens] = useState<Lens>('all');
  const [metric, setMetric] = useState<Metric>('vulns');
  const [sel, setSel] = useState<{ row: string; col: number } | undefined>();
  const today = todayIso();
  /** a toggle changed: keep the value, drop the selected cell */
  const pick = <V,>(set: (v: V) => void, v: V | null) => {
    if (v === null) return;
    set(v);
    setSel(undefined);
  };

  const inStage = apps.filter(a => a.instances[stage]);
  const refs = useMemo(() => (mode === 'weeks' ? apps.filter(a => a.instances[stage]).map(a => a.instances[stage]!) : []), [mode, apps, stage]);
  const weeklyData = useWeekly(refs);
  const events = useEvents(mode === 'weeks' && isEventMetric(metric), refs, ref => argoName(ref, entities));
  const lineTitle = (a: AppRow) => lines.find(l => l.framework === a.framework && l.line === a.lines[stage])?.title ?? `${a.framework} ${a.lines[stage] ?? ''}`;

  const checks = CHECKS.filter(c => lens === 'all' || c.lens === lens);
  const cols: Col[] =
    mode === 'checks'
      ? checks.map(c => ({ key: c.id, label: tr(`hm.check.${c.id}`), source: c.source, to: c.to }))
      : weekly([], metric, WEEKS, today).map(w => ({ key: w.week, label: w.week, source: isEventMetric(metric) ? tr(`hm.source.${metric}`) : tr('hm.weeklySource'), to: '' }));

  const latest = latestLines(lines);
  const rows: HRow[] = inStage
    .map(a => {
      const ref = a.instances[stage]!;
      const cells =
        mode === 'checks'
          ? checks.map(c =>
              cell(c.id, facts.get(ref), {
                status: statusOf(a, stage, lines, today),
                behind: behindOf(a, stage, lines),
                health: health.get(argoName(ref, entities)),
                owner: a.owner,
                hasDocs: !!entities.get(ref)?.metadata.annotations?.['backstage.io/techdocs-ref'],
              }),
            )
          : choose<() => Array<{ text: string; level: Level }>>(
              [
                [metric === 'deploys', () => weeklyCounts(events.deploys.get(ref), 'deploys', WEEKS, today)],
                [metric === 'incidents', () => weeklyCounts(events.incidentsError ? undefined : events.incidents.get(ref), 'incidents', WEEKS, today)],
              ],
              () => weekly(weeklyData.series.get(ref) ?? [], metric, WEEKS, today, latest.get(a.framework)?.line),
            )().map(w => ({ text: w.text, level: w.level }));
      return { app: a, ref, meta: lineTitle(a), cells, score: riskScore(cells.map(c => c.level)) };
    })
    .sort((x, y) => y.score - x.score || x.app.application.localeCompare(y.app.application));

  const sums = cols.map((_, j) => `${rows.filter(r => r.cells[j].level === 3).length} / ${rows.filter(r => r.cells[j].level === 2).length}`);
  const levelLabel = (l: Level) => tr(l === null ? 'hm.level.na' : `hm.level.${l}`);

  // the panel: the selected cell, else the hottest one
  const picked = sel && rows.find(r => r.app.application === sel.row) && { row: rows.find(r => r.app.application === sel.row)!, col: sel.col };
  // rows are worst first: the first cell of the highest level wins
  const hot = rows.flatMap(r => r.cells.map((c, col) => ({ row: r, col, level: c.level ?? -1 }))).filter(x => x.level >= 2);
  const top = Math.max(-1, ...hot.map(x => x.level));
  const hottest = hot.find(x => x.level === top);
  const shown = picked && picked.col < cols.length ? picked : undefined;
  const crumbs: Array<[string, string?]> = [[tr('nav.portal'), '/console'], [tr('dev.development')], [tr('nav.heatmap')]];

  if (loading && !apps.length) return <Progress />;
  if (error) return <WarningPanel title={tr('dev.noCatalog')} message={error} />;

  const toggles = (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
      <ToggleButtonGroup size="small" exclusive value={mode} aria-label={tr('hm.view')} onChange={(_, v) => pick(setMode, v)}>
        <ToggleButton value="checks" sx={{ textTransform: 'none' }}>
          {tr('hm.checks')}
        </ToggleButton>
        <ToggleButton value="weeks" sx={{ textTransform: 'none' }}>
          {tr('hm.weeks')}
        </ToggleButton>
      </ToggleButtonGroup>
      <ToggleButtonGroup size="small" exclusive value={stage} aria-label={tr('dev.stage')} onChange={(_, v) => pick(setStage, v)}>
        {STAGES.map(s => (
          <ToggleButton key={s} value={s} sx={{ textTransform: 'none' }}>
            {s}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {mode === 'checks' ? (
        <ToggleButtonGroup size="small" exclusive value={lens} aria-label={tr('hm.lens')} onChange={(_, v) => pick(setLens, v)}>
          {LENSES.map(l => (
            <ToggleButton key={l} value={l} sx={{ textTransform: 'none' }}>
              {tr(`hm.lens.${l}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : (
        <ToggleButtonGroup size="small" exclusive value={metric} aria-label={tr('hm.metric')} onChange={(_, v) => pick(setMetric, v)}>
          {METRICS.map(m => (
            <ToggleButton key={m} value={m} sx={{ textTransform: 'none' }}>
              {tr(`hm.metric.${m}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
    </Box>
  );

  const th = { fontSize: 12, fontWeight: 500, color: t.muted, px: 0.5, py: 1, lineHeight: '14px', verticalAlign: 'bottom', textAlign: 'center' } as const;
  const grid = rows.length ? (
    <Box component="table" sx={{ width: '100%', minWidth: 240 + cols.length * 72, borderCollapse: 'collapse', fontSize: 13, '& td, & th': { borderBottom: `1px solid ${t.rule}` } }}>
      <thead>
        <tr>
          <Box component="th" sx={{ ...th, textAlign: 'left', px: 2.25 }}>
            {tr('dev.application')}
          </Box>
          {cols.map(c => (
            <Box component="th" key={c.key} scope="col" sx={{ ...th, width: 72 }}>
              {c.label}
            </Box>
          ))}
          <Box component="th" sx={{ ...th, textAlign: 'right', px: 2 }}>
            {mode === 'checks' ? tr('hm.risk') : tr('hm.weeksHot')}
          </Box>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.app.application}>
            <Box component="th" scope="row" sx={{ textAlign: 'left', fontWeight: 400, px: 2.25, py: 0.75, minWidth: 200 }}>
              <Link to={entityPath(r.ref)} style={{ fontWeight: 500 }}>
                {r.app.application}
              </Link>
              <Box component="span" sx={{ display: 'block', fontSize: 12, color: t.muted }}>
                {r.meta}
              </Box>
            </Box>
            {r.cells.map((c, j) => {
              const col = cols[j];
              const on = shown?.row === r && shown.col === j;
              const k = cellColour(t, c.level);
              return (
                <Box component="td" key={col.key} sx={{ p: 0.25 }}>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`${r.app.application}, ${col.label}: ${c.text || tr('hm.level.na')}`}
                    aria-pressed={on}
                    onClick={() => setSel({ row: r.app.application, col: j })}
                    sx={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minWidth: 64, height: 32, borderRadius: '4px', bgcolor: k.bg, color: k.fg, border: k.border, fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', outline: on ? `2px solid ${t.ink}` : undefined, outlineOffset: on ? '-2px' : undefined, '&:focus-visible': { outline: `2px solid ${t.data}`, outlineOffset: '-2px' } }}
                  >
                    {c.text}
                  </Box>
                </Box>
              );
            })}
            <Box component="td" sx={{ textAlign: 'right', px: 2, fontVariantNumeric: 'tabular-nums' }}>
              {r.score}
            </Box>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <Box component="th" scope="row" sx={{ ...th, textAlign: 'left', px: 2.25 }}>
            {tr('hm.redAmber')}
          </Box>
          {sums.map((s, j) => (
            <Box component="td" key={cols[j].key} sx={{ ...th, verticalAlign: 'middle' }}>
              {s}
            </Box>
          ))}
          <td />
        </tr>
      </tfoot>
    </Box>
  ) : (
    <EmptyState title={tr('hm.noApps', { stage })} />
  );

  const focus = shown ?? hottest;
  const panel = (
    <Section title={tr('hm.detail')}>
      {focus ? (
        <Box sx={{ display: 'grid', gap: 1 }}>
          {!shown && <Typography color="text.secondary">{tr('hm.pick')}</Typography>}
          <Typography variant="h6" component="p" sx={{ fontSize: 16 }}>
            {shown ? `${focus.row.app.application} · ${cols[focus.col].label}` : tr('hm.hottest', { app: focus.row.app.application, check: cols[focus.col].label, value: focus.row.cells[focus.col].text })}
          </Typography>
          <Box sx={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{focus.row.cells[focus.col].text || '—'}</Box>
          <Typography variant="body2" color="text.secondary">
            {mode === 'checks' ? tr('hm.measured', { stage, level: levelLabel(focus.row.cells[focus.col].level) }) : tr('hm.weekOf', { stage, week: cols[focus.col].label })}
            {mode === 'weeks' && ` ${tr(`hm.metricLong.${metric}`)}.`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {tr('hm.source', { source: cols[focus.col].source })}
          </Typography>
          <Box>
            <Button component={Link} to={entityPath(focus.row.ref, cols[focus.col].to)} variant="outlined" size="small">
              {tr('hm.openTab')}
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography color="text.secondary">{tr('hm.pick')}</Typography>
          <Typography variant="body2">{tr('hm.nothingHot')}</Typography>
        </Box>
      )}
    </Section>
  );

  const legend = (
    <Section title={tr('hm.scale')}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        {([0, 1, 2, 3, null] as Level[]).map(l => {
          const k = cellColour(t, l);
          return (
            <Box key={String(l)} component="span" sx={{ px: 1, height: 24, display: 'inline-flex', alignItems: 'center', borderRadius: '4px', bgcolor: k.bg, color: k.fg, border: k.border, fontSize: 12 }}>
              {levelLabel(l)}
            </Box>
          );
        })}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {tr('hm.scaleNote')}
      </Typography>
    </Section>
  );

  return (
    <>
      <TitleRow crumbs={crumbs} title={tr('nav.heatmap')} sub={tr('hm.sub')} />
      {toggles}
      <Row spans={[9, 3]}>
        <Section flush>
          {grid}
          {mode === 'weeks' && !weeklyData.loading && rows.length > 0 && rows.every(r => r.cells.every(c => !c.text)) && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2.25, py: 1.5 }}>
              {tr('hm.noWeeks')}
            </Typography>
          )}
          {mode === 'weeks' && metric === 'incidents' && events.incidentsError && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2.25, py: 1.5 }}>
              {tr('hm.incidentsNa')} ({events.incidentsError})
            </Typography>
          )}
        </Section>
        <Box sx={{ display: 'grid', gap: 3, '& > section': { mb: 0 } }}>
          {panel}
          {legend}
          <Section title={tr('hm.reading')}>
            <Typography variant="body2" color="text.secondary">
              {tr('hm.readingText')}
            </Typography>
          </Section>
        </Box>
      </Row>
      {(loading || (mode === 'weeks' && (weeklyData.loading || events.loading))) && <Progress />}
    </>
  );
};
