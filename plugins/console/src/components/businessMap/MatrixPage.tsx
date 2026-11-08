import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { choose, EmptyState, Kpis, Pill, TitleRow, type Tone } from '../ui';
import { BusinessMapTabs } from './BusinessMapTabs';
import { NamespacePicker } from './DashboardParts';
import { useBusinessData, useNamespaceParam } from './dashboardData';
import { formatMinutes, needsOf } from './glassModel';
import { buildMatrix, type Cell, type Column, exerciseBody, type Verdict, whatIf } from './matrixModel';

const critTone: Record<string, Tone> = { critical: 'neg', important: 'warn', standard: 'neu' };
const verdictTone: Record<Verdict, Tone> = { spare: 'pos', 'no-margin': 'warn', breach: 'neg', unknown: 'neu' };
const fmt = (m: number | undefined) => (m === undefined ? '—' : formatMinutes(m));

type Saved = { state: 'idle' | 'saving' | 'done' | 'error'; url?: string; number?: number; error?: string };

/**
 * Business map › Matrix: processes (by domain) × the platform services and framework lines they depend on through
 * their applications; what if some platform services fail (a rehearsal: nothing changes in the cluster), and
 * "Save as exercise", which opens a pull request with the exercise in the continuity plan of the customer.
 */
export const BusinessMatrixPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [namespace, setNamespace] = useNamespaceParam();
  const data = useBusinessData(namespace);
  const [failed, setFailed] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<Saved>({ state: 'idle' });
  const [now] = useState(() => Date.now());
  const { graph, map } = data;
  const matrix = useMemo(() => (graph && map ? buildMatrix(graph, map, now) : undefined), [graph, map, now]);
  const rehearsal = useMemo(() => (graph && matrix ? whatIf(graph, matrix, failed) : undefined), [graph, matrix, failed]);

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('bmd.crumb'), '/console/business-map'], [t('bmd.matrix.title')]];
  const title = namespace ? `${t('bmd.matrix.title')} · ${namespace}` : t('bmd.matrix.title');
  if (data.loading) return <Progress />;
  if (!map || !graph || !matrix || !rehearsal) {
    return (
      <Box>
        <TitleRow crumbs={crumbs} title={title} />
        <BusinessMapTabs />
        <WarningPanel title={t('bmd.noMap')} message={data.error} />
      </Box>
    );
  }
  const down = new Set(failed);
  const stopped = new Set(rehearsal.stopped.map(p => p.ref));
  const toggle = (id: string) => {
    setFailed(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]));
    setSaved({ state: 'idle' });
  };
  const platform = matrix.columns.filter(c => c.family === 'platform');
  const development = matrix.columns.filter(c => c.family === 'development');
  // one namespace to save the exercise in: the one picked, or the only one of the map
  const exerciseNs = namespace ?? (map.namespaces.length === 1 ? map.namespaces[0] : undefined);

  const save = async () => {
    if (!exerciseNs) return;
    setSaved({ state: 'saving' });
    try {
      const res = await fetch(`${await discovery.getBaseUrl('business-map')}/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exerciseBody(exerciseNs, rehearsal, note)),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer.error?.message ?? answer.error ?? `${res.status} ${res.statusText}`);
      setSaved({ state: 'done', url: answer.pull?.url, number: answer.pull?.number });
    } catch (e) {
      setSaved({ state: 'error', error: (e as Error).message });
    }
  };

  const cellView = (c: Cell | undefined, col: Column) => {
    if (!c) return null;
    if (down.has(col.id)) return <Pill tone="neg">{t('bmd.mx.failed')}</Pill>;
    if (c.family === 'platform') {
      const tone = choose<Tone>([[c.check === 'meets', 'pos'], [c.check === 'rto', 'warn'], [c.check === 'rpo', 'neg']], 'neu');
      const label = choose<string>([[c.check === 'rpo', `RPO ${fmt(col.rpo)}`], [c.check === 'rto', `RTO ${fmt(col.rto)}`]], t(`bmd.check.${c.check}`));
      return <Pill tone={tone}>{label}</Pill>;
    }
    const tone = choose<Tone>([[c.support === 'supported', 'pos'], [c.support === 'ending', 'warn']], 'neg');
    return <Pill tone={tone}>{t(`bmd.fw.${c.support}`)}</Pill>;
  };
  const head = (col: Column) => (
    <Box component="th" scope="col" key={col.id} sx={{ verticalAlign: 'bottom', textAlign: 'left', minWidth: 120, bgcolor: col.family === 'development' ? 'action.hover' : undefined }}>
      <Box sx={{ display: 'grid', gap: 0.5 }}>
        <b>{col.label}</b>
        <Box component="small" sx={{ color: 'text.secondary', fontWeight: 400 }}>
          {col.family === 'platform' ? `${col.tier ?? '—'} · ${fmt(col.rpo)} / ${fmt(col.rto)}` : `${t('bmd.mx.line')} · ${col.until ?? t(`bmd.fw.${col.support ?? 'supported'}`)}`}
        </Box>
        {col.family === 'platform' ? (
          <Button size="small" variant={down.has(col.id) ? 'contained' : 'outlined'} color={down.has(col.id) ? 'error' : 'inherit'} disableElevation aria-pressed={down.has(col.id)} onClick={() => toggle(col.id)} sx={{ justifySelf: 'start', minWidth: 0, py: 0, px: 1 }}>
            {down.has(col.id) ? t('bmd.mx.failedX') : t('bmd.mx.failIt')}
          </Button>
        ) : (
          <Box component="small" sx={{ color: 'text.secondary', fontWeight: 400 }}>
            {t('bmd.mx.buildTime')}
          </Box>
        )}
      </Box>
    </Box>
  );
  const cols = [...platform, ...development];
  const lane = (label: string, items: string[], bad?: boolean) => (
    <Box sx={{ display: 'grid', gap: 0.5, alignContent: 'start', minWidth: 0 }}>
      <Box sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</Box>
      {items.length ? (
        items.map(x => (
          <Pill key={x} tone={bad ? 'neg' : 'neu'} plain>
            {x}
          </Pill>
        ))
      ) : (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          —
        </Box>
      )}
    </Box>
  );
  const downNames = rehearsal.failed.map(c => c.label).join(' + ');

  return (
    <Box>
      <TitleRow crumbs={crumbs} title={title} sub={t('bmd.matrix.sub')} actions={<NamespacePicker namespaces={map.namespaces} value={namespace} onChange={setNamespace} />} />
      <BusinessMapTabs />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', py: 1.5, fontSize: 12 }}>
        <Pill tone="pos">{t('bmd.lg.meets')}</Pill>
        <Pill tone="warn">{t('bmd.lg.rtoGap')}</Pill>
        <Pill tone="neg">{t('bmd.lg.rpoGap')}</Pill>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {t('bmd.mx.legend')}
        </Box>
      </Box>
      {!matrix.groups.some(gr => gr.rows.length) || !cols.length ? (
        <EmptyState title={t('bmd.noProcesses')}>{t('bmd.mx.empty')}</EmptyState>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 2 }}>
          <Box sx={{ flex: '999 1 640px', minWidth: 0, overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: '8px' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, '& th, & td': { p: 1, borderBottom: 1, borderColor: 'divider' } }}>
              <thead>
                <tr>
                  <th />
                  {platform.length > 0 && (
                    <Box component="th" scope="colgroup" colSpan={platform.length} sx={{ textAlign: 'left', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
                      {t('bmd.mx.platform')}
                    </Box>
                  )}
                  {development.length > 0 && (
                    <Box component="th" scope="colgroup" colSpan={development.length} sx={{ textAlign: 'left', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary', bgcolor: 'action.hover' }}>
                      {t('bmd.mx.development')}
                    </Box>
                  )}
                </tr>
                <tr>
                  <Box component="th" scope="col" sx={{ textAlign: 'left', verticalAlign: 'bottom' }}>
                    {t('bmd.mx.process')}
                  </Box>
                  {cols.map(head)}
                </tr>
              </thead>
              <tbody>
                {matrix.groups.map(gr => (
                  <Fragment key={gr.ref || 'none'}>
                    <tr>
                      <Box component="td" colSpan={cols.length + 1} sx={{ fontWeight: 600, bgcolor: 'action.hover' }}>
                        {gr.title || t('bmd.noDomain')}
                      </Box>
                    </tr>
                    {gr.rows.map(r => {
                      const needs = needsOf(r.process);
                      return (
                        <Box component="tr" key={r.ref} sx={{ bgcolor: stopped.has(r.ref) ? rq.warn.bg : undefined }}>
                          <Box component="th" scope="row" sx={{ textAlign: 'left', fontWeight: 400 }}>
                            <Box sx={{ display: 'grid', gap: 0.5 }}>
                              <span>{r.process.title}</span>
                              <Box component="small" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', color: 'text.secondary' }}>
                                <Pill tone={critTone[r.process.criticality] ?? 'neu'}>{t(`bmd.crit.${r.process.criticality}`)}</Pill>
                                {t('bmd.mx.needs', { rpo: fmt(needs.rpo), rto: fmt(needs.rto) })}
                              </Box>
                            </Box>
                          </Box>
                          {cols.map(col => (
                            <td key={col.id}>{cellView(r.cells.get(col.id), col)}</td>
                          ))}
                        </Box>
                      );
                    })}
                  </Fragment>
                ))}
                <Box component="tr" sx={{ fontWeight: 600 }}>
                  <Box component="td" sx={{ textAlign: 'left' }}>
                    {t('bmd.mx.gaps')}
                  </Box>
                  {cols.map(col => {
                    const f = matrix.footer.get(col.id) ?? { deps: 0, gaps: 0 };
                    return <td key={col.id}>{t('bmd.mx.ofDeps', { gaps: f.gaps, deps: f.deps })}</td>;
                  })}
                </Box>
              </tbody>
            </Box>
          </Box>
          <Box component="aside" aria-label={t('bmd.mx.whatIf')} sx={{ flex: '1 0 300px', maxWidth: { md: 380 }, boxSizing: 'border-box', display: 'grid', gap: 1.5, alignContent: 'start' }}>
            <Typography variant="h6" component="h2">
              {failed.length ? t('bmd.mx.whatIfFails', { names: downNames }) : t('bmd.mx.whatIf')}
            </Typography>
            <Kpis
              items={[
                { label: t('bmd.mx.stop'), value: rehearsal.stopped.length, tone: rehearsal.stopped.length ? 'bad' : undefined },
                { label: t('bmd.mx.critical'), value: rehearsal.critical, tone: rehearsal.critical ? 'bad' : undefined },
                { label: t('bmd.mx.restore'), value: failed.length ? fmt(rehearsal.restore) : '—' },
              ]}
            />
            <Box aria-label={t('bmd.mx.chain')} sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, fontSize: 12 }}>
              {lane(t('bmd.mx.lane.failed'), rehearsal.failed.map(c => c.label), true)}
              {lane(t('bmd.mx.lane.apps'), rehearsal.applications)}
              {lane(t('bmd.mx.lane.processes'), rehearsal.stopped.map(p => p.title))}
              {lane(t('bmd.mx.lane.domains'), rehearsal.domains)}
            </Box>
            <Box sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>{t('bmd.mx.margins')}</Box>
            {rehearsal.margins.length ? (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}>
                {rehearsal.margins.map(m => (
                  <Box component="li" key={m.ref} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, border: 1, borderColor: 'divider', borderRadius: '8px', px: 1.25, py: 0.75, fontSize: 13 }}>
                    <span>{m.title}</span>
                    <Pill tone={verdictTone[m.verdict]}>{t(`bmd.mx.v.${m.verdict}`, { t: fmt(m.margin === undefined ? undefined : Math.abs(m.margin)) })}</Pill>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('bmd.mx.markFailed')}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {t('bmd.mx.rehearsal')}
            </Typography>
            <TextField size="small" label={t('bmd.mx.note')} value={note} onChange={e => setNote(e.target.value)} multiline minRows={2} disabled={!failed.length} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setFailed([]);
                  setSaved({ state: 'idle' });
                }}
              >
                {t('bmd.mx.clear')}
              </Button>
              <Button variant="contained" disableElevation size="small" disabled={!failed.length || !exerciseNs || saved.state === 'saving'} onClick={save}>
                {saved.state === 'saving' ? t('bmd.mx.saving') : t('bmd.mx.save')}
              </Button>
            </Box>
            {!exerciseNs && failed.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('bmd.mx.pickCustomer')}
              </Typography>
            )}
            {saved.state === 'done' && (
              <Typography variant="body2">
                {saved.url ? (
                  <>
                    {t('bmd.mx.saved')}{' '}
                    <a href={saved.url} target="_blank" rel="noreferrer">
                      {t('bmd.mx.pull', { n: saved.number ?? '' })}
                    </a>
                  </>
                ) : (
                  t('bmd.mx.saved')
                )}
              </Typography>
            )}
            {saved.state === 'error' && <WarningPanel severity="error" title={t('bmd.mx.notSaved')} message={saved.error} />}
          </Box>
        </Box>
      )}
    </Box>
  );
};
