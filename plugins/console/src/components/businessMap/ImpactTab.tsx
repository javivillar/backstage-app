import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { Progress } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { type ReactNode, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { type ImpactData, type ImpactProcess, type LineService, useImpact } from '../../businessMap';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { EmptyState, Id, Kpis, Pill } from '../ui';
import {
  consolePath,
  gapText,
  impactSummary,
  lineProgress,
  nameOf,
  nextStep,
  supportOf,
  supportTone,
  throughText,
} from './businessMapModel';
import { CritPill, pair, ResultPill } from './parts';

/** The types whose page has the tab: what a business process can stand on, and the framework lines and services. */
const WITH_IMPACT = new Set(['business-service', 'business-application', 'application-instance', 'platform-service', 'framework-line', 'development-service', 'service']);

/** Whether an entity page shows the tab Impact on the business. */
export function hasBusinessImpact(e: Entity): boolean {
  const kind = e.kind.toLowerCase();
  if (kind === 'resource') return true;
  return (kind === 'component' || kind === 'system') && WITH_IMPACT.has(String(e.spec?.type ?? ''));
}

const Note = ({ tone, children }: { tone: 'neg' | 'warn' | 'neu'; children: ReactNode }) => {
  const rq = useRq();
  const c = { neg: rq.neg, warn: rq.warn, neu: rq.neu }[tone];
  return (
    <Box role="status" sx={{ bgcolor: c.bg, color: c.fg, borderRadius: '8px', px: 2, py: 1.5, mb: 2.5 }}>
      {children}
    </Box>
  );
};

/** The processes table of a run-time element: strictest first, the way down and the check. */
const RunTimeTable = ({ processes }: { processes: ImpactProcess[] }) => {
  const { t } = useI18n();
  return (
    <Table size="small">
      <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600, padding: '10px 16px' }}>{t('bmi.caption')}</caption>
      <TableHead>
        <TableRow>
          <TableCell>{t('bmi.process')}</TableCell>
          <TableCell>{t('bm.customer')}</TableCell>
          <TableCell>{t('bm.criticality')}</TableCell>
          <TableCell>{t('bmp.needs')}</TableCell>
          <TableCell>{t('bmi.through')}</TableCell>
          <TableCell>{t('bmp.result')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {processes.map(p => (
          <TableRow key={p.ref} hover>
            <TableCell>
              <Link to={consolePath(p.ref)}>{p.title}</Link>
            </TableCell>
            <TableCell>{p.namespace}</TableCell>
            <TableCell>
              <CritPill value={p.criticality} />
            </TableCell>
            <TableCell>{pair(p.needs)}</TableCell>
            <TableCell>{p.through.length ? <Id>{throughText(p.through)}</Id> : t('bmi.direct')}</TableCell>
            <TableCell>
              <ResultPill result={p.result} text={p.gap?.length ? p.gap.map(gapText).join(' · ') : undefined} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

/** A run-time element: platform service, business service or application, instance, block. */
const RunTimeImpact = ({ impact }: { impact: ImpactData }) => {
  const { t } = useI18n();
  const s = impactSummary(impact);
  if (!s.count) {
    return (
      <EmptyState title={t('bmi.none')}>
        {t('bmi.none.hint')}
      </EmptyState>
    );
  }
  const d = impact.delivers;
  return (
    <>
      {s.gaps > 0 && (
        <Note tone="neg">
          <b>{t('bmi.gapNote', { n: s.gaps })}</b>{' '}
          {t('bmi.gapNote.why', { rpo: d?.rpo ?? '—', rto: d?.rto ?? '—', needRpo: s.needs.rpo ?? '—', needRto: s.needs.rto ?? '—' })}
        </Note>
      )}
      <Kpis
        items={[
          { label: t('bmi.kpi.processes'), value: s.count },
          { label: t('bmi.kpi.strictest'), value: s.strictest ? t(`bm.crit.${s.strictest}`) : '—' },
          { label: t('bmi.kpi.delivers'), value: pair(d) },
          { label: t('bmi.kpi.needs'), value: pair(s.needs), tone: s.gaps ? 'bad' : undefined },
        ]}
      />
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', overflowX: 'auto', mb: 2 }}>
        <RunTimeTable processes={impact.processes} />
      </Box>
      <Typography variant="caption" color="text.secondary" component="p">
        {t('bmi.foot')}
      </Typography>
    </>
  );
};

/** The lines a service is measured against: the line of the page, or (development service) the line of its pro stage. */
const linesFor = (impact: ImpactData, s: LineService) =>
  impact.role === 'framework-line' ? [impact.entity] : s.stages.filter(x => x.stage === 'pro' && x.line).map(x => x.line!);

/** A framework line or a development service: who runs on it, by stage, the processes above, the next step. */
const LineImpact = ({ impact }: { impact: ImpactData }) => {
  const { t } = useI18n();
  const today = useMemo(() => new Date(), []);
  const services = impact.services ?? [];
  const rows = new Map(impact.processes.map(p => [p.ref, p]));
  const own = supportOf(impact.support ?? {}, today);
  const progress = lineProgress(services, [impact.entity]);
  const inPro = impact.role === 'framework-line' ? progress.inPro : services.length;
  const strict = impact.processes.filter(p => p.criticality !== 'standard').length;
  const critical = impact.processes.filter(p => p.criticality === 'critical').length;
  const customers = new Set(impact.processes.map(p => p.namespace)).size;
  const lines = impact.support?.lines ?? [];
  const until = impact.support?.supportedUntil;
  return (
    <>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
        {impact.role === 'framework-line' && <Pill tone={supportTone(own.state)}>{t(`bm.support.${own.state}`)}</Pill>}
        {impact.role === 'framework-line' && until && (
          <Pill tone={own.state === 'supported' ? 'neu' : 'warn'} plain>
            {own.monthsLeft !== undefined ? t('bmi.until.left', { date: until, n: own.monthsLeft }) : t('bmi.until', { date: until })}
          </Pill>
        )}
        {impact.role === 'development-service' &&
          lines.map(l => (
            <Pill key={l.ref} tone={supportTone(supportOf(l, today).state)} plain>
              {l.version ?? nameOf(l.ref)} · {t(`bm.support.${supportOf(l, today).state}`)}
            </Pill>
          ))}
      </Box>
      {inPro > 0 && (
        <Note tone={own.state === 'supported' ? 'neu' : 'warn'}>
          <b>{t('bmi.line.note', { n: inPro, m: strict })}</b>
          {impact.role === 'framework-line' && own.state !== 'supported' && until ? ` ${t('bmi.line.unpatched', { date: until })}` : ''}
        </Note>
      )}
      <Kpis
        items={[
          { label: t('bmi.kpi.services'), value: inPro },
          { label: t('bmi.kpi.above'), value: impact.processes.length, note: critical ? t('bmi.kpi.critical', { n: critical }) : undefined },
          { label: t('bmi.kpi.customers'), value: customers },
          impact.role === 'framework-line'
            ? { label: t('bmi.kpi.moved'), value: t('bmi.kpi.movedOf', { n: progress.moved, total: progress.inPro }) }
            : { label: t('bmi.kpi.lines'), value: lines.length },
        ]}
      />
      {services.length ? (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', overflowX: 'auto', mb: 2 }}>
          <Table size="small">
            <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600, padding: '10px 16px' }}>{t('bmi.line.caption')}</caption>
            <TableHead>
              <TableRow>
                <TableCell>{t('bmi.service')}</TableCell>
                <TableCell>{t('bmi.perStage')}</TableCell>
                <TableCell>{t('bmi.processesPro')}</TableCell>
                <TableCell>{t('bm.customer')}</TableCell>
                <TableCell>{t('bmi.next')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {services.map(s => {
                const step = nextStep(s, linesFor(impact, s));
                const above = s.processes.map(r => rows.get(r)).filter((x): x is ImpactProcess => !!x);
                return (
                  <TableRow key={s.ref} hover>
                    <TableCell>
                      <Link to={consolePath(s.ref)} style={{ fontWeight: 600 }}>
                        {s.title}
                      </Link>
                      {s.owner && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('bmi.team', { team: nameOf(s.owner) })}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
                        {s.stages.map(x => (
                          <Pill key={x.instance} tone={x.line ? supportTone(supportOf(x, today).state) : 'neu'} plain>
                            {x.stage} {x.version ?? '—'}
                          </Pill>
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'grid', gap: 0.5 }}>
                        {above.length
                          ? above.map(p => (
                              <Box key={p.ref} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                                <CritPill value={p.criticality} />
                                <Link to={consolePath(p.ref)}>{p.title}</Link>
                              </Box>
                            ))
                          : '—'}
                      </Box>
                    </TableCell>
                    <TableCell>{[...new Set(above.map(p => p.namespace))].join(', ') || '—'}</TableCell>
                    <TableCell>{t(step.key, step.vars)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <EmptyState title={t('bmi.line.none')} />
      )}
      <Typography variant="caption" color="text.secondary" component="p">
        {t('bmi.line.foot')}
      </Typography>
    </>
  );
};

/** The tab Impact on the business of any entity, by ref (the System page draws it without an entity context). */
export const ImpactView = ({ entityRef }: { entityRef: string }) => {
  const { t } = useI18n();
  const { loading, data, error } = useImpact(entityRef);
  if (loading && !data) return <Progress />;
  if (error || !data) {
    return (
      <EmptyState tone="neg" title={t('bm.error')}>
        {error}
      </EmptyState>
    );
  }
  return data.role === 'run-time' ? <RunTimeImpact impact={data} /> : <LineImpact impact={data} />;
};

/** Impact on the business: the tab of a Component page of the console (EntityLayout.Route /impact). */
export const ImpactTab = () => {
  const { entity } = useEntity();
  return <ImpactView entityRef={stringifyEntityRef(entity)} />;
};
