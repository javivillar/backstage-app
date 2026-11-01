import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Content, Header, MarkdownContent, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import MenuItem from '@mui/material/MenuItem';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/** The conversation as the backend returns it (plugins/ops-assistant-backend/src/model/types.ts). Opaque here. */
type Message = { role: 'user' | 'assistant'; parts: Array<{ type: string; text?: string }> };
type ToolCall = { name: string; input: Record<string, unknown>; isError: boolean; chars: number };
/** job: the question being answered on the backend, kept so the page can collect it after being left or reloaded */
type Exchange = { question: string; job?: string; answer?: string; toolCalls?: ToolCall[]; model?: string; usage?: Record<string, number>; error?: string; ms?: number };
type JobProgress = { toolCalls: ToolCall[]; elapsedMs: number };
type Info = { enabled: boolean; allowed: boolean; model?: string; maxSteps?: number; title?: string; keepDays?: number };
/**
 * the conversation open in the page: id is its key in the backend (plugins/ops-assistant-backend/src/conversations.ts);
 * system, the one its questions are charged to (page /costs); without it, the backend works it out from the tools
 */
type State = { id: string; messages: Message[]; exchanges: Exchange[]; system?: string };
type Summary = { id: string; title: string; updatedAt: string };

/**
 * One assistant of Backstage (plugins/ops-assistant-backend: one engine, one block of config per assistant): where its
 * API is and what its page says. Each one keeps its own conversation (a session apart).
 */
export interface AssistantProfile {
  /** its routes under /api/ops-assistant: '' for the operations assistant (as before), '/sec' for the security one */
  path: string;
  /** where the tab keeps the open conversation (sessionStorage); every conversation is also kept in the backend */
  store: string;
  title: string;
  subtitle: string;
  /** what it does, above the conversation */
  intro: string;
  examples: string[];
  placeholder: string;
  /** shown while it works: "Looking at the cluster…" */
  working: string;
  notConfigured: string;
  /** what it does, reads, writes and never does (the Team page of the console) */
  role?: { does: string; reads: string; writes: string; never: string };
  /** a question about one project: the page was opened with ?project=<name> (the button of an entity) */
  aboutProject?: (project: string) => { examples: string[]; prefix: string };
}

/** the choice "no system": the backend charges what the tools looked at, or the platform */
const FROM_TOOLS = '';

const POLL_MS = 2000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** the page was left while waiting: the job keeps going on the backend and the page collects it when it comes back */
class Left extends Error {}
const pending = (x?: Exchange) => !!x && !x.answer && !x.error;

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
/** a conversation id (UUID v4); randomUUID needs https, the fallback is for tests and plain http */
const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
const empty = (system?: string): State => ({ id: newId(), messages: [], exchanges: [], ...(system ? { system } : {}) });
/** what the backend lists it as: its first question */
const titleOf = (s: State) => (s.exchanges[0]?.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
/** what is saved in the backend (and compared, to save only what changed) */
const saved = (s: State) => JSON.stringify({ messages: s.messages, exchanges: s.exchanges, ...(s.system ? { system: s.system } : {}) });
const systemOf = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** the open conversation of the tab; null when the tab has none (a new tab: the page opens the last one) */
function load(store: string): State | null {
  try {
    const raw = sessionStorage.getItem(store);
    if (raw) {
      const s = JSON.parse(raw);
      // pages before the conversations were kept had no id
      return { id: s.id ?? newId(), messages: s.messages ?? [], exchanges: s.exchanges ?? [], ...(systemOf(s.system) ? { system: s.system } : {}) };
    }
  } catch {
    // no storage: start empty
  }
  return null;
}

function save(store: string, state: State) {
  try {
    sessionStorage.setItem(store, JSON.stringify(state));
  } catch {
    // too big or no storage: the conversation lives in the page only
  }
}

const describe = (t: ToolCall) => {
  const args = Object.entries(t.input)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return args ? `${t.name} ${args}` : t.name;
};

/**
 * The page of an assistant: questions answered by a model that looks with the READ-ONLY tools of its MCP server. It
 * proposes; the operator acts. OpsAssistantPage and SecAssistantPage are this page with their profile.
 */
/**
 * The assistants of the console variant (this one included, current): its title, console page, colour, icon and the
 * path of its API under /api/ops-assistant, to list its conversations next to this one's.
 */
export type AssistantLink = { title: string; to: string; current: boolean; colour?: string; icon?: ReactNode; path?: string };
type OtherSummary = Summary & { assistant: AssistantLink };

export const AssistantPage = ({ profile, variant = 'classic', others = [] }: { profile: AssistantProfile; variant?: 'classic' | 'console'; others?: AssistantLink[] }) => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const catalog = useApi(catalogApiRef);
  const [params] = useSearchParams();
  const project = params.get('project')?.trim() || undefined;
  // ?conversation=<id> opens that conversation; ?ask=<question> fills the box (a hand-over from another assistant)
  const wanted = params.get('conversation') ?? undefined;
  const prefill = params.get('ask') ?? undefined;
  /** the system the page was opened for (?system=<name>, or the system of ?project=<name>) */
  const asked = params.get('system')?.trim().toLocaleLowerCase('en-US') || undefined;
  /** the systems of the catalog, to choose the one the questions are charged to */
  const [systems, setSystems] = useState<string[]>([]);
  const about = project && profile.aboutProject ? profile.aboutProject(project) : undefined;
  const [info, setInfo] = useState<Info | undefined>();
  const [infoError, setInfoError] = useState<string | undefined>();
  const stored = useRef(load(profile.store));
  const [state, setState] = useState<State>(() => stored.current ?? empty(asked));
  /** the user's conversations with this assistant (undefined while loading); why they are not kept, if so */
  const [conversations, setConversations] = useState<Summary[] | undefined>();
  const [keepError, setKeepError] = useState<string | undefined>();
  /** what the backend has of the open conversation, so that it is saved only when it changes */
  // a conversation the tab had from before they were kept in the backend is saved when the page opens
  const lastSaved = useRef<string>(stored.current?.exchanges.length ? '' : saved(state));
  const [question, setQuestion] = useState(about?.prefix ?? '');
  const api = async () => `${await discovery.getBaseUrl('ops-assistant')}${profile.path}`;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<JobProgress | undefined>();
  const current = useRef<string | undefined>();
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  /** the conversation whose question left waiting was already taken up */
  const resumed = useRef<string | undefined>();
  /** console: the conversations of the other assistants, and the assistant the list shows ('all' or its page) */
  const [otherConversations, setOtherConversations] = useState<OtherSummary[]>([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const base = await api();
      const res = await fetch(`${base}/info`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    })().then(setInfo, e => setInfoError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discovery, fetch, profile.path]);

  useEffect(() => {
    catalog
      .getEntities({ filter: { kind: 'system' }, fields: ['metadata.name'] })
      .then(({ items }) => setSystems(items.map(e => e.metadata.name.toLocaleLowerCase('en-US')).sort()))
      .catch(() => setSystems([]));
  }, [catalog]);

  // opened from a project: its questions are charged to the system of the project, unless one is already chosen
  useEffect(() => {
    if (asked || !project) return;
    catalog
      .getEntities({ filter: { kind: 'component', 'metadata.name': project }, fields: ['spec.system'] })
      .then(({ items }) => {
        const s = items[0]?.spec?.system;
        if (typeof s === 'string' && s)
          setState(st => (st.system || st.exchanges.length ? st : { ...st, system: s.split('/').pop()!.toLocaleLowerCase('en-US') }));
      })
      .catch(() => undefined);
  }, [catalog, asked, project]);

  useEffect(() => {
    save(profile.store, state);
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [profile.store, state]);

  // kept in the backend after each change (a question asked, its job, its answer), so another tab or computer has it
  useEffect(() => {
    const body = saved(state);
    if (!state.exchanges.length || body === lastSaved.current) return;
    lastSaved.current = body;
    const title = titleOf(state);
    (async () => {
      const res = await fetch(`${await api()}/conversations/${state.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, state: JSON.parse(body) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status} ${res.statusText}`);
    })().then(
      () => {
        setKeepError(undefined);
        setConversations(l => [{ id: state.id, title, updatedAt: new Date().toISOString() }, ...(l ?? []).filter(c => c.id !== state.id)]);
      },
      e => {
        lastSaved.current = '';
        setKeepError((e as Error).message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const open = async (id: string) => {
    const res = await fetch(`${await api()}/conversations/${id}`);
    const c = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(c.error ?? `${res.status} ${res.statusText}`);
    const sys = systemOf(c.state?.system);
    const next: State = { id, messages: c.state?.messages ?? [], exchanges: c.state?.exchanges ?? [], ...(sys ? { system: sys } : {}) };
    lastSaved.current = saved(next);
    setState(next);
  };

  // the user's conversations; a new tab opens the most recent one
  useEffect(() => {
    if (!info?.allowed || !info.enabled) return;
    (async () => {
      const res = await fetch(`${await api()}/conversations`);
      const list = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(list.error ?? `${res.status} ${res.statusText}`);
      return list as Summary[];
    })().then(
      list => {
        setConversations(list);
        if (!stored.current && !wanted && !prefill && list.length) open(list[0].id).catch(e => setKeepError((e as Error).message));
      },
      e => {
        setConversations([]);
        setKeepError((e as Error).message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // console: the other assistants' conversations, listed with this one's (each opens in its own page)
  useEffect(() => {
    if (variant !== 'console') return;
    const rest = others.filter(o => !o.current && o.path !== undefined);
    (async () => {
      const base = await discovery.getBaseUrl('ops-assistant');
      const lists = await Promise.all(
        rest.map(async o => {
          const res = await fetch(`${base}${o.path}/conversations`).catch(() => undefined);
          const list: Summary[] = res?.ok ? await res.json().catch(() => []) : [];
          return (Array.isArray(list) ? list : []).map(c => ({ ...c, assistant: o }));
        }),
      );
      return lists.flat();
    })().then(l => mounted.current && setOtherConversations(l), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, discovery, fetch, others.map(o => o.to).join()]);

  useEffect(() => {
    if (wanted && info?.allowed && info.enabled && wanted !== state.id) open(wanted).catch(e => setKeepError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, info]);
  useEffect(() => {
    if (!prefill) return;
    if (stored.current?.exchanges.length) {
      const next = empty(asked ?? stored.current.system);
      lastSaved.current = saved(next);
      resumed.current = next.id;
      setState(next);
    }
    setQuestion(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const reset = () => {
    // a new conversation goes on being charged to the same system
    const next = empty(state.system);
    lastSaved.current = saved(next);
    resumed.current = next.id;
    setState(next);
  };

  const remove = async (id: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this conversation?')) return;
    const res = await fetch(`${await api()}/conversations/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      setKeepError(`${res.status} ${res.statusText}`);
      return;
    }
    setConversations(l => (l ?? []).filter(c => c.id !== id));
    if (id === state.id) reset();
  };

  /** waits for the job and returns the finished exchange and the conversation after it */
  const collect = async (x: Exchange, id: string, started: number): Promise<{ done: Exchange; messages?: Message[] }> => {
    const base = await api();
    current.current = id;
    for (;;) {
      await sleep(POLL_MS);
      if (!mounted.current) throw new Left();
      const poll = await fetch(`${base}/chat/${id}`);
      const job = await poll.json().catch(() => ({}));
      if (!mounted.current) throw new Left();
      if (!poll.ok) throw new Error(job.error ?? `${poll.status} ${poll.statusText}`);
      if (job.status === 'running') {
        setProgress({ toolCalls: job.toolCalls ?? [], elapsedMs: job.elapsedMs ?? Date.now() - started });
        continue;
      }
      if (job.status === 'error') throw new Error(job.error ?? 'The model could not answer');
      if (job.status === 'cancelled') throw new Error('Cancelled. The conversation stays as it was before this question.');
      const turn = job.turn;
      const { job: _, ...rest } = x;
      return {
        done: { ...rest, answer: turn.answer, toolCalls: turn.toolCalls, model: turn.model, usage: turn.usage, ms: job.elapsedMs },
        messages: turn.messages,
      };
    }
  };

  /** the last exchange ends: answered, or with the error; on Left the page is gone and the exchange stays pending */
  const follow = async (x: Exchange, work: () => Promise<{ done: Exchange; messages?: Message[] }>) => {
    let result: { done: Exchange; messages?: Message[] };
    try {
      result = await work();
    } catch (e) {
      if (e instanceof Left) return;
      const { job: _, ...rest } = x;
      result = { done: { ...rest, error: (e as Error).message } };
    }
    current.current = undefined;
    setProgress(undefined);
    setState(s => ({ ...s, messages: result.messages ?? s.messages, exchanges: [...s.exchanges.slice(0, -1), result.done] }));
    setBusy(false);
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion('');
    const started = Date.now();
    setState(s => ({ ...s, exchanges: [...s.exchanges, { question: text }] }));
    await follow({ question: text }, async () => {
      const base = await api();
      // the backend starts the work and answers at once; the answer is collected below (a question can take minutes,
      // longer than the proxies keep a request open)
      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, messages: state.messages, ...(state.system ? { system: state.system } : {}) }),
      });
      const begun = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(begun.error ?? `${res.status} ${res.statusText}`);
      // kept with the question: if the page is left or reloaded now, it collects the answer when it comes back
      const x = { question: text, job: begun.id as string };
      setState(s => ({ ...s, exchanges: [...s.exchanges.slice(0, -1), x] }));
      return collect(x, begun.id, started);
    });
  };

  // a question left waiting (page left or reloaded, or a conversation opened with one): collect its answer, or say
  // why there is none
  useEffect(() => {
    const last = state.exchanges[state.exchanges.length - 1];
    if (resumed.current === state.id) return;
    resumed.current = state.id;
    if (!pending(last)) return;
    const id = last.job;
    setBusy(true);
    follow(last, async () => {
      if (!id) throw new Error('The page was left while this question was being answered and its answer was not kept: ask it again.');
      return collect(last, id, Date.now());
    });
    // only when a conversation is opened (the page opens, another one is chosen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.id]);


  // the next poll sees the job cancelled and ends the question
  const cancel = async () => {
    const id = current.current;
    if (!id) return;
    const base = await api();
    await fetch(`${base}/chat/${id}`, { method: 'DELETE' }).catch(() => undefined);
  };

  let body;
  if (infoError) body = <WarningPanel title="The assistant is not reachable" message={infoError} />;
  else if (!info) body = <Progress />;
  else if (!info.allowed) body = <WarningPanel title="No access" message={`You are not in a group allowed to use the ${profile.title.toLowerCase()}.`} />;
  else if (!info.enabled) body = <WarningPanel title="Not configured" message={profile.notConfigured} />;
  else
    body = (
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
      <Box sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0 }}>
        <Button fullWidth variant="outlined" disabled={busy || !state.exchanges.length} onClick={reset}>
          New conversation
        </Button>
        <List dense sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {conversations?.map(c => (
            <ListItem
              key={c.id}
              disablePadding
              secondaryAction={
                <IconButton edge="end" size="small" aria-label="Delete" title="Delete" disabled={busy} onClick={() => remove(c.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemButton
                selected={c.id === state.id}
                disabled={busy}
                onClick={() => c.id !== state.id && open(c.id).catch(e => setKeepError((e as Error).message))}
              >
                <ListItemText
                  primary={c.title}
                  secondary={new Date(c.updatedAt).toLocaleString()}
                  primaryTypographyProps={{ noWrap: true, title: c.title }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Typography variant="caption" color={keepError ? 'warning.main' : 'text.secondary'} display="block">
          {keepError ? `Conversations are not being kept: ${keepError}` : `Kept ${info.keepDays ?? 90} days after their last change, only for you.`}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, maxWidth: 1100 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {profile.intro} Model: {info.model}. Check what it says before acting on it.
        </Typography>
        {state.exchanges.length === 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {(about?.examples ?? profile.examples).map(e => (
              <Chip key={e} label={e} onClick={() => ask(e)} variant="outlined" />
            ))}
          </Box>
        )}
        {state.exchanges.map((x, i) => (
          <Box key={i} sx={{ mb: 3 }}>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: 'action.hover' }}>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{x.question}</Typography>
            </Paper>
            {!x.answer && !x.error && (
              <Box>
                <Progress />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  {progress
                    ? `${profile.working} ${(progress.elapsedMs / 1000).toFixed(0)} s, ${progress.toolCalls.length} tools called`
                    : 'Thinking…'}
                </Typography>
                {!!progress?.toolCalls.length && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {progress.toolCalls.map((t, j) => (
                      <Chip key={j} size="small" variant="outlined" label={describe(t)} color={t.isError ? 'warning' : 'default'} />
                    ))}
                  </Box>
                )}
              </Box>
            )}
            {x.error && <WarningPanel severity="error" title="No answer" message={x.error} />}
            {x.answer && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <MarkdownContent content={x.answer} dialect="gfm" />
                {!!x.toolCalls?.length && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Tools used:
                    </Typography>
                    {x.toolCalls.map((t, j) => (
                      <Chip key={j} size="small" label={describe(t)} color={t.isError ? 'warning' : 'default'} title={`${t.chars} characters`} />
                    ))}
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  {x.model}
                  {x.ms !== undefined && ` · ${(x.ms / 1000).toFixed(0)} s`}
                  {x.usage && ` · tokens in ${x.usage.input ?? 0} (cached ${x.usage.cacheRead ?? 0}) out ${x.usage.output ?? 0}`}
                </Typography>
              </Paper>
            )}
          </Box>
        ))}
        <div ref={bottom} />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            placeholder={profile.placeholder}
            value={question}
            disabled={busy}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(question);
              }
            }}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button variant="contained" disabled={busy || !question.trim()} onClick={() => ask(question)}>
              Ask
            </Button>
            {busy ? (
              <Button color="warning" variant="outlined" onClick={cancel}>
                Cancel
              </Button>
            ) : (
              <Button disabled={!state.exchanges.length} onClick={reset}>
                New
              </Button>
            )}
          </Box>
        </Box>
        <TextField
          select
          size="small"
          label="Charge its cost to"
          value={state.system ?? FROM_TOOLS}
          disabled={busy}
          onChange={e => {
            const system = e.target.value || undefined;
            setState(({ system: _, ...s }) => (system ? { ...s, system } : s));
          }}
          helperText="What each question consumes is charged to this system in Costs; without one, to what the assistant looks at."
          sx={{ mt: 1.5, minWidth: 320 }}
        >
          <MenuItem value={FROM_TOOLS}>What it looks at</MenuItem>
          {[...new Set([...systems, ...(state.system ? [state.system] : [])])].sort().map(s => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      </Box>
    );

  if (variant === 'console') {
    const usage = state.exchanges.reduce((t, x) => t + (x.usage?.input ?? 0) + (x.usage?.output ?? 0), 0);
    const card = { border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper' } as const;
    const me = others.find(o => o.current);
    const colour = me?.colour ?? '#1A8DFF';
    const tools = state.exchanges.flatMap(x => x.toolCalls ?? []);
    const byTool = [...tools.reduce((m, t) => m.set(t.name, (m.get(t.name) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
    const lastQuestion = state.exchanges[state.exchanges.length - 1]?.question;
    const handOver = (o: AssistantLink) => {
      const q = new URLSearchParams();
      if (state.system) q.set('system', state.system);
      if (lastQuestion) q.set('ask', `From the ${profile.title.toLowerCase()}: ${lastQuestion}`);
      return `${o.to}?${q.toString()}`;
    };
    let status: JSX.Element | undefined;
    if (infoError) status = <WarningPanel title="The assistant is not reachable" message={infoError} />;
    else if (!info) status = <Progress />;
    else if (!info.allowed) status = <WarningPanel title="No access" message={`You are not in a group allowed to use the ${profile.title.toLowerCase()}.`} />;
    else if (!info.enabled) status = <WarningPanel title="Not configured" message={profile.notConfigured} />;
    const all = [
      ...(conversations ?? []).map(c => ({ ...c, assistant: me })),
      ...otherConversations,
    ].filter(c => filter === 'all' || c.assistant?.to === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const Avatar = ({ o, size = 30 }: { o?: AssistantLink; size?: number }) => (
      <Box component="span" aria-hidden sx={{ width: size, height: size, borderRadius: size > 32 ? '12px' : '8px', display: 'grid', placeItems: 'center', color: '#fff', bgcolor: o?.colour ?? colour, flexShrink: 0, fontWeight: 700, fontSize: size * 0.45 }}>
        {o?.icon ?? (o?.title ?? profile.title).charAt(0)}
      </Box>
    );
    return (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '270px minmax(0, 1fr) 290px' }, alignItems: 'start' }}>
        <Box sx={{ ...card, p: 1.5, display: 'grid', gap: 1.25 }}>
          <Button variant="contained" disabled={busy || !state.exchanges.length} onClick={reset} sx={{ textTransform: 'none' }}>
            New conversation
          </Button>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {[{ title: 'All', to: 'all' } as AssistantLink, ...others].map(o => (
              <Chip key={o.to} size="small" label={o.title} onClick={() => setFilter(o.to)} color={filter === o.to ? 'primary' : 'default'} variant={filter === o.to ? 'filled' : 'outlined'} />
            ))}
          </Box>
          <Typography variant="caption" color={keepError ? 'warning.main' : 'text.secondary'}>
            {keepError ? `Conversations are not being kept: ${keepError}` : `Kept ${info?.keepDays ?? 90} days, only for you.`}
          </Typography>
          <List dense sx={{ maxHeight: '58vh', overflowY: 'auto', p: 0 }}>
            {all.map(c => {
              const mine = !c.assistant || c.assistant === me;
              return (
                <ListItem
                  key={`${c.assistant?.to ?? ''}${c.id}`}
                  disablePadding
                  secondaryAction={
                    mine ? (
                      <IconButton edge="end" size="small" aria-label={`Delete ${c.title}`} title="Delete" disabled={busy} onClick={() => remove(c.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    ) : undefined
                  }
                >
                  <ListItemButton
                    selected={mine && c.id === state.id}
                    disabled={busy}
                    sx={{ borderRadius: '10px', gap: 1 }}
                    {...(mine ? { onClick: () => c.id !== state.id && open(c.id).catch(e => setKeepError((e as Error).message)) } : { component: 'a', href: `${c.assistant!.to}?conversation=${c.id}` })}
                  >
                    <Avatar o={c.assistant} size={28} />
                    <ListItemText primary={c.title} secondary={`${c.assistant?.title ?? profile.title} · ${new Date(c.updatedAt).toLocaleDateString()}`} primaryTypographyProps={{ noWrap: true, title: c.title, fontSize: 14 }} />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
        <Box sx={{ ...card, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', minHeight: 620, minWidth: 0 }}>
          <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
            <Avatar o={me} size={38} />
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{profile.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                read-only tools · it proposes, a person acts
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            {state.system && <Chip size="small" color="primary" variant="outlined" label={`about ${state.system}`} />}
            {info?.model && <Chip size="small" label={info.model} />}
          </Box>
          <Box sx={{ p: 2, display: 'grid', gap: 2, alignContent: 'start', minWidth: 0 }}>
            {status}
            {!status && state.exchanges.length === 0 && (
              <>
                <Typography color="text.secondary">{profile.intro}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {(about?.examples ?? profile.examples).map(e => (
                    <Chip key={e} label={e} onClick={() => ask(e)} variant="outlined" sx={{ borderStyle: 'dashed' }} />
                  ))}
                </Box>
              </>
            )}
            {state.exchanges.map((x, i) => {
              const calls = x.toolCalls ?? (pending(x) ? progress?.toolCalls : undefined) ?? [];
              return (
                <Box key={i} sx={{ display: 'grid', gap: 1.25 }}>
                  <Box sx={{ justifySelf: 'end', maxWidth: '75%', bgcolor: colour, color: '#fff', px: 1.75, py: 1.1, borderRadius: '14px 14px 4px 14px' }}>
                    <Typography sx={{ whiteSpace: 'pre-wrap' }}>{x.question}</Typography>
                  </Box>
                  {calls.length > 0 && (
                    <Box aria-label="What it looked at" sx={{ display: 'grid', gap: 0.4, borderLeft: 2, borderColor: 'divider', pl: 1.5, fontSize: 13, color: 'text.secondary', fontFamily: 'monospace' }}>
                      {calls.map((t, j) => (
                        <Box key={j} sx={{ color: t.isError ? 'warning.main' : undefined, overflowWrap: 'anywhere' }}>
                          {t.isError ? '✕ ' : '› '}
                          {describe(t)}
                        </Box>
                      ))}
                    </Box>
                  )}
                  {pending(x) && (
                    <Box>
                      <Progress />
                      <Typography variant="caption" color="text.secondary">
                        {progress ? `${profile.working} ${(progress.elapsedMs / 1000).toFixed(0)} s` : 'Thinking…'}
                      </Typography>
                    </Box>
                  )}
                  {x.error && <WarningPanel severity="error" title="No answer" message={x.error} />}
                  {x.answer && (
                    <Box sx={{ display: 'grid', gap: 1, maxWidth: '86ch' }}>
                      <Box sx={{ borderLeft: 4, borderColor: colour, pl: 1.75 }}>
                        <MarkdownContent content={x.answer} dialect="gfm" />
                      </Box>
                      {i === state.exchanges.length - 1 && (
                        <Box sx={{ bgcolor: 'action.hover', borderRadius: '12px', p: 1.25, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mr: 0.5 }}>
                            Next
                          </Typography>
                          {others
                            .filter(o => !o.current)
                            .map(o => (
                              <Button key={o.to} size="small" variant="outlined" href={handOver(o)} sx={{ textTransform: 'none' }}>
                                Hand over to {o.title}
                              </Button>
                            ))}
                          <Button size="small" href="/console/app/support" sx={{ textTransform: 'none' }}>
                            Open an incident
                          </Button>
                        </Box>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {x.model}
                        {x.ms !== undefined && ` · ${(x.ms / 1000).toFixed(0)} s`}
                        {x.usage && ` · ${(((x.usage.input ?? 0) + (x.usage.output ?? 0)) / 1000).toFixed(1)} k tokens`}
                        {state.system && ` · charged to ${state.system}`}
                      </Typography>
                    </Box>
                  )}
                </Box>
              );
            })}
            <div ref={bottom} />
          </Box>
          <Box sx={{ borderTop: 1, borderColor: 'divider', p: 1.25, display: 'grid', gap: 1 }}>
            {state.exchanges.length > 0 && !status && (
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {(about?.examples ?? profile.examples).slice(0, 3).map(e => (
                  <Chip key={e} size="small" label={e} onClick={() => ask(e)} variant="outlined" sx={{ borderStyle: 'dashed' }} />
                ))}
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', border: 1, borderColor: 'divider', borderRadius: '12px', p: 1, bgcolor: 'background.default' }}>
              <TextField
                fullWidth
                multiline
                maxRows={6}
                variant="standard"
                InputProps={{ disableUnderline: true }}
                placeholder={state.system ? `Ask the ${profile.title.toLowerCase()} about ${state.system}…` : profile.placeholder}
                value={question}
                disabled={busy || !!status}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask(question);
                  }
                }}
                inputProps={{ 'aria-label': 'Question' }}
              />
              {busy ? (
                <Button color="warning" variant="outlined" onClick={cancel} sx={{ textTransform: 'none' }}>
                  Cancel
                </Button>
              ) : (
                <Button variant="contained" disabled={!question.trim() || !!status} onClick={() => ask(question)} sx={{ textTransform: 'none' }}>
                  Send
                </Button>
              )}
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Box sx={{ ...card, p: 1.5, display: 'grid', gap: 1 }}>
            <Typography variant="overline" color="text.secondary">
              What it sees
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {state.system && <Chip size="small" label={state.system} />}
              {project && <Chip size="small" label={`project ${project}`} />}
              <Chip size="small" label="read-only" />
            </Box>
            {profile.role && (
              <Typography variant="body2" color="text.secondary">
                Reads {profile.role.reads}. Never {profile.role.never}.
              </Typography>
            )}
            <TextField
              select
              size="small"
              label="Charge its cost to"
              value={state.system ?? FROM_TOOLS}
              disabled={busy}
              onChange={e => {
                const system = e.target.value || undefined;
                setState(({ system: _, ...rest }) => (system ? { ...rest, system } : rest));
              }}
            >
              <MenuItem value={FROM_TOOLS}>What it looks at</MenuItem>
              {[...new Set([...systems, ...(state.system ? [state.system] : [])])].sort().map(x => (
                <MenuItem key={x} value={x}>
                  {x}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={{ ...card, p: 1.5, display: 'grid', gap: 0.75 }}>
            <Typography variant="overline" color="text.secondary">
              Artefacts of this conversation
            </Typography>
            {byTool.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing looked at yet.
              </Typography>
            ) : (
              byTool.map(([name, n]) => (
                <Box key={name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 13.5 }}>
                  <Box component="code" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    ×{n}
                  </Typography>
                </Box>
              ))
            )}
          </Box>
          <Box sx={{ ...card, p: 1.5, display: 'grid', gap: 0.75 }}>
            <Typography variant="overline" color="text.secondary">
              This conversation
            </Typography>
            <Typography variant="body2">
              {state.exchanges.length} questions · {(usage / 1000).toFixed(1)} k tokens
            </Typography>
            <Typography variant="caption" color="text.secondary">
              It proposes; you act. Check what it says before acting on it.
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Page themeId="tool">
      <Header title={profile.title} subtitle={profile.subtitle} />
      <Content>{body}</Content>
    </Page>
  );
};
