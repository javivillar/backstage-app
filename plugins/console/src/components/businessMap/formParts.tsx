import { parseEntityRef } from '@backstage/catalog-model';
import { Progress } from '@backstage/core-components';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Cancel from '@mui/icons-material/Cancel';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { useTaskProgress } from '../templateTask';
import { type LiteEntity, mayChangeMap, type Problems, refOf } from './businessMapFormsModel';

/**
 * The pieces the forms of the business map share (ImportModelPage, AdoptModelPage, ProcessFormPage): the catalog
 * reads of their pickers, the notice of who may run them, the steps bar of the mockup, the error of a field and the
 * run of the template with the pull request at the end.
 */

const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'spec'];

type Loaded<T> = { loading: boolean; items: T[]; error?: string };

export type CatalogFilter = Record<string, string | string[]> | Array<Record<string, string | string[]>>;

/** Entities of the catalog for a filter (only the fields the forms read); read again when the filter changes. */
export function useEntities(filter: CatalogFilter, skip = false): Loaded<LiteEntity> {
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<Loaded<LiteEntity>>({ loading: !skip, items: [] });
  const key = JSON.stringify(filter);
  useEffect(() => {
    if (skip) {
      setState({ loading: false, items: [] });
      return undefined;
    }
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    catalog.getEntities({ filter: JSON.parse(key) as CatalogFilter, fields: FIELDS }).then(
      r => alive && setState({ loading: false, items: r.items as unknown as LiteEntity[] }),
      e => alive && setState({ loading: false, items: [], error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog, key, skip]);
  return state;
}

/** Whether the person may run the templates of the business map (business-architect, backstage-admin); undefined while unknown. */
export function useMayChangeMap(): boolean | undefined {
  const identity = useApi(identityApiRef);
  const [may, setMay] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    identity.getBackstageIdentity().then(
      id => alive && setMay(mayChangeMap(id.ownershipEntityRefs)),
      () => alive && setMay(false),
    );
    return () => {
      alive = false;
    };
  }, [identity]);
  return may;
}

/** The notice for someone outside the groups that may change the business map (the template refuses them anyway). */
export const WhoMayNotice = () => {
  const { t } = useI18n();
  const may = useMayChangeMap();
  if (may !== false) return null;
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      {t('bmf.notAllowed')}
    </Alert>
  );
};

/** The steps of a form as the mockup draws them: number (a check when passed), label, the current one marked. */
export const StepsBar = ({ labels, at, onGo }: { labels: string[]; at: number; onGo?: (i: number) => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  return (
    <Box component="ol" aria-label={t('bmf.steps')} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, listStyle: 'none', m: 0, p: 0, mb: 2 }}>
      {labels.map((l, i) => {
        const cur = i === at;
        const done = i < at;
        let numBg = 'transparent';
        if (cur) numBg = rq.primary;
        else if (done) numBg = rq.positive;
        return (
          <Box component="li" key={l}>
            <Box
              component="button"
              type="button"
              onClick={() => onGo?.(i)}
              disabled={!onGo || i > at}
              aria-current={cur ? 'step' : undefined}
              sx={{
                all: 'unset',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                minHeight: 36,
                px: 1.25,
                borderRadius: '8px',
                fontSize: 13,
                cursor: onGo && i <= at ? 'pointer' : 'default',
                color: cur ? rq.ink : rq.muted,
                fontWeight: cur ? 600 : 400,
                bgcolor: cur ? rq.active : 'transparent',
                '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 },
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ width: 24, height: 24, borderRadius: '50%', border: `1px solid ${cur || done ? numBg : rq.border}`, bgcolor: numBg, color: cur || done ? rq.onPrimary : rq.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}
              >
                {done ? '✓' : String(i + 1)}
              </Box>
              {l}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

/** The message of a field's problem, when shown. */
export function useProblemText(problems: Problems, shown: boolean) {
  const { t } = useI18n();
  return (field: string): string | undefined => {
    const p = shown ? problems[field] : undefined;
    return p ? t(p.key, p.vars) : undefined;
  };
}

/** A card of a form (the sheet of the mockup). */
export const FormCard = ({ children, foot }: { children: ReactNode; foot?: ReactNode }) => {
  const rq = useRq();
  return (
    <Box sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.sheet, mb: 3, minWidth: 0 }}>
      <Box sx={{ p: 2.25, display: 'grid', gap: 2 }}>{children}</Box>
      {foot && <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', px: 2.25, py: 1.5, borderTop: `1px solid ${rq.border}` }}>{foot}</Box>}
    </Box>
  );
};

const optionLabel = (items: LiteEntity[]) => (ref: string) => {
  const e = items.find(x => refOf(x) === ref);
  if (e?.metadata.title) return e.metadata.title;
  try {
    return parseEntityRef(ref).name;
  } catch {
    return ref;
  }
};

/** One entity of a list (a Group, a ReferenceModel...), by its ref; the refs that are not in the list stay shown. */
export const RefPicker = ({ label, items, value, onChange, error, help, required, loading }: {
  label: string;
  items: LiteEntity[];
  value: string;
  onChange: (ref: string) => void;
  error?: string;
  help?: string;
  required?: boolean;
  loading?: boolean;
}) => {
  const options = [...new Set([...items.map(refOf), ...(value ? [value] : [])])];
  return (
    <Autocomplete
      size="small"
      options={options}
      value={value || null}
      loading={loading}
      onChange={(_, v) => onChange(v ?? '')}
      getOptionLabel={optionLabel(items)}
      renderOption={(props, ref) => (
        <li {...props} key={ref}>
          <span>
            {optionLabel(items)(ref)}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontFamily: 'monospace' }}>
              {ref}
            </Typography>
          </span>
        </li>
      )}
      renderInput={p => <TextField {...p} label={label} required={required} error={!!error} helperText={error ?? help} />}
    />
  );
};

/** Several entities (the business services a process depends on). */
export const RefsPicker = ({ label, items, value, onChange, help }: { label: string; items: LiteEntity[]; value: string[]; onChange: (refs: string[]) => void; help?: string }) => {
  const options = [...new Set([...items.map(refOf), ...value])];
  return (
    <Autocomplete
      multiple
      size="small"
      options={options}
      value={value}
      onChange={(_, v) => onChange(v)}
      getOptionLabel={optionLabel(items)}
      renderInput={p => <TextField {...p} label={label} helperText={help} />}
    />
  );
};

/** The run of the template: its steps as they go, the pull request when it ends, the log on demand. */
export const TaskPanel = ({ id, title, onAgain }: { id: string; title: string; onAgain?: () => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  const { steps, states, events, status, links } = useTaskProgress(id);
  const [showLog, setShowLog] = useState(false);
  const failed = status === 'failed' || status === 'cancelled';
  let summary = t('bmf.task.running');
  if (status === 'completed') summary = t('bmf.task.done');
  else if (failed) summary = t('bmf.task.failed');
  const pr = links.find(l => l.url && /^https?:/.test(l.url));
  return (
    <FormCard
      foot={
        <>
          <Button size="small" onClick={() => setShowLog(x => !x)}>
            {showLog ? t('bmf.task.hideLog') : t('bmf.task.showLog')}
          </Button>
          {status !== 'processing' && onAgain && (
            <Button size="small" variant="outlined" onClick={onAgain}>
              {t('bmf.task.again')}
            </Button>
          )}
        </>
      }
    >
      <Box>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        <Typography color="text.secondary" role="status">
          {summary}
        </Typography>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
        {steps.map(st => {
          const s = states.get(st.id);
          let icon: ReactNode = <Box component="span" sx={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${rq.border}`, boxSizing: 'border-box' }} />;
          if (s === 'completed') icon = <CheckCircle fontSize="small" sx={{ color: rq.positive }} />;
          else if (s === 'failed') icon = <Cancel fontSize="small" sx={{ color: rq.negative }} />;
          else if (s === 'processing')
            icon = (
              <Box
                component="span"
                sx={{ width: 18, height: 18, boxSizing: 'border-box', borderRadius: '50%', border: `2px solid ${rq.data}`, borderTopColor: 'transparent', animation: 'bmspin 1s linear infinite', '@keyframes bmspin': { to: { transform: 'rotate(360deg)' } }, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
              />
            );
          let text: ReactNode = st.name;
          if (s === 'skipped') text = `${st.name} · ${t('bmf.task.skipped')}`;
          return (
            <Box component="li" key={st.id} sx={{ display: 'flex', gap: 1.25, alignItems: 'center', color: s === 'skipped' ? rq.muted : rq.ink }}>
              {icon}
              <Box component="span" sx={{ fontWeight: s === 'processing' ? 600 : 400 }}>
                {text}
              </Box>
            </Box>
          );
        })}
      </Box>
      {status === 'processing' && !steps.length && <Progress />}
      {links.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {pr && (
            <Button variant="contained" disableElevation size="small" href={pr.url ?? ''} target="_blank" rel="noreferrer">
              {t('bmf.task.openPr')}
            </Button>
          )}
          {links
            .filter(l => l !== pr && l.url)
            .map(l => (
              <Button key={`${l.title}-${l.url}`} variant="outlined" size="small" component={Link} to={l.url ?? '/console/business-map'}>
                {l.title}
              </Button>
            ))}
        </Box>
      )}
      {showLog && (
        <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: rq.raised, border: `1px solid ${rq.border}`, borderRadius: '8px', fontSize: 12, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {events
            .filter(e => e.body.message)
            .map(e => e.body.message)
            .join('\n')}
        </Box>
      )}
    </FormCard>
  );
};
