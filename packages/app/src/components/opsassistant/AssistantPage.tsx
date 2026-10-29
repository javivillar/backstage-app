import { useEffect, useRef, useState } from 'react';
import { Content, Header, MarkdownContent, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
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
/** the conversation open in the page: id is its key in the backend (plugins/ops-assistant-backend/src/conversations.ts) */
type State = { id: string; messages: Message[]; exchanges: Exchange[] };
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
  /** a question about one project: the page was opened with ?project=<name> (the button of an entity) */
  aboutProject?: (project: string) => { examples: string[]; prefix: string };
}

const POLL_MS = 2000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** the page was left while waiting: the job keeps going on the backend and the page collects it when it comes back */
class Left extends Error {}
const pending = (x?: Exchange) => !!x && !x.answer && !x.error;

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
/** a conversation id (UUID v4); randomUUID needs https, the fallback is for tests and plain http */
const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
const empty = (): State => ({ id: newId(), messages: [], exchanges: [] });
/** what the backend lists it as: its first question */
const titleOf = (s: State) => (s.exchanges[0]?.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
/** what is saved in the backend (and compared, to save only what changed) */
const saved = (s: State) => JSON.stringify({ messages: s.messages, exchanges: s.exchanges });

/** the open conversation of the tab; null when the tab has none (a new tab: the page opens the last one) */
function load(store: string): State | null {
  try {
    const raw = sessionStorage.getItem(store);
    if (raw) {
      const s = JSON.parse(raw);
      // pages before the conversations were kept had no id
      return { id: s.id ?? newId(), messages: s.messages ?? [], exchanges: s.exchanges ?? [] };
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
export const AssistantPage = ({ profile }: { profile: AssistantProfile }) => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [params] = useSearchParams();
  const project = params.get('project')?.trim() || undefined;
  const about = project && profile.aboutProject ? profile.aboutProject(project) : undefined;
  const [info, setInfo] = useState<Info | undefined>();
  const [infoError, setInfoError] = useState<string | undefined>();
  const stored = useRef(load(profile.store));
  const [state, setState] = useState<State>(() => stored.current ?? empty());
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
    const next: State = { id, messages: c.state?.messages ?? [], exchanges: c.state?.exchanges ?? [] };
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
        if (!stored.current && list.length) open(list[0].id).catch(e => setKeepError((e as Error).message));
      },
      e => {
        setConversations([]);
        setKeepError((e as Error).message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

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
    setState(s => ({ messages: result.messages ?? s.messages, exchanges: [...s.exchanges.slice(0, -1), result.done] }));
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
        body: JSON.stringify({ question: text, messages: state.messages }),
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

  const reset = () => {
    const next = empty();
    lastSaved.current = saved(next);
    resumed.current = next.id;
    setState(next);
  };

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
      </Box>
      </Box>
    );

  return (
    <Page themeId="tool">
      <Header title={profile.title} subtitle={profile.subtitle} />
      <Content>{body}</Content>
    </Page>
  );
};
