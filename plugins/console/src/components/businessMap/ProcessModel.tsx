import { configApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { type BpmnModel, modelOf, type PullAnswer, sameProcessName, teamNames, teamOfLane, useBpmn, useBusinessMapPost, useOrganisation } from '../../organisation';
import { useRq } from '../../theme/consoleTheme';
import { TONES } from '../Flow';
import { Table } from '../NetworkPage';
import { EmptyState, Id, Pill, Section, type Tone } from '../ui';
import { BPMN_VIEWER_PATH, type BpmnViewer, loadBpmnViewer, nameInFile } from './bpmnViewer';

/** A BPMN model drawn by the viewer: zoom, drag, and the step picked outlined. Says what it read once it is drawn. */
export const BpmnCanvas = ({ xml, picked, onPick, onModel, height = 460 }: { xml: string; picked?: string; onPick?: (id: string) => void; onModel: (m: BpmnModel | { error: string }) => void; height?: number }) => {
  const { t } = useI18n();
  const rq = useRq();
  const base = useApi(configApiRef).getOptionalString('app.baseUrl') ?? '';
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<BpmnViewer>();
  const last = useRef<string>();
  const [ready, setReady] = useState(false);
  // the callbacks change on every render of the page: the model is drawn once per file
  const told = useRef({ onModel, onPick });
  told.current = { onModel, onPick };
  useEffect(() => {
    let alive = true;
    setReady(false);
    loadBpmnViewer(base)
      .then(async Viewer => {
        if (!alive || !box.current) return;
        const v = new Viewer({ container: box.current });
        viewer.current = v;
        const { warnings } = await v.importXML(xml);
        if (!alive) return;
        v.get('canvas').zoom('fit-viewport', 'auto');
        const model = modelOf(v.get('elementRegistry').filter(() => true), nameInFile(v), warnings.length);
        v.get('eventBus').on('element.click', e => {
          if (model.steps.some(s => s.id === e.element.id)) told.current.onPick?.(e.element.id);
        });
        setReady(true);
        told.current.onModel(model);
      })
      .catch(e => alive && told.current.onModel({ error: (e as Error).message }));
    return () => {
      alive = false;
      viewer.current?.destroy();
      viewer.current = undefined;
      last.current = undefined;
    };
  }, [base, xml]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const canvas = v.get('canvas');
    if (last.current && v.get('elementRegistry').get(last.current)) canvas.removeMarker(last.current, 'rq-bpmn-picked');
    if (picked && v.get('elementRegistry').get(picked)) canvas.addMarker(picked, 'rq-bpmn-picked');
    last.current = picked;
  }, [picked, ready]);
  const zoom = (f: number) => {
    const c = viewer.current?.get('canvas');
    if (c) c.zoom(c.zoom() * f);
  };
  const tool = { all: 'unset', cursor: 'pointer', width: 30, height: 30, border: `1px solid ${rq.control}`, borderRadius: '6px', bgcolor: '#fff', color: '#121820', textAlign: 'center', fontSize: 16, lineHeight: '30px', '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 } } as const;
  return (
    // the diagram is always drawn on white: the viewer paints black lines
    <Box sx={{ position: 'relative', height, border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: '#fff', overflow: 'hidden', '& .rq-bpmn-picked .djs-visual > :first-of-type': { stroke: `${rq.data} !important`, strokeWidth: '3px !important' }, '& .djs-shape': { cursor: onPick ? 'pointer' : 'default' } }}>
      <Box ref={box} data-testid="bpmn-canvas" sx={{ position: 'absolute', inset: 0 }} />
      {ready && (
        <Box sx={{ position: 'absolute', right: 10, top: 10, display: 'grid', gap: 0.5 }}>
          <Box component="button" type="button" aria-label={t('bpmn.zoomIn')} onClick={() => zoom(1.25)} sx={tool}>
            +
          </Box>
          <Box component="button" type="button" aria-label={t('bpmn.zoomOut')} onClick={() => zoom(0.8)} sx={tool}>
            −
          </Box>
          <Box component="button" type="button" aria-label={t('bpmn.fit')} onClick={() => viewer.current?.get('canvas').zoom('fit-viewport', 'auto')} sx={tool}>
            ⤢
          </Box>
        </Box>
      )}
    </Box>
  );
};

const KIND_KEY = { person: 'bpmn.kind.person', automatic: 'bpmn.kind.automatic', process: 'bpmn.kind.process', step: 'bpmn.kind.step' } as const;

/** The steps of a model with the team of each one (its lane), marked when no team of the customer has that name. */
const Steps = ({ model, teams, picked, onPick }: { model: BpmnModel; teams: string[]; picked?: string; onPick: (id: string) => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  return (
    <Table
      head={[t('bpmn.col.step'), t('bpmn.col.kind'), t('bpmn.col.lane')]}
      rows={model.steps.map(s => [
        <Box key="s" component="button" type="button" aria-pressed={picked === s.id} onClick={() => onPick(s.id)} sx={{ all: 'unset', cursor: 'pointer', fontWeight: picked === s.id ? 600 : 400, color: picked === s.id ? rq.data : 'inherit', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 } }}>
          {s.name}
        </Box>,
        t(KIND_KEY[s.kind]),
        <Box key="l" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
          {s.lane ?? <Typography color="text.secondary">{t('bpmn.noLane')}</Typography>}
          {s.lane && teams.length > 0 && !teamOfLane(s.lane, teams) && (
            <Pill tone="warn" plain>
              {t('bpmn.noTeam')}
            </Pill>
          )}
        </Box>,
      ])}
    />
  );
};

type Check = { tone: Tone; label: string; text: string };
/** What the preview says of a file before it is imported. */
export function checksOf(model: BpmnModel, o: { title: string; teams: string[]; path: string }, t: (k: string, v?: Record<string, string | number>) => string): Check[] {
  const people = model.steps.filter(s => s.kind === 'person').length;
  const auto = model.steps.filter(s => s.kind === 'automatic').length;
  const out: Check[] = [{ tone: 'pos', label: t('bpmn.check.valid'), text: t('bpmn.check.validText', { steps: model.steps.length, people, auto, other: model.steps.length - people - auto, gateways: model.gateways, events: model.events }) }];
  if (model.warnings) out.push({ tone: 'warn', label: t('bpmn.check.warnings'), text: t('bpmn.check.warningsText', { n: model.warnings }) });
  if (!model.lanes.length) out.push({ tone: 'warn', label: t('bpmn.check.noLanes'), text: t('bpmn.check.noLanesText') });
  else if (o.teams.length) {
    const ok = model.lanes.filter(l => teamOfLane(l, o.teams));
    const ko = model.lanes.filter(l => !teamOfLane(l, o.teams));
    if (ok.length) out.push({ tone: 'pos', label: t('bpmn.check.matched', { n: ok.length }), text: t('bpmn.check.matchedText', { teams: ok.join(', ') }) });
    if (ko.length) out.push({ tone: 'warn', label: t('bpmn.check.unmatched', { n: ko.length }), text: t('bpmn.check.unmatchedText', { lanes: ko.join(', ') }) });
  }
  if (!sameProcessName(model.name, o.title)) out.push({ tone: 'warn', label: t('bpmn.check.otherName'), text: t('bpmn.check.otherNameText', { name: model.name ?? '', title: o.title }) });
  else out.push({ tone: 'pos', label: t('bpmn.check.name'), text: model.name ? t('bpmn.check.sameName', { name: model.name }) : t('bpmn.check.noName', { title: o.title }) });
  out.push({ tone: 'info', label: t('bpmn.check.pull'), text: t('bpmn.check.pullText', { path: o.path }) });
  return out;
}

/** The import of a model from a file: choose or drop it, see it drawn with its checks, then the pull request. */
const Import = ({ namespace, process, title, teams, path, onCancel }: { namespace: string; process: string; title: string; teams: string[]; path: string; onCancel?: () => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  const post = useBusinessMapPost();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; xml: string }>();
  const [model, setModel] = useState<BpmnModel | { error: string }>();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState<number>();
  const take = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      setModel(undefined);
      setError(undefined);
      setOpened(undefined);
      setFile({ name: f.name, xml: String(r.result) });
    };
    r.readAsText(f);
  };
  const reset = () => {
    setFile(undefined);
    setModel(undefined);
    setError(undefined);
    setOpened(undefined);
    if (input.current) input.current.value = '';
  };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const a = await post<PullAnswer>('/bpmn', { namespace, process, title, fileName: file.name, xml: file.xml });
      setOpened(a.pull.number);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };
  const good = model && !('error' in model) ? model : undefined;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <input ref={input} type="file" accept=".bpmn,.xml,application/xml,text/xml" aria-label={t('bpmn.fileLabel')} style={{ display: 'none' }} onChange={e => take(e.target.files?.[0])} />
      {!file && (
        <Box
          onDragOver={e => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          sx={{ border: `2px dashed ${over ? rq.data : rq.control}`, borderRadius: '8px', p: 3.5, display: 'grid', gap: 1.25, justifyItems: 'center', textAlign: 'center', bgcolor: rq.raised }}
        >
          <Typography>{t('bpmn.drop')}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" disableElevation onClick={() => input.current?.click()}>
              {t('bpmn.choose')}
            </Button>
            {onCancel && <Button onClick={onCancel}>{t('bpmn.cancel')}</Button>}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('bpmn.nothingYet')}
          </Typography>
        </Box>
      )}
      {file && (
        <>
          <Typography sx={{ fontWeight: 500 }}>{t('bpmn.preview', { file: file.name })}</Typography>
          {model && 'error' in model ? (
            <Box role="alert" sx={{ bgcolor: TONES.bad.bg, color: TONES.bad.fg, borderRadius: '8px', p: 1.25 }}>
              <b style={{ fontWeight: 500 }}>{t('bpmn.notBpmn')}.</b> {t('bpmn.notBpmnText', { why: model.error })}
            </Box>
          ) : (
            <BpmnCanvas xml={file.xml} onModel={setModel} height={400} />
          )}
          {good && (
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
              {checksOf(good, { title, teams, path }, t).map(c => (
                <Box component="li" key={c.label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(0, 1fr)' }, gap: 1.25, alignItems: 'start' }}>
                  <span>
                    <Pill tone={c.tone}>{c.label}</Pill>
                  </span>
                  <span>{c.text}</span>
                </Box>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" disableElevation disabled={busy || !good || opened !== undefined} onClick={save}>
              {t('bpmn.open')}
            </Button>
            <Button variant="outlined" onClick={reset}>
              {t('bpmn.another')}
            </Button>
            {onCancel && <Button onClick={onCancel}>{t('bpmn.cancel')}</Button>}
          </Box>
          {error && (
            <Typography role="alert" color="error">
              {error}
            </Typography>
          )}
          {opened !== undefined && (
            <Box role="status" sx={{ bgcolor: TONES.ok.bg, color: TONES.ok.fg, borderRadius: '8px', p: 1.25 }}>
              {t('bpmn.opened', { n: opened })}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

/**
 * The model of a business process on its page: the BPMN kept next to the process in the repository, drawn, with its
 * steps and the team of each; or, when there is none, the import from a file. Only the model: nothing here reads or
 * deploys to the process engine.
 */
export const ProcessModel = ({ namespace, process, title }: { namespace: string; process: string; title: string }) => {
  const { t } = useI18n();
  const bpmn = useBpmn(namespace, process);
  const org = useOrganisation(namespace);
  const [model, setModel] = useState<BpmnModel | { error: string }>();
  const [picked, setPicked] = useState<string>();
  const [importing, setImporting] = useState(false);
  const teams = teamNames(org.data?.customer);
  const may = !!org.data?.may;
  const path = bpmn.data?.path ?? `catalog/business-map/${namespace}/bpmn/${process}.bpmn`;
  const good = model && !('error' in model) ? model : undefined;
  const download = () => {
    if (!bpmn.data) return;
    const url = URL.createObjectURL(new Blob([bpmn.data.xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${process}.bpmn`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  if (bpmn.loading && !bpmn.data) {
    return (
      <Section title={t('bpmn.title')}>
        <Typography color="text.secondary">{t('bpmn.loading')}</Typography>
      </Section>
    );
  }
  if (!bpmn.data) {
    return (
      <Section title={t('bpmn.title')}>
        {importing ? (
          <Import namespace={namespace} process={process} title={title} teams={teams} path={path} onCancel={() => setImporting(false)} />
        ) : (
          <EmptyState
            title={t('bpmn.none')}
            action={
              may ? (
                <Button variant="contained" disableElevation onClick={() => setImporting(true)}>
                  {t('bpmn.import')}
                </Button>
              ) : undefined
            }
          >
            {t('bpmn.none.why')} {!may && org.data ? t('bpmn.onlyWriters') : ''}
          </EmptyState>
        )}
      </Section>
    );
  }
  return (
    <>
      <Section
        title={t('bpmn.title')}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            {may && (
              <Button variant="outlined" size="small" onClick={() => setImporting(x => !x)}>
                {t('bpmn.replace')}
              </Button>
            )}
            <Button variant="outlined" size="small" onClick={download}>
              {t('bpmn.download')}
            </Button>
          </Box>
        }
        foot={
          <span>
            {t('bpmn.kept')} <Id>{path}</Id>: {t('bpmn.keptNote')}
          </span>
        }
      >
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t('bpmn.sub')}
          </Typography>
          {importing && <Import namespace={namespace} process={process} title={title} teams={teams} path={path} onCancel={() => setImporting(false)} />}
          {!importing && model && 'error' in model && (
            <EmptyState tone="neg" title={model.error.includes(BPMN_VIEWER_PATH) ? t('bpmn.noViewer') : t('bpmn.cannotDraw')}>
              {model.error}
            </EmptyState>
          )}
          {!importing && !(model && 'error' in model) && <BpmnCanvas xml={bpmn.data.xml} picked={picked} onPick={setPicked} onModel={setModel} />}
        </Box>
      </Section>
      {!importing && good && good.steps.length > 0 && (
        <Section title={t('bpmn.steps')} flush>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 2.25, pb: 1.25 }}>
            {t('bpmn.stepsSub')}
          </Typography>
          <Steps model={good} teams={teams} picked={picked} onPick={setPicked} />
        </Section>
      )}
    </>
  );
};
