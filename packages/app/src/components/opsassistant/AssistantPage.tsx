import { useEffect, useRef, useState } from 'react';
import { Content, Header, MarkdownContent, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/** The conversation as the backend returns it (plugins/ops-assistant-backend/src/model/types.ts). Opaque here. */
type Message = { role: 'user' | 'assistant'; parts: Array<{ type: string; text?: string }> };
type ToolCall = { name: string; input: Record<string, unknown>; isError: boolean; chars: number };
/** job: the question being answered on the backend, kept so the page can collect it after being left or reloaded */
type Exchange = { question: string; job?: string; answer?: string; toolCalls?: ToolCall[]; model?: string; usage?: Record<string, number>; error?: string; ms?: number };
type JobProgress = { toolCalls: ToolCall[]; elapsedMs: number };
type Info = { enabled: boolean; allowed: boolean; model?: string; maxSteps?: number; title?: string };

/**
 * One assistant of Backstage (plugins/ops-assistant-backend: one engine, one block of config per assistant): where its
 * API is and what its page says. Each one keeps its own conversation (a session apart).
 */
export interface AssistantProfile {
  /** its routes under /api/ops-assistant: '' for the operations assistant (as before), '/sec' for the security one */
  path: string;
  /** where the page keeps its conversation (sessionStorage of the tab) */
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

function load(store: string): { messages: Message[]; exchanges: Exchange[] } {
  try {
    const raw = sessionStorage.getItem(store);
    if (raw) return JSON.parse(raw);
  } catch {
    // no storage: start empty
  }
  return { messages: [], exchanges: [] };
}

function save(store: string, state: { messages: Message[]; exchanges: Exchange[] }) {
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
  const [state, setState] = useState(() => load(profile.store));
  const [question, setQuestion] = useState(about?.prefix ?? '');
  const api = async () => `${await discovery.getBaseUrl('ops-assistant')}${profile.path}`;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<JobProgress | undefined>();
  const current = useRef<string | undefined>();
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const resumed = useRef(false);

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

  // a question left waiting (page left or reloaded): collect its answer, or say why there is none
  useEffect(() => {
    const last = state.exchanges[state.exchanges.length - 1];
    if (!pending(last) || resumed.current) return;
    resumed.current = true;
    const id = last.job;
    setBusy(true);
    follow(last, async () => {
      if (!id) throw new Error('The page was left while this question was being answered and its answer was not kept: ask it again.');
      return collect(last, id, Date.now());
    });
    // only when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => setState({ messages: [], exchanges: [] });

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
      <Box sx={{ maxWidth: 1100 }}>
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
    );

  return (
    <Page themeId="tool">
      <Header title={profile.title} subtitle={profile.subtitle} />
      <Content>{body}</Content>
    </Page>
  );
};
