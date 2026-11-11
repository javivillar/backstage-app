import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useMemo, useState } from 'react';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { choose, EmptyState, Kpis, Pill, TitleRow, type Tone } from '../ui';
import { BusinessMapTabs } from './BusinessMapTabs';
import { type Dot, NamespacePicker, useDots } from './DashboardParts';
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
  const dots = useDots();
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

  // the matrix is compact so it is seen whole: a cell is a coloured mark (its words in the tooltip), a column is as
  // wide as its mark and its name is written upwards
  const mark = (dot: Dot, label: string, text?: string) => (
    <Box component="span" role="img" aria-label={label} title={label} sx={{ display: 'inline-grid', placeItems: 'center', width: 18, height: 18, borderRadius: '5px', bgcolor: dots[dot], color: rq.sheet, fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
      {text}
    </Box>
  );
  const cellView = (c: Cell | undefined, col: Column) => {
    if (!c) return null;
    if (down.has(col.id)) return mark('bad', `${col.label}: ${t('bmd.mx.failed')}`, '✕');
    if (c.family === 'platform') {
      const dot = choose<Dot>([[c.check === 'meets', 'ok'], [c.check === 'rto', 'warn'], [c.check === 'rpo', 'bad']], 'none');
      const label = choose<string>([[c.check === 'rpo', `RPO ${fmt(col.rpo)}`], [c.check === 'rto', `RTO ${fmt(col.rto)}`]], t(`bmd.check.${c.check}`));
      return mark(dot, `${col.label}: ${label}`);
    }
    const dot = choose<Dot>([[c.support === 'supported', 'ok'], [c.support === 'ending', 'warn']], 'bad');
    return mark(dot, `${col.label}: ${t(`bmd.fw.${c.support}`)}`);
  };
  // opacity 1: the classic theme fades every table header, and a see-through sticky header shows the rows behind it
  const sticky = { position: 'sticky', top: 0, zIndex: 2, opacity: 1 } as const;
  const head = (col: Column) => {
    const isDown = down.has(col.id);
    const about = col.family === 'platform' ? `${col.tier ?? '—'} · RPO ${fmt(col.rpo)} / RTO ${fmt(col.rto)}` : `${t('bmd.mx.line')} · ${col.until ?? t(`bmd.fw.${col.support ?? 'supported'}`)} · ${t('bmd.mx.buildTime')}`;
    return (
      <Box component="th" scope="col" key={col.id} title={`${col.label} · ${about}`} sx={{ ...sticky, verticalAlign: 'bottom', textAlign: 'center', width: 40, minWidth: 34, px: '2px !important', bgcolor: col.family === 'development' ? rq.raised : rq.sheet }}>
        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', maxHeight: 180, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, fontWeight: 600, color: isDown ? rq.negative : undefined }}>
            {col.label}
          </Box>
          {col.family === 'platform' ? (
            <Box
              component="button"
              type="button"
              aria-pressed={isDown}
              aria-label={`${isDown ? t('bmd.mx.failedX') : t('bmd.mx.failIt')}: ${col.label}`}
              onClick={() => toggle(col.id)}
              sx={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: '6px', border: `1px solid ${isDown ? rq.negative : rq.control}`, bgcolor: isDown ? rq.negative : 'transparent', color: isDown ? rq.sheet : rq.muted, '&:hover': { bgcolor: isDown ? rq.negative : rq.raised }, '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 1 } }}
            >
              <PowerSettingsNew sx={{ fontSize: 14 }} />
            </Box>
          ) : (
            <Box sx={{ height: 22 }} />
          )}
        </Box>
      </Box>
    );
  };
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
        {(
          [
            ['ok', t('bmd.lg.meets')],
            ['warn', t('bmd.lg.rtoGap')],
            ['bad', t('bmd.lg.rpoGap')],
          ] as Array<[Dot, string]>
        ).map(([dot, text]) => (
          <Box component="span" key={dot} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, mr: 0.5 }}>
            {mark(dot, text)}
            {text}
          </Box>
        ))}
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {t('bmd.mx.legend')}
        </Box>
      </Box>
      {!matrix.groups.some(gr => gr.rows.length) || !cols.length ? (
        <EmptyState title={t('bmd.noProcesses')}>{t('bmd.mx.empty')}</EmptyState>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 2 }}>
          <Box sx={{ flex: '999 1 640px', minWidth: 0, overflow: 'auto', maxHeight: 'calc(100vh - 24px)', border: 1, borderColor: 'divider', borderRadius: '8px' }}>
            <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13, '& th, & td': { p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { textAlign: 'center' } }}>
              <thead>
                <tr>
                  <th />
                  {platform.length > 0 && (
                    <Box component="th" scope="colgroup" colSpan={platform.length} sx={{ textAlign: 'left', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
                      {t('bmd.mx.platform')}
                    </Box>
                  )}
                  {development.length > 0 && (
                    <Box component="th" scope="colgroup" colSpan={development.length} title={t('bmd.mx.development')} sx={{ textAlign: 'left', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary', bgcolor: 'action.hover', maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t('bmd.mx.development')}
                    </Box>
                  )}
                </tr>
                <tr>
                  <Box component="th" scope="col" sx={{ ...sticky, left: 0, zIndex: 3, bgcolor: rq.sheet, textAlign: 'left', verticalAlign: 'bottom', minWidth: 200 }}>
                    <Box sx={{ display: 'grid', gap: 0.75 }}>
                      <span>{t('bmd.mx.process')}</span>
                      {platform.length > 0 && (
                        <Box component="small" sx={{ height: 22, display: 'grid', alignItems: 'center', justifyContent: 'end', color: 'text.secondary', fontWeight: 400 }}>
                          {t('bmd.mx.failIt')} →
                        </Box>
                      )}
                    </Box>
                  </Box>
                  {cols.map(head)}
                </tr>
              </thead>
              <tbody>
                {matrix.groups.map(gr => (
                  <Fragment key={gr.ref || 'none'}>
                    <tr>
                      <Box component="td" colSpan={cols.length + 1} sx={{ fontWeight: 600, bgcolor: 'action.hover', textAlign: 'left !important' }}>
                        <Box component="span" sx={{ position: 'sticky', left: 8 }}>{gr.title || t('bmd.noDomain')}</Box>
                      </Box>
                    </tr>
                    {gr.rows.map(r => {
                      const needs = needsOf(r.process);
                      return (
                        <Box component="tr" key={r.ref} sx={{ bgcolor: stopped.has(r.ref) ? rq.warn.bg : undefined }}>
                          <Box component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: stopped.has(r.ref) ? rq.warn.bg : rq.sheet, textAlign: 'left', fontWeight: 400 }}>
                            <Box sx={{ display: 'grid', gap: 0.5 }}>
                              <span>{r.process.title}</span>
                              <Box component="small" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', color: 'text.secondary' }}>
                                <Pill tone={critTone[r.process.criticality] ?? 'neu'}>{t(`bmd.crit.${r.process.criticality}`)}</Pill>
                                {t('bmd.mx.needs', { rpo: fmt(needs.rpo), rto: fmt(needs.rto) })}
                              </Box>
                            </Box>
                          </Box>
                          {cols.map(col => (
                            <Box component="td" key={col.id} sx={{ px: '2px !important' }}>
                              {cellView(r.cells.get(col.id), col)}
                            </Box>
                          ))}
                        </Box>
                      );
                    })}
                  </Fragment>
                ))}
                <Box component="tr" sx={{ fontWeight: 600 }}>
                  <Box component="td" sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: rq.sheet, textAlign: 'left !important' }}>
                    {t('bmd.mx.gaps')}
                  </Box>
                  {cols.map(col => {
                    const f = matrix.footer.get(col.id) ?? { deps: 0, gaps: 0 };
                    return (
                      <Box component="td" key={col.id} title={`${col.label}: ${t('bmd.mx.ofDeps', { gaps: f.gaps, deps: f.deps })}`} sx={{ px: '2px !important', fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: f.gaps ? rq.negative : 'text.secondary' }}>
                        {f.gaps}/{f.deps}
                      </Box>
                    );
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
