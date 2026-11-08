import { Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Criticality } from '../../businessMap';
import { useI18n } from '../../i18n';
import { EmptyState, TitleRow } from '../ui';
import { useTemplateTask } from '../templateTask';
import {
  domainOptions,
  emptyProcess,
  hasProblems,
  inOwnFile,
  type LiteEntity,
  namespacesOf,
  processFormOf,
  type ProcessForm,
  type ProcessMode,
  processProblems,
  processTemplate,
  processValues,
  refOf,
  slugOf,
  withTitle,
} from './businessMapFormsModel';
import { consolePath, CRITICALITIES } from './businessMapModel';
import { FormCard, RefPicker, RefsPicker, TaskPanel, useEntities, useProblemText, WhoMayNotice } from './formParts';

/**
 * Portal › Business continuity › New business process (/console/business-map/process/new?domain=) and Edit business
 * process (/console/business-map/process/edit/:namespace/:name, prefilled from the catalog): the fields of the
 * templates business-process-new / business-process-edit, then the template runs here and its pull request is shown.
 * The edit template keeps every annotation of the process itself.
 */

type Current = { loading: boolean; entity?: LiteEntity; error?: string };

/** The process being edited, from the catalog. */
function useProcess(namespace: string | undefined, name: string | undefined): Current {
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<Current>({ loading: !!name });
  useEffect(() => {
    if (!namespace || !name) {
      setState({ loading: false });
      return undefined;
    }
    let alive = true;
    setState({ loading: true });
    catalog.getEntityByRef(`businessprocess:${namespace}/${name}`).then(
      e => alive && setState({ loading: false, entity: e as unknown as LiteEntity | undefined }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog, namespace, name]);
  return state;
}

const Form = ({ mode, initial, processRef, ownFile }: { mode: ProcessMode; initial: ProcessForm; processRef?: string; ownFile: boolean }) => {
  const { t } = useI18n();
  const [form, setForm] = useState<ProcessForm>(initial);
  const [tried, setTried] = useState(false);
  const { task, start, reset } = useTemplateTask(processTemplate(mode));
  const domains = useEntities({ kind: 'Domain', 'spec.type': 'business-area' });
  const groups = useEntities({ kind: 'Group' });
  const services = useEntities({ kind: 'System', 'spec.type': 'business-service' });
  const customers = useMemo(() => [...new Set([...namespacesOf(domains.items), ...(form.namespace ? [form.namespace] : [])])].sort(), [domains.items, form.namespace]);
  const options = useMemo(() => domainOptions(domains.items, form.namespace), [domains.items, form.namespace]);
  const problems = processProblems(form, mode);
  const problem = useProblemText(problems, tried);
  const set = (patch: Partial<ProcessForm>) => setForm(f => ({ ...f, ...patch }));
  const title = mode === 'new' ? t('bm.new') : t('bmf.edit.title');

  if (task.id) return <TaskPanel id={task.id} title={t(mode === 'new' ? 'bmf.process.runningNew' : 'bmf.process.runningEdit', { title: form.title })} onAgain={reset} />;

  const run = () => {
    if (hasProblems(problems)) {
      setTried(true);
      return;
    }
    start(processValues(form, mode, processRef));
  };
  const domainKnown = !form.domain || options.some(o => o.ref === form.domain);
  return (
    <>
      {mode === 'edit' && !ownFile && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('bmf.edit.notOwnFile')}
        </Alert>
      )}
      {task.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('bmf.task.notStarted', { error: task.error })}
        </Alert>
      )}
      <FormCard
        foot={
          <>
            {processRef ? (
              <Button size="small" variant="outlined" component={Link} to={consolePath(processRef)}>
                {t('bmf.cancel')}
              </Button>
            ) : (
              <Button size="small" variant="outlined" component={Link} to="/console/business-map">
                {t('bmf.cancel')}
              </Button>
            )}
            <Button size="small" variant="contained" disableElevation disabled={task.starting || (mode === 'edit' && !ownFile)} onClick={run}>
              {task.starting ? t('bmf.starting') : t('bmf.process.run')}
            </Button>
          </>
        }
      >
        <Typography variant="h5" component="h2">
          {mode === 'new' ? t('bmf.process.section') : form.title || title}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 1.5 }}>
          <TextField
            size="small"
            required
            label={t('bmf.process.title')}
            value={form.title}
            onChange={e => setForm(f => (mode === 'new' ? withTitle(f, e.target.value) : { ...f, title: e.target.value }))}
            error={!!problem('title')}
            helperText={problem('title') ?? t('bmf.process.title.hint')}
          />
          {mode === 'new' ? (
            <TextField
              size="small"
              required
              label={t('bmf.process.name')}
              value={form.name}
              onChange={e => set({ name: e.target.value.toLowerCase(), nameFromTitle: !e.target.value || e.target.value === slugOf(form.title) })}
              error={!!problem('name')}
              helperText={problem('name') ?? t('bmf.process.name.hint')}
              inputProps={{ style: { fontFamily: 'monospace' } }}
            />
          ) : (
            <TextField size="small" label={t('bmf.process.name')} value={form.name} disabled helperText={t('bmf.process.name.fixed')} inputProps={{ style: { fontFamily: 'monospace' } }} />
          )}
        </Box>
        <TextField
          size="small"
          multiline
          minRows={2}
          label={t('bmf.process.description')}
          value={form.description}
          onChange={e => set({ description: e.target.value })}
          error={!!problem('description')}
          helperText={problem('description')}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 1.5 }}>
          <TextField
            select
            size="small"
            required
            label={t('bm.customer')}
            value={form.namespace}
            disabled={mode === 'edit'}
            onChange={e => set({ namespace: e.target.value, domain: '' })}
            helperText={mode === 'edit' ? t('bmf.process.customer.fixed') : t('bmf.process.customer.hint')}
          >
            {customers.map(ns => (
              <MenuItem key={ns} value={ns}>
                {ns}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            required
            label={t('bmf.process.domain')}
            value={domainKnown ? form.domain : ''}
            onChange={e => set({ domain: e.target.value })}
            error={!!problem('domain')}
            helperText={problem('domain') ?? (domainKnown ? t('bmf.process.domain.hint') : t('bmf.process.domain.unknown', { domain: form.domain }))}
            disabled={!form.namespace}
          >
            {options.map(o => (
              <MenuItem key={o.ref} value={o.ref} sx={{ pl: 2 + o.depth * 2 }}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <RefPicker label={t('bmf.ownerGroup')} required items={groups.items} loading={groups.loading} value={form.owner} onChange={v => set({ owner: v })} error={problem('owner')} />
          <TextField
            size="small"
            label={t('bmf.process.key')}
            value={form.processKey}
            onChange={e => set({ processKey: e.target.value })}
            error={!!problem('processKey')}
            helperText={problem('processKey') ?? t('bmf.process.key.hint')}
            inputProps={{ style: { fontFamily: 'monospace' } }}
          />
        </Box>
        <Box>
          <Typography variant="h6" component="h3">
            {t('bmf.process.continuity')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('bmf.process.continuity.hint')}
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1.5 }}>
          <TextField select size="small" required label={t('bm.criticality')} value={form.criticality} onChange={e => set({ criticality: e.target.value as Criticality })}>
            {CRITICALITIES.map(c => (
              <MenuItem key={c} value={c}>
                {t(`bm.crit.${c}`)}
              </MenuItem>
            ))}
          </TextField>
          {(['rpo', 'rto', 'retention'] as const).map(f => (
            <TextField
              key={f}
              size="small"
              label={t(`bmf.process.${f}`)}
              value={form[f]}
              placeholder={f === 'retention' ? '30y' : t('bmf.process.default')}
              onChange={e => set({ [f]: e.target.value.trim() } as Partial<ProcessForm>)}
              error={!!problem(f)}
              helperText={problem(f) ?? t(`bmf.process.${f}.hint`)}
              inputProps={{ style: { fontFamily: 'monospace' } }}
            />
          ))}
        </Box>
        <RefsPicker label={t('bmf.process.dependsOn')} items={services.items} value={form.dependsOn} onChange={v => set({ dependsOn: v })} help={t('bmf.process.dependsOn.hint')} />
      </FormCard>
    </>
  );
};

/** New business process: the form, in the domain of ?domain= when given. */
export const NewProcessPage = () => {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const initial = useMemo(() => emptyProcess(params.get('domain') ?? ''), [params]);
  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('nav.businessMap'), '/console/business-map'], [t('bm.new')]];
  return (
    <>
      <TitleRow crumbs={crumbs} title={t('bm.new')} sub={t('bmf.process.sub')} />
      <WhoMayNotice />
      <Form mode="new" initial={initial} ownFile />
    </>
  );
};

/** Edit business process: the form prefilled from the process in the catalog. */
export const EditProcessPage = () => {
  const { t } = useI18n();
  const { namespace, name } = useParams();
  const current = useProcess(namespace, name);
  const e = current.entity;
  const initial = useMemo(() => (e ? processFormOf(e) : undefined), [e]);
  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('nav.businessMap'), '/console/business-map'], ...(e ? ([[e.metadata.title ?? e.metadata.name, consolePath(refOf(e))]] as Array<[string, string?]>) : []), [t('bmf.edit.title')]];
  return (
    <>
      <TitleRow crumbs={crumbs} title={t('bmf.edit.title')} sub={t('bmf.edit.sub')} />
      <WhoMayNotice />
      {current.loading && <Progress />}
      {current.error && (
        <EmptyState tone="neg" title={t('bmf.edit.error')}>
          {current.error}
        </EmptyState>
      )}
      {!current.loading && !current.error && !e && <EmptyState title={t('bmf.edit.missing', { ref: `${namespace}/${name}` })} />}
      {e && initial && <Form key={refOf(e)} mode="edit" initial={initial} processRef={refOf(e)} ownFile={inOwnFile(e)} />}
    </>
  );
};

/** The route element of both modes: /process/new and /process/edit/:namespace/:name. */
export const ProcessFormPage = ({ mode }: { mode: ProcessMode }) => (mode === 'new' ? <NewProcessPage /> : <EditProcessPage />);
