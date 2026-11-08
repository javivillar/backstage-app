import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { Attention, EmptyState, Kpis, Pill, Row, Section, TitleRow, type Tone, choose } from '../ui';
import { cell } from './heatmap';
import { type AppRow, type Line, type Stage, STAGES, behindOf, latestLines, statusOf } from './model';
import { Bar, Chips, Table, businessService, entityPath, factNum, levelTone, lineClass, linePath, mainInstance, statusLabel, statusTone, todayIso } from './shared';
import { useFrameworksData } from './useFrameworksData';

/** CRITICAL + HIGH of the framework layer of an instance; undefined when not known */
const fwVulns = (f?: Record<string, unknown>) => {
  const c = factNum(f, 'frameworkLayerCritical');
  const h = factNum(f, 'frameworkLayerHigh');
  return c === undefined || h === undefined ? undefined : c + h;
};

/** the lines of a framework on a time axis: today −1 month … +14 months, support end when it is a date */
const Timeline = ({ lines, apps, today }: { lines: Line[]; apps: AppRow[]; today: string }) => {
  const t = useRq();
  const { t: tr } = useI18n();
  const now = Date.parse(`${today}T00:00:00Z`);
  const d0 = new Date(now);
  const start = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 1, d0.getUTCDate());
  const end = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 14, d0.getUTCDate());
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - start) / (end - start)) * 100));
  const months = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i * 2, 1)));
  const latest = latestLines(lines);
  const shown = [...lines].sort((a, b) => a.framework.localeCompare(b.framework) || lines.indexOf(b) - lines.indexOf(a));
  const colour = { current: t.data, maintained: t.dataSoft, deprecated: t.warn.bg, experimental: t.neu.bg };
  const count = (l: Line) => apps.filter(a => a.framework === l.framework && STAGES.some(s => a.lines[s] === l.line)).length;
  return (
    <Box sx={{ display: 'grid', gap: 1, minWidth: 640 }}>
      <Box sx={{ display: 'flex', gap: 2, fontSize: 12, color: t.muted, flexWrap: 'wrap' }}>
        {(['current', 'maintained', 'deprecated'] as const).map(k => (
          <Box key={k} component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
            <Box component="span" aria-hidden sx={{ width: 14, height: 8, borderRadius: 2, bgcolor: colour[k], border: `1px solid ${t.border}` }} />
            {tr(`dev.lc.${k}`)}
          </Box>
        ))}
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
          <Box component="span" aria-hidden sx={{ width: 2, height: 12, bgcolor: t.negative }} />
          {tr('fw.today')}
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 1 }}>
        <span />
        <Box sx={{ position: 'relative', height: 16, fontSize: 11, color: t.muted }}>
          {months.map(m => (
            <Box key={m.toISOString()} component="span" sx={{ position: 'absolute', left: `${pct(m.getTime())}%`, whiteSpace: 'nowrap' }}>
              {m.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} {String(m.getUTCFullYear()).slice(2)}
            </Box>
          ))}
        </Box>
        {shown.map(l => {
          const k = lineClass(l, latest.get(l.framework) === l);
          const right = l.supportedUntil ? pct(Date.parse(`${l.supportedUntil}T00:00:00Z`)) : 100;
          const n = count(l);
          return (
            <Box key={l.ref} sx={{ display: 'contents' }}>
              <Box sx={{ fontSize: 14, display: 'flex', gap: 1, alignItems: 'baseline', minWidth: 0 }}>
                <Link to={linePath(l)} style={{ fontWeight: 500 }}>
                  {l.title}
                </Link>
                <Box component="span" sx={{ fontSize: 12, color: t.muted, whiteSpace: 'nowrap' }}>
                  {n === 1 ? tr('fw.app1') : tr('fw.appsN', { n })}
                </Box>
              </Box>
              <Box sx={{ position: 'relative', height: 26, borderRadius: '4px', bgcolor: t.raised }}>
                <Box sx={{ position: 'absolute', left: 0, width: `${right}%`, top: 3, bottom: 3, borderRadius: '4px', bgcolor: colour[k], border: `1px solid ${t.border}`, borderRight: l.supportedUntil ? undefined : `1px dashed ${t.control}` }} />
                <Box sx={{ position: 'absolute', left: `${pct(now)}%`, top: 0, bottom: 0, width: 2, bgcolor: t.negative }} aria-hidden />
                <Box component="span" sx={{ position: 'absolute', left: 8, top: 4, fontSize: 12, color: t.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'calc(100% - 16px)' }}>
                  {tr(`dev.lc.${k}`)} · {l.supportText || '—'}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

/** one card per framework: its applications, lines in use, framework-layer vulns, apps per line, what its latest line ships */
const FrameworkCard = ({ framework, lines, apps, facts, description, owner }: { framework: string; lines: Line[]; apps: AppRow[]; facts: Map<string, Record<string, unknown>>; description?: string; owner?: string }) => {
  const t = useRq();
  const { t: tr } = useI18n();
  const own = lines.filter(l => l.framework === framework);
  const latest = own[own.length - 1];
  const fwApps = apps.filter(a => a.framework === framework);
  const perLine = [...own].reverse().map(l => ({ l, n: fwApps.filter(a => STAGES.some(s => a.lines[s] === l.line)).length })).filter(x => x.n);
  const total = perLine.reduce((a, x) => a + x.n, 0);
  const known = fwApps.map(a => fwVulns(facts.get(mainInstance(a) ?? ''))).filter((n): n is number => n !== undefined);
  return (
    <Section title={own[0]?.frameworkTitle ?? framework} meta={latest && tr('fw.latest', { line: latest.line })}>
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {(description || owner) && (
          <Typography variant="body2" color="text.secondary">
            {description} {owner && tr('fw.owner', { owner: owner.replace(/^group:(default\/)?/, '') })}
          </Typography>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          {[
            [tr('fw.apps'), fwApps.length],
            [tr('fw.linesInUse'), perLine.length],
            [tr('fw.fwVulns'), known.length ? known.reduce((a, b) => a + b, 0) : 'n/a'],
          ].map(([k, v]) => (
            <Box key={String(k)} sx={{ display: 'grid' }}>
              <Typography variant="caption" color="text.secondary">
                {k}
              </Typography>
              <Box sx={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{v}</Box>
            </Box>
          ))}
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {tr('fw.appsByLine')}
          </Typography>
          {total ? (
            <Box sx={{ display: 'flex', height: 26, borderRadius: '4px', overflow: 'hidden', mt: 0.5, border: `1px solid ${t.border}` }}>
              {perLine.map(({ l, n }) => (
                <Box key={l.ref} title={`${l.title}: ${n}`} sx={{ flex: n, minWidth: 48, bgcolor: l === latest ? t.data : t.dataSoft, color: l === latest ? t.onPrimary : t.ink, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${t.sheet}`, whiteSpace: 'nowrap' }}>
                  {l.line} · {n}
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {tr('fw.noApps')}
            </Typography>
          )}
        </Box>
        {latest?.versions && (
          <Box sx={{ fontSize: 14 }}>
            <Box component="span" sx={{ color: t.muted }}>
              {tr('fw.ships', { line: latest.line })}{' '}
            </Box>
            <Chips items={latest.versions.split(',').map(s => s.trim()).filter(Boolean)} />
          </Box>
        )}
      </Box>
    </Section>
  );
};

/**
 * Portal › Development › Frameworks: the frameworks, their lines and lifecycle, which application runs which line in
 * each stage, the blocks they use and the vulnerabilities a framework patch would clear. Read-only.
 */
export const FrameworksPage = () => {
  const { t: tr } = useI18n();
  const t = useRq();
  const { loading, error, lines, apps, facts, entities } = useFrameworksData();
  const [fw, setFw] = useState('all');
  const [stage, setStage] = useState<Stage>('pro');
  const today = todayIso();
  const frameworks = useMemo(() => [...new Set(lines.map(l => l.framework))], [lines]);
  const titleOf = (f: string) => lines.find(l => l.framework === f)?.frameworkTitle ?? (f || '—');

  if (loading && !lines.length) return <Progress />;
  const crumbs: Array<[string, string?]> = [[tr('nav.portal'), '/console'], [tr('dev.development')], [tr('nav.frameworks')]];
  if (error) return <WarningPanel title={tr('dev.noCatalog')} message={error} />;
  if (!lines.length)
    return (
      <>
        <TitleRow crumbs={crumbs} title={tr('nav.frameworks')} sub={tr('fw.sub')} />
        <EmptyState title={tr('fw.noLines')}>{tr('fw.noLinesText')}</EmptyState>
      </>
    );

  const used = new Set(apps.flatMap(a => STAGES.filter(s => a.lines[s]).map(s => `${a.framework} ${a.lines[s]}`)));
  const inPro = apps.filter(a => a.instances.pro);
  const onLatest = inPro.filter(a => statusOf(a, 'pro', lines, today).kind === 'latest');
  const ending = inPro.filter(a => statusOf(a, 'pro', lines, today).kind === 'ending');
  const lineOf = (a: AppRow, s: Stage) => lines.find(l => l.framework === a.framework && l.line === a.lines[s]);

  const attention = [
    ...ending.map(a => {
      const st = statusOf(a, 'pro', lines, today);
      const l = lineOf(a, 'pro')!;
      return {
        tone: ((st.daysLeft ?? 0) < 92 ? 'neg' : 'warn') as Tone,
        label: statusLabel(st, 'pro', tr),
        what: tr('fw.att.runs', { app: a.application, line: l.title }),
        why: tr('fw.att.ends', { date: l.supportedUntil ?? '', n: st.daysLeft ?? 0 }),
        action: { label: tr('fw.att.openLine'), to: linePath(l) },
      };
    }),
    ...apps
      .filter(a => {
        const b = businessService(a, entities);
        return b.known && !b.title;
      })
      .map(a => ({ tone: 'warn' as Tone, label: tr('fw.att.noService'), what: a.application, why: tr('fw.att.noServiceWhy'), action: { label: tr('fw.att.openApp'), to: entityPath(mainInstance(a)!) } })),
  ];

  const rows = apps.filter(a => fw === 'all' || a.framework === fw);
  const blocks = [...new Set(apps.flatMap(a => a.blocks))].map(b => ({ b, n: apps.filter(a => a.blocks.includes(b)).length })).sort((x, y) => y.n - x.n || x.b.localeCompare(y.b));
  const latest = latestLines(lines);
  const fix = lines
    .filter(l => used.has(`${l.framework} ${l.line}`))
    .map(l => {
      const per = apps
        .filter(a => a.framework === l.framework)
        .map(a => STAGES.filter(s => a.lines[s] === l.line).map(s => fwVulns(facts.get(a.instances[s] ?? ''))).filter((n): n is number => n !== undefined))
        .filter(v => v.length)
        .map(v => Math.max(...v));
      return { l, known: per.length > 0, sum: per.reduce((a, b) => a + b, 0), affected: per.filter(n => n > 0).length };
    })
    .reverse();
  const clean = [...latest.values()].filter(l => fix.some(x => x.l === l && x.known && x.sum === 0));

  return (
    <>
      <TitleRow
        crumbs={crumbs}
        title={tr('nav.frameworks')}
        sub={tr('fw.sub')}
        actions={
          <Button component={Link} to="/console/development/python-framework-app" variant="outlined" size="small">
            {tr('dev.newApp')}
          </Button>
        }
      />
      <Kpis
        items={[
          { label: tr('fw.kpi.frameworks'), value: frameworks.length },
          { label: tr('fw.kpi.linesInUse'), value: used.size },
          { label: tr('fw.kpi.applications'), value: apps.length },
          { label: tr('fw.kpi.latestPro'), value: tr('fw.kpi.nOfM', { n: onLatest.length, m: inPro.length }), tone: onLatest.length < inPro.length ? 'bad' : 'good' },
          { label: tr('fw.kpi.ending'), value: tr('fw.kpi.apps', { n: ending.length }), tone: ending.length ? 'bad' : undefined },
        ]}
      />
      {attention.length > 0 && (
        <Section title={tr('fw.attention')}>
          <Attention items={attention} />
        </Section>
      )}
      <Row spans={frameworks.map(() => 6)}>
        {frameworks.map(f => {
          const e = entities.get(`component:default/${f}`);
          return <FrameworkCard key={f} framework={f} lines={lines} apps={apps} facts={facts} description={e?.metadata.description} owner={e?.spec?.owner as string | undefined} />;
        })}
      </Row>
      <Section title={tr('fw.timeline')} meta={tr('fw.timelineMeta')}>
        <Timeline lines={lines} apps={apps} today={today} />
      </Section>
      <Section
        title={tr('fw.who')}
        flush
        action={
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <ToggleButtonGroup size="small" exclusive value={fw} aria-label={tr('dev.framework')} onChange={(_, v) => v && setFw(v)}>
              <ToggleButton value="all" sx={{ textTransform: 'none' }}>
                {tr('dev.all')}
              </ToggleButton>
              {frameworks.map(f => (
                <ToggleButton key={f} value={f} sx={{ textTransform: 'none' }}>
                  {titleOf(f)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <ToggleButtonGroup size="small" exclusive value={stage} aria-label={tr('dev.stage')} onChange={(_, v) => v && setStage(v)}>
              {STAGES.map(s => (
                <ToggleButton key={s} value={s} sx={{ textTransform: 'none' }}>
                  {s}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        }
        foot={<span>{tr('fw.whoFoot')}</span>}
      >
        {rows.length ? (
          <Table head={[tr('dev.application'), tr('fw.businessService'), tr('dev.framework'), 'dev', 'pre', 'pro', tr('fw.statusIn', { stage }), tr('dev.blocks'), tr('fw.fwVulnsCol'), '']} minWidth={980}>
            {rows.map(a => {
              const st = statusOf(a, stage, lines, today);
              const ref = a.instances[stage];
              const v = cell('frameworkVulns', ref ? facts.get(ref) : undefined, { status: st, behind: behindOf(a, stage, lines), hasDocs: true });
              const svc = businessService(a, entities);
              const open = ref ?? mainInstance(a);
              return (
                <tr key={a.application}>
                  <td>
                    <Box sx={{ fontWeight: 500 }}>{a.application}</Box>
                    <Box sx={{ fontSize: 12, color: t.muted }}>{(a.owner ?? '').replace(/^group:(default\/)?/, '')}</Box>
                  </td>
                  <td>{choose<string>([[svc.title, svc.title ?? ''], [!svc.known, a.system ?? '']], tr('dev.none'))}</td>
                  <td>{titleOf(a.framework)}</td>
                  {STAGES.map(s => (
                    <td key={s}>
                      <Pill tone={statusTone(statusOf(a, s, lines, today))} plain>
                        {a.lines[s] ?? '—'}
                      </Pill>
                    </td>
                  ))}
                  <td>
                    <Pill tone={statusTone(st)}>{statusLabel(st, stage, tr)}</Pill>
                  </td>
                  <td>
                    <Chips items={a.blocks} />
                  </td>
                  <td>{ref ? <Pill tone={levelTone(v.level)}>{v.text}</Pill> : '—'}</td>
                  <td>{open && <Link to={entityPath(open)}>{tr('dev.open')}</Link>}</td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState title={tr('fw.noMatch')} />
        )}
      </Section>
      <Typography variant="h5" component="h2" sx={{ mb: 1.5 }}>
        {tr('fw.free')}
      </Typography>
      <Row spans={[6, 6]}>
        <Section title={tr('fw.blocks')}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {tr('fw.blocksMeta')}
          </Typography>
          {blocks.length ? (
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              {blocks.map(x => (
                <Bar key={x.b} label={x.b} value={x.n} max={apps.length} />
              ))}
            </Box>
          ) : (
            <EmptyState title={tr('fw.noBlocks')} />
          )}
        </Section>
        <Section title={tr('fw.fixOnce')} flush foot={clean.length ? <span>{clean.map(l => tr('fw.noneOn', { line: l.title })).join(' ')}</span> : undefined}>
          <Typography variant="body2" color="text.secondary" sx={{ px: 2.25, mb: 1.5 }}>
            {tr('fw.fixOnceMeta')}
          </Typography>
          <Table head={[tr('fw.line'), tr('fw.vulns'), tr('fw.appsAffected')]} minWidth={360}>
            {fix.map(x => (
              <tr key={x.l.ref}>
                <td>
                  <Link to={linePath(x.l)}>{x.l.title}</Link>
                </td>
                <td>{x.known ? <Pill tone={choose<Tone>([[x.sum === 0, 'pos'], [x.sum > 1, 'neg']], 'warn')}>{x.sum}</Pill> : 'n/a'}</td>
                <td>{x.known ? x.affected : '—'}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </Row>
      {loading && <Progress />}
    </>
  );
};
