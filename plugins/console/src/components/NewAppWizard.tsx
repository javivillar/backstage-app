import { type Entity, parseEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Cancel from '@mui/icons-material/Cancel';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from './Badge';
import { TONES } from './Flow';
import {
  BLOCKS,
  blockFields,
  cleanValues,
  defaultsOf,
  linesOf,
  PREFIXED,
  type Prop,
  problemsOf,
  type Step,
  stepsOf,
  stepStates,
  type TaskEvent,
  type Values,
} from './newAppModel';

/** how each known template looks; any other template of the catalog gets the default */
const LOOK: Record<string, { logo: string; accent: string; stack: string[]; arch: 'monolith' | 'micro' }> = {
  'python-framework-app': { logo: 'Py', accent: '#3776AB', stack: ['Angular', 'FastAPI', 'PostgreSQL'], arch: 'monolith' },
  'spring-framework-app': { logo: 'Sp', accent: '#4E9A2E', stack: ['Angular', 'Spring Boot', 'PostgreSQL per service', 'Events'], arch: 'micro' },
};
const DEFAULT_LOOK = { logo: 'App', accent: '#0060C0', stack: [] as string[], arch: 'monolith' as const };

/**
 * A button in the console look: the global CSS of the classic portal restyles every MUI Button (orange gradient), so
 * the console draws its own. variant: contained (primary), outlined, text; to: a route; href: a link.
 */
const Btn = ({
  variant = 'text',
  to,
  href,
  children,
  sx,
  size: _size,
  disableElevation: _de,
  component: _c,
  ...rest
}: {
  variant?: 'contained' | 'outlined' | 'text';
  to?: string;
  href?: string;
  children: ReactNode;
  sx?: Record<string, unknown>;
  size?: string;
  disableElevation?: boolean;
  component?: unknown;
  [k: string]: unknown;
}) => {
  const look = {
    all: 'unset',
    boxSizing: 'border-box',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.75,
    borderRadius: '8px',
    px: variant === 'text' ? 0.75 : 1.75,
    py: 0.8,
    fontSize: 14,
    fontWeight: 500,
    border: variant === 'text' ? '1px solid transparent' : '1px solid',
    borderColor: variant === 'outlined' ? 'divider' : undefined,
    bgcolor: variant === 'contained' ? '#0060C0' : 'transparent',
    color: variant === 'contained' ? '#fff' : '#0060C0',
    textDecoration: 'none',
    '&:hover': { bgcolor: variant === 'contained' ? '#004F9E' : 'action.hover' },
    '&:focus-visible': { outline: '2px solid #0060C0', outlineOffset: 2 },
    '&:disabled': { opacity: 0.45, cursor: 'default' },
    ...(variant === 'outlined' ? { color: 'text.primary' } : {}),
    ...(sx ?? {}),
  };
  if (to)
    return (
      <Box to={to} sx={look} {...rest}>
        {children}
      </Box>
    );
  if (href)
    return (
      <Box component="a" href={href} sx={look} {...rest}>
        {children}
      </Box>
    );
  return (
    <Box component="button" type="button" sx={look} {...rest}>
      {children}
    </Box>
  );
};

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
const card = { border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.5, minWidth: 0, alignContent: 'start' } as const;
const overline = (t: string) => (
  <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
    {t}
  </Typography>
);

/** a list the template takes (buckets, sites, groups, people): one row per element, add and remove */
const ListField = ({ id, p, value, onChange, prefix, accent }: { id: string; p: Prop; value: string[]; onChange: (v: string[]) => void; prefix?: string; accent: string }) => {
  const last = useRef<HTMLInputElement | null>(null);
  const [focusLast, setFocusLast] = useState(false);
  useEffect(() => {
    if (focusLast) {
      last.current?.focus();
      setFocusLast(false);
    }
  }, [focusLast]);
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      {value.map((v, i) => (
        <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 0.75, alignItems: 'center' }}>
          <TextField
            size="small"
            value={v}
            inputRef={i === value.length - 1 ? last : undefined}
            onChange={e => onChange(value.map((x, j) => (j === i ? e.target.value.trim() : x)))}
            inputProps={{ 'aria-label': `${p.title ?? id} ${i + 1}`, style: { fontFamily: 'monospace' } }}
          />
          {prefix ? (
            <Box component="span" title="Its name in the platform" sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary', bgcolor: 'action.hover', borderRadius: '6px', px: 0.75, py: 0.25, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {prefix}-{v || '…'}
            </Box>
          ) : (
            <span />
          )}
          <Btn size="small" aria-label={`Remove ${v || 'this one'}`} onClick={() => onChange(value.filter((_, j) => j !== i))} sx={{ minWidth: 0, px: 1 }}>
            ×
          </Btn>
        </Box>
      ))}
      <Box>
        <Btn
          size="small"
          onClick={() => {
            onChange([...value, '']);
            setFocusLast(true);
          }}
          sx={{ textTransform: 'none', color: accent, px: 0.5 }}
        >
          + Add
        </Btn>
      </Box>
    </Box>
  );
};

/** the switch of a block */
const Toggle = ({ checked, onChange, label, accent }: { checked: boolean; onChange: (v: boolean) => void; label: string; accent: string }) => (
  <Box component="label" sx={{ position: 'relative', width: 38, height: 22, flexShrink: 0, ml: 'auto', cursor: 'pointer' }}>
    <Box component="input" type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label} sx={{ position: 'absolute', inset: 0, opacity: 0, m: 0, cursor: 'pointer', '&:focus-visible + span': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }} />
    <Box
      component="span"
      sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: 999,
        bgcolor: checked ? accent : 'divider',
        transition: 'background .15s',
        '&::after': { content: '""', position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: '50%', bgcolor: '#fff', transform: checked ? 'translateX(16px)' : 'none', transition: 'transform .15s' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&::after': { transition: 'none' } },
      }}
    />
  </Box>
);

/** The run of the template: its steps as they go, its log, and where to go when it ends. */
const TaskView = ({ id, accent, title }: { id: string; accent: string; title: string }) => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [steps, setSteps] = useState<Array<{ id: string; name: string }>>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [status, setStatus] = useState('processing');
  const [showLog, setShowLog] = useState(false);
  useEffect(() => {
    let alive = true;
    let after: number | undefined;
    (async () => {
      const base = `${await discovery.getBaseUrl('scaffolder')}/v2/tasks/${id}`;
      const t = await (await fetch(base)).json().catch(() => ({}));
      if (alive) setSteps((t?.spec?.steps ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      while (alive) {
        const r = await fetch(`${base}/events${after !== undefined ? `?after=${after}` : ''}`).catch(() => undefined);
        const list: TaskEvent[] = r?.ok ? await r.json().catch(() => []) : [];
        if (list.length) {
          after = list[list.length - 1].id;
          if (alive) setEvents(e => [...e, ...list]);
        }
        const done = list.find(e => e.type === 'completion');
        if (done) {
          if (alive) setStatus(done.body.status ?? 'completed');
          return;
        }
        await new Promise(res => setTimeout(res, 2000));
      }
    })();
    return () => {
      alive = false;
    };
  }, [discovery, fetch, id]);
  const states = stepStates(events);
  const output = events.find(e => e.type === 'completion')?.body.output as { links?: Array<{ title?: string; url?: string; entityRef?: string }> } | undefined;
  const failed = status === 'failed' || status === 'cancelled';
  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 980 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600, fontSize: 26 }}>
          Creating {title}
        </Typography>
        <Typography color="text.secondary">
          {status === 'processing' ? 'The template is running. You can leave this page; it goes on.' : null}
          {status === 'completed' ? 'Done. Merge the deployment pull request to deploy it.' : null}
          {failed ? 'The template stopped. The log says why.' : null}
        </Typography>
      </Box>
      <Box sx={card}>
        {steps.map(st => {
          const sst = states.get(st.id);
          let icon: ReactNode = <Box sx={{ width: 18, height: 18, borderRadius: '50%', border: 2, borderColor: 'divider' }} />;
          if (sst === 'completed') icon = <CheckCircle fontSize="small" sx={{ color: TONES.ok.fg }} />;
          else if (sst === 'failed') icon = <Cancel fontSize="small" sx={{ color: TONES.bad.fg }} />;
          else if (sst === 'processing') icon = <Box sx={{ width: 18, height: 18, borderRadius: '50%', border: 2, borderColor: accent, borderTopColor: 'transparent', animation: 'spin 1s linear infinite', '@keyframes spin': { to: { transform: 'rotate(360deg)' } }, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} />;
          return (
            <Box key={st.id} sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
              {icon}
              <Typography sx={{ fontWeight: sst === 'processing' ? 600 : 400 }}>{st.name}</Typography>
              {sst === 'skipped' && <Badge label="skipped" outlined />}
            </Box>
          );
        })}
        {status === 'processing' && !steps.length && <Progress />}
      </Box>
      {output?.links?.length ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {output.links.map(l => {
            if (l.entityRef) {
              const r = parseEntityRef(l.entityRef);
              return (
                <Btn key={l.title} to={`/console/entity/${r.namespace}/${r.kind.toLowerCase()}/${r.name}`} variant="contained" disableElevation sx={{ textTransform: 'none', bgcolor: accent }}>
                  {l.title}
                </Btn>
              );
            }
            return (
              <Btn key={l.title} href={l.url} target="_blank" rel="noreferrer" variant="outlined" sx={{ textTransform: 'none' }}>
                {l.title}
              </Btn>
            );
          })}
        </Box>
      ) : null}
      <Box>
        <Btn size="small" onClick={() => setShowLog(x => !x)} sx={{ textTransform: 'none' }}>
          {showLog ? 'Hide the log' : 'Show the log'}
        </Btn>
      </Box>
      {showLog && (
        <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '10px', fontSize: 12, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {events
            .filter(e => e.body.message)
            .map(e => e.body.message)
            .join('\n')}
        </Box>
      )}
    </Box>
  );
};

/** Development › New application: the template as a wizard inside the console, and its run in the same body. */
export const NewAppWizard = () => {
  const { template = '' } = useParams();
  const catalog = useApi(catalogApiRef);
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [tpl, setTpl] = useState<{ loading: boolean; entity?: Entity; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setTpl({ loading: true });
    catalog.getEntityByRef(`template:default/${template}`).then(
      e => alive && setTpl(e ? { loading: false, entity: e } : { loading: false, error: `There is no template ${template} in the catalog.` }),
      e => alive && setTpl({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog, template]);
  const steps = useMemo(() => (tpl.entity ? stepsOf(tpl.entity) : []), [tpl.entity]);
  const [values, setValues] = useState<Values>({});
  useEffect(() => setValues(defaultsOf(steps)), [steps]);
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [oldLines, setOldLines] = useState(false);
  const [task, setTask] = useState<{ id?: string; error?: string; starting?: boolean }>({});
  // another template from the menu: start again
  useEffect(() => {
    setStep(0);
    setTried(false);
    setTask({});
  }, [template]);
  const look = LOOK[template] ?? DEFAULT_LOOK;
  const accent = look.accent;
  const set = (k: string, v: unknown) => setValues(x => ({ ...x, [k]: v }));
  const props = useMemo(() => Object.assign({}, ...steps.map(x => x.properties)) as Record<string, Prop>, [steps]);

  if (tpl.loading) return <Progress />;
  if (tpl.error || !tpl.entity) return <WarningPanel title="The template could not be read" message={tpl.error} />;
  if (task.id) return <TaskView id={task.id} accent={accent} title={s(values.title) || s(values.name)} />;

  const all = [...steps, { title: 'Review', properties: {}, required: [] } as Step];
  const isReview = step === steps.length;
  const problems = isReview ? {} : problemsOf(steps[step], values);
  const name = s(values.name) || '<name>';
  const stage = s(values.initialStage) || 'dev';
  const env = arr(values.environments)[0] ?? '<zone>-<program>';
  const ns = `${env}-${name}${stage === 'pro' ? '' : `-${stage}`}-oneke`;
  const entities = s(values.entities) || '<entities>';
  const lines = linesOf(props.frameworkVersion);
  const line = lines.find(l => l.value === values.frameworkVersion);
  const blockOn = (b: (typeof BLOCKS)[number]) => (b.toggle ? !!values[b.toggle] : arr(values[b.list!]).length > 0);

  const next = () => {
    if (Object.keys(problems).length) {
      setTried(true);
      return;
    }
    setTried(false);
    setStep(step + 1);
  };
  const create = async () => {
    const bad = steps.findIndex(x => Object.keys(problemsOf(x, values)).length);
    if (bad >= 0) {
      setStep(bad);
      setTried(true);
      return;
    }
    setTask({ starting: true });
    try {
      const r = await fetch(`${await discovery.getBaseUrl('scaffolder')}/v2/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateRef: `template:default/${template}`, values: cleanValues(steps, values) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error?.message ?? `${r.status} ${r.statusText}`);
      setTask({ id: body.id });
    } catch (e) {
      setTask({ error: (e as Error).message });
    }
  };

  /** one field of the template, with the widget its schema asks for */
  const field = (k: string, p: Prop): ReactNode => {
    const err = tried ? problems[k] : undefined;
    const help = <Typography variant="caption" color={err ? 'error' : 'text.secondary'}>{err ?? p.description}</Typography>;
    const label = (p.title ?? k).replace('<name>', name);
    if (k === 'frameworkVersion') {
      const major = lines[0]?.value.split('.')[0];
      const shown = lines.filter((l, i) => oldLines || i === 0 || l.value.split('.')[0] === major);
      return (
        <Box key={k} sx={{ display: 'grid', gap: 0.75 }}>
          <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}>
            {shown.map((l, i) => {
              const on = values[k] === l.value;
              return (
                <Box key={l.value} component="button" type="button" aria-pressed={on} onClick={() => set(k, l.value)} sx={{ all: 'unset', cursor: 'pointer', border: 1, borderColor: on ? accent : 'divider', boxShadow: on ? `inset 0 0 0 1px ${accent}` : 'none', borderRadius: '10px', p: 1.25, display: 'grid', gap: 0.5, bgcolor: on ? 'action.selected' : 'background.paper', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
                    <b style={{ fontSize: 17 }}>{l.value}</b>
                    {i === 0 && <Badge label="latest" bg={TONES.ok.bg} fg={TONES.ok.fg} />}
                  </Box>
                  {l.what && <Typography variant="body2">{l.what}</Typography>}
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {l.releases.map(r => (
                      <Box key={r.name} component="span" sx={{ fontFamily: 'monospace', fontSize: 11.5, bgcolor: 'action.hover', borderRadius: '6px', px: 0.75 }}>
                        {r.name.replace(/^refresquito-/, '')} {r.version}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>
          {lines.length > shown.length || oldLines ? (
            <Box>
              <Btn size="small" onClick={() => setOldLines(x => !x)} sx={{ textTransform: 'none', px: 0.5 }}>
                {oldLines ? 'Hide older lines' : `Show older lines (${lines.length - shown.length})`}
              </Btn>
            </Box>
          ) : null}
          {help}
        </Box>
      );
    }
    if (p.type === 'boolean')
      return (
        <Box key={k} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
          <Toggle checked={!!values[k]} onChange={v => set(k, v)} label={label} accent={accent} />
        </Box>
      );
    if (p.type === 'array' && p.items?.enum)
      return (
        <Box key={k} sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {p.items.enum.map(o => (
              <Box component="label" key={o} sx={{ display: 'flex', gap: 0.75, alignItems: 'center', fontFamily: 'monospace' }}>
                <input type="checkbox" checked={arr(values[k]).includes(o)} onChange={e => set(k, e.target.checked ? [...arr(values[k]), o] : arr(values[k]).filter(x => x !== o))} />
                {o}
              </Box>
            ))}
          </Box>
          {help}
        </Box>
      );
    if (p.type === 'array')
      return (
        <Box key={k} sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontWeight: 500 }}>
            {label} <Badge label={String(arr(values[k]).filter(Boolean).length)} />
          </Typography>
          <ListField id={k} p={p} value={arr(values[k])} onChange={v => set(k, v)} prefix={PREFIXED.has(k) ? s(values.name) || '<name>' : undefined} accent={accent} />
          {help}
        </Box>
      );
    if (p.enum && p.enum.length <= 3)
      return (
        <Box key={k} sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {p.enum.map((o, i) => (
              <Btn key={o} variant={values[k] === o ? 'contained' : 'outlined'} disableElevation aria-pressed={values[k] === o} onClick={() => set(k, o)} sx={{ textTransform: 'none', bgcolor: values[k] === o ? accent : undefined }}>
                {p.enumNames?.[i] ?? o}
              </Btn>
            ))}
          </Box>
          {help}
        </Box>
      );
    if (p.enum)
      return (
        <TextField key={k} select size="small" label={label} value={s(values[k])} onChange={e => set(k, e.target.value)} error={!!err} helperText={err ?? p.description}>
          {p.enum.map((o, i) => (
            <MenuItem key={o} value={o}>
              {p.enumNames?.[i] ?? o}
            </MenuItem>
          ))}
        </TextField>
      );
    return (
      <TextField
        key={k}
        size="small"
        label={label}
        value={s(values[k])}
        onChange={e => set(k, e.target.value)}
        error={!!err}
        helperText={err ?? p.description}
        inputProps={{ style: ['name', 'entity', 'entities', 'owner'].includes(k) ? { fontFamily: 'monospace' } : undefined }}
      />
    );
  };

  const stepBody = (st: Step) => {
    const keys = Object.keys(st.properties);
    if (!keys.some(k => blockFields.has(k))) return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>{keys.map(k => field(k, st.properties[k]))}</Box>;
    const rest = keys.filter(k => !blockFields.has(k));
    return (
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', alignItems: 'start' }}>
          {BLOCKS.filter(b => (b.toggle && st.properties[b.toggle]) || (b.list && st.properties[b.list])).map(b => {
            const on = blockOn(b);
            const desc = st.properties[b.toggle ?? b.list!]?.description;
            return (
              <Box key={b.id} sx={{ border: 1, borderColor: on ? accent : 'divider', borderRadius: '12px', p: 1.5, display: 'grid', gap: 1, bgcolor: on ? 'action.hover' : 'background.paper' }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>{b.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {b.product}
                    </Typography>
                  </Box>
                  {b.toggle ? (
                    <Toggle checked={on} onChange={v => set(b.toggle!, v)} label={`${b.label} (${b.product})`} accent={accent} />
                  ) : (
                    <Toggle checked={on} onChange={v => set(b.list!, v ? [''] : [])} label={`${b.label} (${b.product})`} accent={accent} />
                  )}
                </Box>
                {desc && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: on ? 'unset' : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {desc}
                  </Typography>
                )}
                {on && b.fields.filter(f => st.properties[f]).map(f => field(f, b.list === f ? { ...st.properties[f], description: undefined } : st.properties[f]))}
              </Box>
            );
          })}
        </Box>
        {rest.map(k => field(k, st.properties[k]))}
      </Box>
    );
  };

  const review = (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {steps.map((st, i) => (
        <Box key={st.title} sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.25, display: 'grid', gap: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>{st.title}</b>
            <Btn size="small" onClick={() => setStep(i)} sx={{ textTransform: 'none' }}>
              Change
            </Btn>
          </Box>
          {Object.entries(st.properties)
            .filter(([k]) => {
              const v = values[k];
              return Array.isArray(v) ? v.filter(Boolean).length : v !== '' && v !== false && v !== undefined;
            })
            .map(([k, p]) => {
              const v = values[k];
              let shown: string;
              if (Array.isArray(v)) shown = v.filter(Boolean).map(x => (PREFIXED.has(k) ? `${name}-${x}` : String(x))).join(', ');
              else if (v === true) shown = 'yes';
              else shown = String(v);
              return (
                <Box key={k} sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) minmax(0, 1fr)', gap: 1, fontSize: 13.5 }}>
                  <Box sx={{ color: 'text.secondary' }}>{(p.title ?? k).replace('<name>', name)}</Box>
                  <Box sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{shown}</Box>
                </Box>
              );
            })}
        </Box>
      ))}
      {task.error && <WarningPanel severity="error" title="The template could not start" message={task.error} />}
    </Box>
  );

  const box = (label: ReactNode, sub?: string, strong?: boolean) => (
    <Box sx={{ border: 1, borderColor: strong ? accent : 'divider', borderRadius: '10px', px: 1.25, py: 0.75, display: 'flex', gap: 1, alignItems: 'center', bgcolor: 'background.default' }}>
      <Box sx={{ fontWeight: 600 }}>{label}</Box>
      {sub && <Box sx={{ ml: 'auto', fontFamily: 'monospace', fontSize: 11.5, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</Box>}
    </Box>
  );
  const arrow = (t = '↓') => <Box sx={{ textAlign: 'center', color: 'text.secondary', fontSize: 12, lineHeight: 1 }}>{t}</Box>;
  const host = `${name}${stage === 'pro' ? '' : `-${stage}`}.<domain>`;
  const names: Array<[string, string]> = [
    ['Repository', `${s(values.owner) || '<owner>'}/${name}`],
    ['Address', `https://${host}`],
    ['Namespace', ns],
    ['API', look.arch === 'micro' ? `services/${entities} · /api/${entities}` : `/api/${entities}`],
    ...(values.sso ? ([['Roles', `${name}${stage === 'pro' ? '' : `-${stage}`}-viewer · -admin`]] as Array<[string, string]>) : []),
    ...(['s3Buckets', 'dmsSites'] as const).filter(k => arr(values[k]).filter(Boolean).length).map(k => [k === 's3Buckets' ? 'Buckets' : 'Sites', arr(values[k]).filter(Boolean).map(x => `${name}-${x}`).join('\n')] as [string, string]),
    ...(values.gateway ? ([['Gateway', `/gateway/${name}/`]] as Array<[string, string]>) : []),
    ...(line ? ([['Framework', `${line.value} · ${line.releases.map(r => `${r.name.replace(/^refresquito-/, '')} ${r.version}`).join(', ')}`]] as Array<[string, string]>) : []),
  ];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', color: '#fff', bgcolor: accent, fontFamily: 'monospace', fontWeight: 700 }}>{look.logo}</Box>
        <Box sx={{ minWidth: 0, flex: '1 1 400px' }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600, fontSize: 26 }}>
            {tpl.entity.metadata.title ?? template}
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: '80ch' }}>
            {tpl.entity.metadata.description}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {look.stack.map(x => (
            <Badge key={x} label={x} outlined />
          ))}
        </Box>
      </Box>

      <Box role="list" aria-label="Steps" sx={{ display: 'flex', border: 1, borderColor: 'divider', borderRadius: '12px', bgcolor: 'background.paper', overflowX: 'auto' }}>
        {all.map((st, i) => (
          <Box
            role="listitem"
            key={st.title}
            component="button"
            type="button"
            aria-current={i === step ? 'step' : undefined}
            onClick={() => i <= step && setStep(i)}
            sx={{ all: 'unset', cursor: i <= step ? 'pointer' : 'default', flex: '1 1 0', minWidth: 120, px: 1.75, py: 1.25, display: 'grid', gap: 0.25, borderRight: 1, borderColor: 'divider', position: 'relative', bgcolor: i === step ? 'action.selected' : undefined, '&:last-of-type': { borderRight: 0 }, '&::after': i === step ? { content: '""', position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, bgcolor: accent } : {}, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
          >
            <Box component="small" sx={{ fontFamily: 'monospace', fontSize: 11, color: i < step ? TONES.ok.fg : 'text.secondary' }}>
              {i < step ? '✓ done' : `step ${i + 1} of ${all.length}`}
            </Box>
            <Box sx={{ fontWeight: 500 }}>{st.title}</Box>
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 360px' }, alignItems: 'start' }}>
        <Box component="form" onSubmit={e => e.preventDefault()} sx={card}>
          <Box>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
              {all[step].title}
            </Typography>
            {(isReview ? 'Check it, then create. Nothing is created until you press Create.' : all[step].description) && (
              <Typography variant="body2" color="text.secondary">
                {isReview ? 'Check it, then create. Nothing is created until you press Create.' : all[step].description}
              </Typography>
            )}
          </Box>
          {isReview ? review : stepBody(steps[step])}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            {step > 0 ? (
              <Btn variant="outlined" onClick={() => setStep(step - 1)} sx={{ textTransform: 'none' }}>
                Back
              </Btn>
            ) : (
              <span />
            )}
            {isReview ? (
              <Btn variant="contained" disableElevation disabled={task.starting} onClick={create} sx={{ textTransform: 'none', bgcolor: accent }}>
                {task.starting ? 'Starting…' : 'Create'}
              </Btn>
            ) : (
              <Btn variant="contained" disableElevation onClick={next} sx={{ textTransform: 'none', bgcolor: accent }}>
                Next
              </Btn>
            )}
          </Box>
        </Box>

        <Box component="aside" aria-label="What you will get" sx={{ display: 'grid', gap: 1.5, position: { lg: 'sticky' }, top: 12 }}>
          <Box sx={card}>
            {overline('What you will get')}
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              {box('Browser', host)}
              {arrow('↓ HTTPS · Keycloak login')}
              {box('Web · Angular', '/', true)}
              {look.arch === 'micro' ? (
                <>
                  {arrow('↓ /api/…')}
                  <Box sx={{ display: 'grid', gap: 0.75, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                    <Box sx={{ border: 1, borderColor: accent, borderRadius: '10px', p: 1, bgcolor: 'background.default' }}>
                      <b>{entities}</b>
                      <Typography variant="caption" display="block" color="text.secondary">
                        Spring Boot · PostgreSQL {entities}
                      </Typography>
                    </Box>
                    <Box sx={{ border: 1, borderColor: accent, borderRadius: '10px', p: 1, bgcolor: 'background.default' }}>
                      <b>notifier</b>
                      <Typography variant="caption" display="block" color="text.secondary">
                        handles its events
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ border: '1px dashed', borderColor: accent, borderRadius: '8px', px: 1, py: 0.5, textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: accent }}>events between services</Box>
                </>
              ) : (
                <>
                  {arrow()}
                  {box('API · FastAPI', `/api/${entities}`, true)}
                  {arrow()}
                  {box('PostgreSQL', `table ${s(values.entity) || '<entity>'}`)}
                </>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {BLOCKS.filter(b => props[b.toggle ?? b.list!] && blockOn(b)).map(b => (
                <Badge key={b.id} label={b.product} />
              ))}
            </Box>
          </Box>
          <Box sx={card}>
            {overline('Its names')}
            <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 12px', m: 0, fontSize: 13, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, fontFamily: 'monospace', fontSize: 12.5, overflowWrap: 'anywhere', whiteSpace: 'pre-line' } }}>
              {names.map(([a, b]) => (
                <Box key={a} sx={{ display: 'contents' }}>
                  <dt>{a}</dt>
                  <dd>{b}</dd>
                </Box>
              ))}
            </Box>
          </Box>
          <Box sx={card}>
            {overline('After Create')}
            <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75, fontSize: 13.5 }}>
              <li>The repository {s(values.owner) || '<owner>'}/{name}, private, with its first {s(values.entity) || 'entity'} working.</li>
              <li>A pull request to refresquito-services with its file; merging it is what deploys.</li>
              <li>Argo CD deploys it in {ns}, in about 10 minutes.</li>
              <li>It shows in the Catalogue with Docs, Quality, Costs and Dependencies.</li>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
