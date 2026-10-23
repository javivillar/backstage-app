import { useEffect, useRef, useState } from 'react';
import { Content, Header, MarkdownContent, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/** The conversation as the backend returns it (plugins/ops-assistant-backend/src/model/types.ts). Opaque here. */
type Message = { role: 'user' | 'assistant'; parts: Array<{ type: string; text?: string }> };
type ToolCall = { name: string; input: Record<string, unknown>; isError: boolean; chars: number };
type Exchange = { question: string; answer?: string; toolCalls?: ToolCall[]; model?: string; usage?: Record<string, number>; error?: string; ms?: number };
type Info = { enabled: boolean; allowed: boolean; model?: string; maxSteps?: number };

const STORE = 'ops-assistant-conversation';
const EXAMPLES = [
  'How is the platform? Anything I should look at now?',
  'Why is Loki restarting and how do I fix it?',
  'Which Argo CD applications are not synced or healthy, and why?',
  'How do I add a new Python application to the platform?',
];

function load(): { messages: Message[]; exchanges: Exchange[] } {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch {
    // no storage: start empty
  }
  return { messages: [], exchanges: [] };
}

function save(state: { messages: Message[]; exchanges: Exchange[] }) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(state));
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
 * The operations assistant: questions about operating the platform and troubleshooting the cluster, answered by a
 * model that looks with READ-ONLY tools (Kubernetes, Argo CD, events, logs, Prometheus, Loki, docs). It proposes;
 * the operator acts.
 */
export const OpsAssistantPage = () => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [info, setInfo] = useState<Info | undefined>();
  const [infoError, setInfoError] = useState<string | undefined>();
  const [state, setState] = useState(load);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const base = await discovery.getBaseUrl('ops-assistant');
      const res = await fetch(`${base}/info`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    })().then(setInfo, e => setInfoError((e as Error).message));
  }, [discovery, fetch]);

  useEffect(() => {
    save(state);
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion('');
    const started = Date.now();
    setState(s => ({ ...s, exchanges: [...s.exchanges, { question: text }] }));
    let done: Exchange = { question: text };
    let messages = state.messages;
    try {
      const base = await discovery.getBaseUrl('ops-assistant');
      const res = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, messages: state.messages }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      messages = body.messages;
      done = { ...done, answer: body.answer, toolCalls: body.toolCalls, model: body.model, usage: body.usage, ms: Date.now() - started };
    } catch (e) {
      done = { ...done, error: (e as Error).message };
    }
    setState(s => ({ messages, exchanges: [...s.exchanges.slice(0, -1), done] }));
    setBusy(false);
  };

  const reset = () => setState({ messages: [], exchanges: [] });

  let body;
  if (infoError) body = <WarningPanel title="The assistant is not reachable" message={infoError} />;
  else if (!info) body = <Progress />;
  else if (!info.allowed) body = <WarningPanel title="No access" message="You are not in a group allowed to use the operations assistant." />;
  else if (!info.enabled) body = <WarningPanel title="Not configured" message="opsAssistant (model, MCP server, prompt) is not configured in this Backstage." />;
  else
    body = (
      <Box sx={{ maxWidth: 1100 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          It looks at the cluster with read-only tools and proposes what to do; it never changes anything. Model: {info.model}.
          Check what it says before acting on it.
        </Typography>
        {state.exchanges.length === 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {EXAMPLES.map(e => (
              <Chip key={e} label={e} onClick={() => ask(e)} variant="outlined" />
            ))}
          </Box>
        )}
        {state.exchanges.map((x, i) => (
          <Box key={i} sx={{ mb: 3 }}>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: 'action.hover' }}>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{x.question}</Typography>
            </Paper>
            {!x.answer && !x.error && <Progress />}
            {x.error && <WarningPanel severity="error" title="No answer" message={x.error} />}
            {x.answer && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <MarkdownContent content={x.answer} dialect="gfm" />
                {!!x.toolCalls?.length && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
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
            placeholder="Ask about the cluster: a failing pod, an application out of sync, how to do something..."
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
            <Button disabled={busy || !state.exchanges.length} onClick={reset}>
              New
            </Button>
          </Box>
        </Box>
      </Box>
    );

  return (
    <Page themeId="tool">
      <Header title="Operations assistant" subtitle="Operate and troubleshoot the platform" />
      <Content>{body}</Content>
    </Page>
  );
};
