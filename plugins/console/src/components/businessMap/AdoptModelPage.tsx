import { Progress } from '@backstage/core-components';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { Facts, Id, TitleRow } from '../ui';
import { useTemplateTask } from '../templateTask';
import {
  adoptProblems,
  adoptTotals,
  adoptValues,
  type AdoptForm,
  categoriesOf,
  hasProblems,
  namespacesOf,
  refOf,
  supportIds,
} from './businessMapFormsModel';
import { FormCard, RefPicker, StepsBar, TaskPanel, useEntities, useProblemText, WhoMayNotice } from './formParts';

/**
 * Portal › Business continuity › Adopt reference model (mockup board Adopt): the model, the level-1 categories that
 * apply (with their size), the customer namespace and the owner group; then the template business-model-adopt runs
 * here and its pull request is shown.
 */

const TEMPLATE = 'business-model-adopt';

export const AdoptModelPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const [params] = useSearchParams();
  const [form, setForm] = useState<AdoptForm>({ model: '', categories: [], namespace: params.get('ns') ?? '', owner: '' });
  const [tried, setTried] = useState(false);
  const { task, start, reset } = useTemplateTask(TEMPLATE);
  const models = useEntities({ kind: 'ReferenceModel' });
  const groups = useEntities({ kind: 'Group' });
  const domains = useEntities({ kind: 'Domain', 'spec.type': 'business-area' });
  const customers = useMemo(() => namespacesOf(domains.items), [domains.items]);
  const model = models.items.find(m => refOf(m) === form.model);
  const modelNs = typeof model?.spec?.namespace === 'string' ? model.spec.namespace : '';
  const content = useEntities(
    [
      { kind: 'Domain', 'metadata.namespace': modelNs },
      { kind: 'BusinessProcess', 'metadata.namespace': modelNs },
    ],
    !modelNs,
  );
  const categories = useMemo(() => categoriesOf(content.items), [content.items]);
  const support = useMemo(() => new Set(supportIds(model, categories)), [model, categories]);
  const problems = adoptProblems(form);
  const problem = useProblemText(problems, tried);
  const set = (patch: Partial<AdoptForm>) => setForm(f => ({ ...f, ...patch }));
  const totals = adoptTotals(categories, form.categories);

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('nav.businessMap'), '/console/business-map'], [t('bm.adopt')]];
  const head = <TitleRow crumbs={crumbs} title={t('bm.adopt')} sub={t('bmf.adopt.sub')} />;
  if (task.id) {
    return (
      <>
        {head}
        <TaskPanel id={task.id} title={t('bmf.adopt.running', { namespace: form.namespace })} onAgain={reset} />
      </>
    );
  }

  const toggle = (id: string, on: boolean) => set({ categories: on ? [...form.categories, id] : form.categories.filter(c => c !== id) });
  const run = () => {
    if (hasProblems(problems)) {
      setTried(true);
      return;
    }
    start(adoptValues(form));
  };
  let at = 0;
  if (form.model) at = form.categories.length ? 2 : 1;
  const modelTitle = model ? model.metadata.title ?? model.metadata.name : '';
  const groupsOf = [
    { title: t('bmf.adopt.core', { model: modelTitle }), items: categories.filter(c => !support.has(c.id)) },
    { title: t('bmf.adopt.support'), items: categories.filter(c => support.has(c.id)) },
  ].filter(g => g.items.length);

  return (
    <>
      {head}
      <WhoMayNotice />
      <StepsBar labels={[t('bmf.adopt.step.model'), t('bmf.adopt.step.categories'), t('bmf.adopt.step.where')]} at={at} />
      {task.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('bmf.task.notStarted', { error: task.error })}
        </Alert>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
        <Box sx={{ flex: '999 1 560px', minWidth: 0 }}>
          <FormCard
            foot={
              <>
                <span />
                <Button size="small" variant="contained" disableElevation disabled={task.starting} onClick={run}>
                  {task.starting ? t('bmf.starting') : t('bmf.adopt.run')}
                </Button>
              </>
            }
          >
            <RefPicker
              label={t('bmf.model')}
              required
              items={models.items}
              loading={models.loading}
              value={form.model}
              onChange={v => set({ model: v, categories: [] })}
              error={problem('model')}
              help={models.items.length || models.loading ? t('bmf.model.hint') : t('bmf.model.none')}
            />
            {form.model && (
              <Box component="fieldset" sx={{ border: `1px solid ${problem('categories') ? rq.negative : rq.border}`, borderRadius: '8px', px: 2, pt: 1, pb: 1.5, m: 0, minWidth: 0 }}>
                <Box component="legend" sx={{ fontWeight: 600, px: 0.75 }}>
                  {t('bmf.categories')}
                </Box>
                {content.loading && <Progress />}
                {!content.loading && !categories.length && (
                  <Typography variant="body2" color="text.secondary">
                    {t('bmf.categories.none')}
                  </Typography>
                )}
                {groupsOf.map(g => (
                  <Box key={g.title} sx={{ mt: 1 }}>
                    {groupsOf.length > 1 && (
                      <Typography variant="caption" color="text.secondary">
                        {g.title}
                      </Typography>
                    )}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px 16px' }}>
                      {g.items.map(c => (
                        <Box component="label" key={c.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 0.5, borderRadius: '8px', cursor: 'pointer', '&:hover': { bgcolor: rq.raised } }}>
                          <Checkbox size="small" checked={form.categories.includes(c.id)} onChange={e => toggle(c.id, e.target.checked)} sx={{ p: 0.25 }} />
                          <Box component="span">
                            {c.title}{' '}
                            <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 11, color: rq.muted }}>
                              {c.id}
                            </Box>
                            <Box component="small" sx={{ display: 'block', color: rq.muted, fontSize: 12 }}>
                              {t('bmf.categories.size', { groups: c.subdomains, processes: c.processes })}
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ))}
                {problem('categories') && (
                  <Typography variant="caption" color="error">
                    {problem('categories')}
                  </Typography>
                )}
              </Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 1.5 }}>
              <Autocomplete
                freeSolo
                size="small"
                options={customers}
                value={form.namespace}
                inputValue={form.namespace}
                onInputChange={(_, v) => set({ namespace: v.trim() })}
                renderInput={p => <TextField {...p} required label={t('bmf.namespace')} error={!!problem('namespace')} helperText={problem('namespace') ?? t('bmf.namespace.hint')} />}
              />
              <RefPicker label={t('bmf.ownerGroup')} required items={groups.items} loading={groups.loading} value={form.owner} onChange={v => set({ owner: v })} error={problem('owner')} help={t('bmf.adopt.owner.hint')} />
            </Box>
          </FormCard>
        </Box>
        <Box component="aside" aria-label={t('bmf.adopt.adds')} sx={{ flex: '1 0 280px', maxWidth: 360, border: `1px solid ${rq.border}`, borderRadius: '8px', p: 2, bgcolor: rq.raised, display: 'grid', gap: 1.25 }}>
          <Typography variant="h6" component="h2">
            {t('bmf.adopt.adds')}
          </Typography>
          <Facts
            labelWidth={110}
            items={[
              [t('bmf.adopt.domains'), t('bmf.adopt.domainsValue', { n: totals.domains, subs: totals.subdomains })],
              [t('bmf.adopt.processes'), String(totals.processes)],
              [t('bmf.adopt.owner'), form.owner ? <Id>{form.owner}</Id> : '—'],
              [t('bmf.adopt.where'), <Id key="where">{`catalog/business-map/${form.namespace || '<namespace>'}/`}</Id>],
              [t('bmf.adopt.repo'), 'refresquito-services'],
            ]}
          />
          <Typography variant="caption" color="text.secondary">
            {t('bmf.adopt.keeps')}
          </Typography>
        </Box>
      </Box>
    </>
  );
};
