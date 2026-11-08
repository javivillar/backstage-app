import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { Pill, TitleRow, type Tone } from '../ui';
import { useTemplateTask } from '../templateTask';
import {
  cardsOf,
  type Change,
  type ChangeFilter,
  csvHeaders,
  emptyImport,
  ENTITY_TYPES,
  filterChanges,
  firstBadStep,
  hasProblems,
  IMPORT_SOURCES,
  IMPORT_STEPS,
  importBlocker,
  importProblems,
  importValues,
  type ImportForm,
  type Issue,
  MAPPING_FIELDS,
  namespacesOf,
  NO_FILTER,
  PAGE_SIZES,
  pageOf,
  type Preview,
  previewBody,
  previewKey,
  type PreviewState,
  REQUIRED_MAPPING,
  rootsOf,
  withFileName,
} from './businessMapFormsModel';
import { CRITICALITIES } from './businessMapModel';
import { FormCard, RefPicker, StepsBar, TaskPanel, useEntities, useProblemText, WhoMayNotice } from './formParts';

/**
 * Portal › Business continuity › Import business model (mockup board Import): source and file, the columns of an own
 * layout, the preview of what the pull request would change (POST /api/business-map/import/preview), then the
 * template business-model-import runs here and its pull request is shown. The file is read in the browser as a data
 * URL and sent to the template; it is never stored in git.
 */

const TEMPLATE = 'business-model-import';
const CHANGE_TONE: Record<Change['kind'], Tone> = { new: 'pos', changed: 'neu', review: 'warn' };
const issueText = (t: (k: string, v?: Record<string, string | number>) => string, i: Issue) => (i.row ? t('bmf.row', { row: i.row, message: i.message }) : i.message);

const readAs = (file: File, how: 'url' | 'text') =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    if (how === 'url') r.readAsDataURL(file);
    else r.readAsText(file.slice(0, 65536));
  });

/** The preview of the import, as step 3 of the mockup. */
const PreviewView = ({ preview, namespace, skipErrors, onSkip }: { preview: Preview; namespace: string; skipErrors: boolean; onSkip: (v: boolean) => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  const [filter, setFilter] = useState<ChangeFilter>(NO_FILTER);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const roots = useMemo(() => rootsOf(preview.changes), [preview.changes]);
  const matching = useMemo(() => filterChanges(preview.changes, filter), [preview.changes, filter]);
  const shown = pageOf(matching, page, size);
  const total = preview.changes.length;
  const refine = (f: Partial<ChangeFilter>) => {
    setFilter(x => ({ ...x, ...f }));
    setPage(0);
  };
  const errors = preview.errors.length;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h5" component="h2">
        {t('bmf.preview.title', { namespace })}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.25 }}>
        {cardsOf(preview.counts).map(c => (
          <Box key={c.key} sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', px: 1.75, py: 1.25 }}>
            <Box sx={{ fontSize: 20, lineHeight: '26px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c.positive ? rq.positive : rq.ink }}>{c.value}</Box>
            <Typography variant="caption" color="text.secondary">
              {t(c.key, c.vars)}
            </Typography>
          </Box>
        ))}
      </Box>
      {errors > 0 && (
        <Alert severity={skipErrors ? 'info' : 'warning'} role="status">
          <b>{t('bmf.preview.errors', { n: errors })}</b> {skipErrors ? t('bmf.preview.skipped') : t('bmf.preview.fix')}
        </Alert>
      )}
      {errors + preview.warnings.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}>
          {preview.errors.map((i, n) => (
            <Box component="li" key={`e${n}`} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', border: `1px solid ${rq.rule}`, borderRadius: '8px', px: 1.25, py: 1 }}>
              <Pill tone="neg" plain>
                {t('bmf.error')}
              </Pill>
              <Typography variant="body2">{issueText(t, i)}</Typography>
            </Box>
          ))}
          {preview.warnings.map((i, n) => (
            <Box component="li" key={`w${n}`} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', border: `1px solid ${rq.rule}`, borderRadius: '8px', px: 1.25, py: 1 }}>
              <Pill tone="warn" plain>
                {t('bmf.warning')}
              </Pill>
              <Typography variant="body2">{issueText(t, i)}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {total > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.25 }} role="search" aria-label={t('bmf.filter')}>
          <TextField select size="small" label={t('bmf.filter.kind')} value={filter.kind} onChange={e => refine({ kind: e.target.value as ChangeFilter['kind'] })}>
            <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
            {(['new', 'changed', 'review'] as const).map(k => (
              <MenuItem key={k} value={k}>
                {t(`bmf.kind.${k}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('bmf.filter.type')} value={filter.type} onChange={e => refine({ type: e.target.value as ChangeFilter['type'] })}>
            <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
            {ENTITY_TYPES.map(k => (
              <MenuItem key={k} value={k}>
                {t(`bmf.type.${k}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('bmf.filter.root')} value={filter.root} onChange={e => refine({ root: e.target.value })} disabled={!roots.length}>
            <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
            {roots.map(r => (
              <MenuItem key={r.id} value={r.id}>
                {`${r.id} ${r.title}`}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" type="search" label={t('bmf.filter.text')} value={filter.text} onChange={e => refine({ text: e.target.value })} />
        </Box>
      )}
      {total > 0 && matching.length > 0 && (
        <Box sx={{ overflowX: 'auto', border: `1px solid ${rq.border}`, borderRadius: '8px' }}>
          <Table size="small" aria-label={t('bmf.changes')}>
            <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600 }}>
              {matching.length < total ? t('bmf.changes.matching', { n: matching.length, total }) : t('bmf.changes.all', { total })}
            </caption>
            <TableHead>
              <TableRow>
                <TableCell>{t('bmf.change')}</TableCell>
                <TableCell>{t('bmf.filter.type')}</TableCell>
                <TableCell>{t('bmf.id')}</TableCell>
                <TableCell>{t('bmf.process')}</TableCell>
                <TableCell>{t('bmf.what')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.rows.map((c, i) => (
                <TableRow key={`${c.kind}-${c.id}-${i}`}>
                  <TableCell>
                    <Pill tone={CHANGE_TONE[c.kind]} plain>
                      {t(`bmf.kind.${c.kind}`)}
                    </Pill>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.type ? t(`bmf.type.${c.type}`) : '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap', pl: c.level ? `${16 + 12 * Math.min(c.level - 1, 4)}px` : undefined }}>{c.id}</TableCell>
                  <TableCell>
                    {c.title}
                    {c.description && (
                      <Typography variant="caption" color="text.secondary" component="div" title={c.description} sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: 480 }}>
                        {c.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{c.what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={matching.length}
            page={shown.page}
            rowsPerPage={size}
            rowsPerPageOptions={PAGE_SIZES}
            onPageChange={(_e, n) => setPage(n)}
            onRowsPerPageChange={e => {
              setSize(Number(e.target.value));
              setPage(0);
            }}
            labelRowsPerPage={t('bmf.page.size')}
            labelDisplayedRows={({ from, to, count }) => t('bmf.page.shown', { from, to, count })}
          />
        </Box>
      )}
      {total > 0 && matching.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('bmf.filter.none')}
        </Typography>
      )}
      {total === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('bmf.preview.nothing', { namespace })}
        </Typography>
      )}
      {errors > 0 && <FormControlLabel control={<Checkbox checked={skipErrors} onChange={e => onSkip(e.target.checked)} />} label={t('bmf.skipErrors', { n: errors })} />}
    </Box>
  );
};

export const ImportModelPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const discovery = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [params] = useSearchParams();
  const [form, setForm] = useState<ImportForm>(() => emptyImport(params.get('ns') ?? ''));
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | undefined>(undefined);
  const { task, start, reset } = useTemplateTask(TEMPLATE);
  const groups = useEntities({ kind: 'Group' });
  const models = useEntities({ kind: 'ReferenceModel' });
  const domains = useEntities({ kind: 'Domain', 'spec.type': 'business-area' });
  const customers = useMemo(() => namespacesOf(domains.items), [domains.items]);

  const stepId = IMPORT_STEPS[step];
  const problems = importProblems(form, stepId);
  const problem = useProblemText(problems, tried);
  const set = (patch: Partial<ImportForm>) => setForm(f => ({ ...f, ...patch }));
  const body = useMemo(() => previewBody(form), [form]);
  const key = body ? previewKey(body) : '';

  // the preview, on the last step, each time its input changes
  useEffect(() => {
    if (stepId !== 'preview' || !body) return undefined;
    let alive = true;
    const k = key;
    setPreview({ key: k, state: 'loading' });
    (async () => {
      let answer: PreviewState;
      try {
        const res = await fetchApi.fetch(`${await discovery.getBaseUrl('business-map')}/import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as Preview & { error?: string };
        answer = res.ok ? { key: k, state: 'done', preview: json } : { key: k, state: 'failed', error: json.error ?? `${res.status} ${res.statusText}` };
      } catch (e) {
        answer = { key: k, state: 'failed', error: (e as Error).message };
      }
      if (alive) setPreview(answer);
    })();
    return () => {
      alive = false;
    };
    // body changes with key (key is its fingerprint)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId, key, discovery, fetchApi]);

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('nav.businessMap'), '/console/business-map'], [t('bm.import')]];
  const head = <TitleRow crumbs={crumbs} title={t('bm.import')} sub={t('bmf.import.sub')} />;

  if (task.id) {
    return (
      <>
        {head}
        <TaskPanel id={task.id} title={t('bmf.import.running', { namespace: form.namespace })} onAgain={reset} />
      </>
    );
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReading(true);
    try {
      const url = await readAs(file, 'url');
      const text = /\.csv$/i.test(file.name) ? await readAs(file, 'text') : '';
      setHeaders(text ? csvHeaders(text) : []);
      set({ file: withFileName(url, file.name), fileName: file.name, fileSize: file.size });
    } finally {
      setReading(false);
    }
  };

  const next = () => {
    if (hasProblems(problems)) {
      setTried(true);
      return;
    }
    setTried(false);
    setStep(step + 1);
  };
  const blocker = importBlocker(form, preview);
  const run = () => {
    const bad = firstBadStep(form);
    if (bad) {
      setStep(IMPORT_STEPS.indexOf(bad));
      setTried(true);
      return;
    }
    if (!blocker) start(importValues(form, preview));
  };

  const sourceStep = (
    <>
      <Typography variant="h5" component="h2">
        {t('bmf.import.kind')}
      </Typography>
      <Box role="radiogroup" aria-label={t('bmf.import.kind')} sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 1.25 }}>
        {IMPORT_SOURCES.map(s => {
          const on = form.source === s;
          return (
            <Box
              key={s}
              component="button"
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ source: s })}
              sx={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'grid', gap: 0.5, border: `1px solid ${on ? rq.data : rq.border}`, boxShadow: on ? `0 0 0 2px ${rq.dataSoft}` : 'none', borderRadius: '8px', px: 1.75, py: 1.5, bgcolor: rq.sheet, '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 } }}
            >
              <Box component="b" sx={{ fontWeight: 600 }}>
                {t(`bmf.source.${s}`)}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t(`bmf.source.${s}.text`)}
              </Typography>
            </Box>
          );
        })}
      </Box>
      {form.source === 'bia' && (
        <Alert severity="info">
          <b>{t('bmf.bia.cycle.title')}</b> {t('bmf.bia.cycle')}{' '}
          <Link to={`/console/business-map${form.namespace ? `?ns=${encodeURIComponent(form.namespace)}` : ''}`}>{t('bmf.bia.download')}</Link>
        </Alert>
      )}
      <Box sx={{ border: `2px dashed ${problem('file') ? rq.negative : rq.border}`, borderRadius: '8px', p: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', minWidth: 0 }}>
          <Box aria-hidden sx={{ width: 36, height: 44, borderRadius: '6px', bgcolor: rq.dataSoft, color: rq.data, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 10, fontWeight: 600 }}>
            {/\.csv$/i.test(form.fileName ?? '') ? 'CSV' : 'XLSX'}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{form.fileName ?? t('bmf.file.none')}</Box>
            <Typography variant="caption" color={problem('file') ? 'error' : 'text.secondary'}>
              {problem('file') ?? (form.fileSize !== undefined ? t('bmf.file.size', { kb: Math.max(1, Math.round(form.fileSize / 1024)) }) : t('bmf.file.hint'))}
            </Typography>
          </Box>
        </Box>
        <Button variant="outlined" size="small" component="label" disabled={reading}>
          {form.file ? t('bmf.file.other') : t('bmf.file.choose')}
          <input hidden type="file" accept=".xlsx,.csv" onChange={onFile} />
        </Button>
      </Box>
      {reading && <LinearProgress />}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 1.5 }}>
        <TextField size="small" label={t('bmf.sheet')} value={form.sheet} onChange={e => set({ sheet: e.target.value })} helperText={t('bmf.sheet.hint')} />
        <Autocomplete
          freeSolo
          size="small"
          options={customers}
          value={form.namespace}
          inputValue={form.namespace}
          onInputChange={(_, v) => set({ namespace: v.trim() })}
          renderInput={p => <TextField {...p} required label={t('bmf.namespace')} error={!!problem('namespace')} helperText={problem('namespace') ?? t('bmf.namespace.hint')} />}
        />
        {form.source !== 'bia' && (
          <>
            <RefPicker label={t('bmf.defaultOwner')} items={groups.items} loading={groups.loading} value={form.owner} onChange={v => set({ owner: v })} help={t('bmf.defaultOwner.hint')} />
            <RefPicker label={t('bmf.keepFrom')} items={models.items} loading={models.loading} value={form.keepFrom} onChange={v => set({ keepFrom: v })} help={t('bmf.keepFrom.hint')} />
          </>
        )}
        {form.source === 'apqc' && (
          <>
            <TextField size="small" label={t('bmf.industry')} value={form.industry} onChange={e => set({ industry: e.target.value })} error={!!problem('industry')} helperText={problem('industry') ?? t('bmf.industry.hint')} />
            <TextField size="small" required label={t('bmf.version')} value={form.version} onChange={e => set({ version: e.target.value })} error={!!problem('version')} helperText={problem('version')} />
          </>
        )}
      </Box>
    </>
  );

  const listId = 'bm-import-columns';
  const mappingStep = (
    <>
      <Box>
        <Typography variant="h5" component="h2">
          {t('bmf.map.title')}
        </Typography>
        <Typography color="text.secondary">{t(`bmf.map.note.${form.source}`)}</Typography>
      </Box>
      {form.source === 'own' && (
        <>
          {headers.length > 0 && (
            <datalist id={listId}>
              {headers.map(h => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
          <Box sx={{ overflowX: 'auto', border: `1px solid ${rq.border}`, borderRadius: '8px' }}>
            <Table size="small" aria-label={t('bmf.map.title')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('bmf.map.field')}</TableCell>
                  <TableCell>{t('bmf.map.column')}</TableCell>
                  <TableCell>{t('bmf.map.becomes')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {MAPPING_FIELDS.map(f => (
                  <TableRow key={f}>
                    <TableCell>
                      {t(`bmf.field.${f}`)}
                      {REQUIRED_MAPPING.includes(f) && (
                        <Box component="span" sx={{ color: rq.negative, fontSize: 11, ml: 0.5 }}>
                          {t('bmf.required')}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={form.mapping[f] ?? ''}
                        onChange={e => set({ mapping: { ...form.mapping, [f]: e.target.value } })}
                        error={!!problem(`mapping.${f}`)}
                        helperText={problem(`mapping.${f}`)}
                        inputProps={{ 'aria-label': t('bmf.map.columnFor', { field: t(`bmf.field.${f}`) }), list: headers.length ? listId : undefined }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {t(`bmf.becomes.${f}`)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="h6" component="h3">
              {t('bmf.values.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('bmf.values.hint')}
            </Typography>
            {form.criticalityValues.map((r, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 1, alignItems: 'start' }}>
                <TextField
                  size="small"
                  label={t('bmf.values.value')}
                  value={r.value}
                  onChange={e => set({ criticalityValues: form.criticalityValues.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                />
                <TextField
                  select
                  size="small"
                  label={t('bmf.values.means')}
                  value={r.means}
                  error={!!problem(`value.${i}`)}
                  helperText={problem(`value.${i}`)}
                  onChange={e => set({ criticalityValues: form.criticalityValues.map((x, j) => (j === i ? { ...x, means: e.target.value as typeof x.means } : x)) })}
                >
                  {CRITICALITIES.map(c => (
                    <MenuItem key={c} value={c}>
                      {t(`bm.crit.${c}`)}
                    </MenuItem>
                  ))}
                </TextField>
                <Button size="small" aria-label={t('bmf.remove')} onClick={() => set({ criticalityValues: form.criticalityValues.filter((_, j) => j !== i) })}>
                  ×
                </Button>
              </Box>
            ))}
            <Box>
              <Button size="small" onClick={() => set({ criticalityValues: [...form.criticalityValues, { value: '', means: '' }] })}>
                {t('bmf.values.add')}
              </Button>
            </Box>
          </Box>
        </>
      )}
    </>
  );

  let previewStep = <LinearProgress />;
  if (preview?.state === 'failed') previewStep = <Alert severity="error">{t('bmf.preview.failed', { error: preview.error ?? '' })}</Alert>;
  else if (preview?.state === 'done' && preview.preview && preview.key === key) {
    previewStep = <PreviewView preview={preview.preview} namespace={form.namespace} skipErrors={form.skipErrors} onSkip={v => set({ skipErrors: v })} />;
  }

  const content = [sourceStep, mappingStep, previewStep][step];
  const last = step === IMPORT_STEPS.length - 1;
  const nextLabel = step === 0 ? t('bmf.next.map') : t('bmf.next.preview');
  return (
    <>
      {head}
      <WhoMayNotice />
      <StepsBar labels={IMPORT_STEPS.map(s => t(`bmf.import.step.${s}`))} at={step} onGo={i => setStep(i)} />
      {task.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('bmf.task.notStarted', { error: task.error })}
        </Alert>
      )}
      <FormCard
        foot={
          <>
            <Button size="small" variant="outlined" disabled={step === 0} onClick={() => setStep(step - 1)}>
              {t('bmf.back')}
            </Button>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {last && blocker && (
                <Typography variant="caption" color="text.secondary">
                  {t(blocker.key, blocker.vars)}
                </Typography>
              )}
              {last ? (
                <Button size="small" variant="contained" disableElevation disabled={!!blocker || task.starting} onClick={run}>
                  {task.starting ? t('bmf.starting') : t('bmf.import.run')}
                </Button>
              ) : (
                <Button size="small" variant="contained" disableElevation onClick={next}>
                  {nextLabel}
                </Button>
              )}
            </Box>
          </>
        }
      >
        {content}
      </FormCard>
    </>
  );
};
