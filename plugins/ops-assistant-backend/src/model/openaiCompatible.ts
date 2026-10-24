/**
 * The ModelProvider for a model outside Claude, served with a "chat completions" API with tools (the format of
 * OpenAI, which Ollama, vLLM, llama.cpp `server` and LM Studio speak). Typically a model on the operator's own
 * machine: no key, slow on a CPU. Hence its own limits:
 *   - the result of each tool is cut to maxToolResultChars before it goes to the model (a local context is small,
 *     and on a CPU reading the prompt is the slow part);
 *   - a long timeout per call (minutes);
 *   - the reasoning some models return apart (reasoning_content / reasoning / <think>…</think>) is kept as an
 *     opaque part, not shown and not sent back.
 * charts/opsassistant-oneke/ARCHITECTURE.md, section 5.
 */
import { randomUUID } from 'node:crypto';
import type { Completion, CompletionRequest, Message, ModelProvider, Part } from './types';

export const PROVIDER = 'openai-compatible';

export interface OpenAICompatibleSettings {
  /** e.g. http://10.0.0.5:8080 (the /v1 is added) */
  baseUrl: string;
  /** the model as the server names it */
  model: string;
  apiKey?: string;
  maxTokens?: number;
  /** per model call; default 10 minutes */
  timeoutMs?: number;
  /** each tool result sent to the model is cut to this; default 6000 */
  maxToolResultChars?: number;
}

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_TOOL_RESULT_CHARS = 6000;

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[… cut: ${text.length - max} more characters. Ask the tool for less (a namespace, a name, fewer lines) to see the rest.]`;
}

/** neutral messages -> chat-completions messages (opaque parts of any provider are left out) */
export function toChat(system: string, messages: Message[], maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS) {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    const text = m.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { text: string }).text)
      .join('\n');
    const calls = m.parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call');
    const results = m.parts.filter((p): p is Extract<Part, { type: 'tool_result' }> => p.type === 'tool_result');
    if (results.length) {
      for (const r of results) out.push({ role: 'tool', tool_call_id: r.id, content: cut(r.content, maxToolResultChars) });
      if (text) out.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) }
          : {}),
      });
    } else {
      out.push({ role: 'user', content: text });
    }
  }
  return out;
}

const THINK = /<think>([\s\S]*?)<\/think>/g;

/** a chat-completions choice -> neutral parts and stop */
export function fromChat(choice: any): Pick<Completion, 'parts' | 'stop'> {
  const msg = choice?.message ?? {};
  const parts: Part[] = [];
  let content: string = typeof msg.content === 'string' ? msg.content : '';
  const thoughts: string[] = [];
  for (const k of ['reasoning_content', 'reasoning', 'thinking']) if (typeof msg[k] === 'string' && msg[k]) thoughts.push(msg[k]);
  content = content.replace(THINK, (_m, t) => {
    thoughts.push(t);
    return '';
  });
  if (thoughts.length) parts.push({ type: 'opaque', provider: PROVIDER, data: { reasoning: thoughts.join('\n') } });
  if (content.trim()) parts.push({ type: 'text', text: content.trim() });
  for (const c of msg.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    const raw = c?.function?.arguments;
    if (raw && typeof raw === 'object') input = raw;
    else if (typeof raw === 'string' && raw.trim()) {
      try {
        input = JSON.parse(raw);
      } catch {
        // a malformed call: the tool gets no arguments and answers with what it needs
        input = {};
      }
    }
    parts.push({ type: 'tool_call', id: c.id || randomUUID(), name: c?.function?.name ?? '', input });
  }
  const hasCalls = parts.some(p => p.type === 'tool_call');
  let stop: Completion['stop'] = 'end';
  if (hasCalls) stop = 'tool_calls';
  else if (choice?.finish_reason === 'length') stop = 'max_tokens';
  return { parts, stop };
}

/** aborted when either is (AbortSignal.any, which the typings of this repo lack) */
function either(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController();
  const abort = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return c.signal;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = PROVIDER;
  readonly label: string;

  constructor(private readonly s: OpenAICompatibleSettings, private readonly fetchImpl: typeof fetch = fetch) {
    this.label = `${s.model} (${s.baseUrl})`;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const url = `${this.s.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
    const timeout = AbortSignal.timeout(this.s.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = req.signal ? either(req.signal, timeout) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.s.apiKey ? { Authorization: `Bearer ${this.s.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.s.model,
          messages: toChat(req.system, req.messages, this.s.maxToolResultChars),
          tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
          ...(this.s.maxTokens ? { max_tokens: this.s.maxTokens } : {}),
          stream: false,
        }),
        signal,
      });
    } catch (e) {
      if (timeout.aborted && !req.signal?.aborted) {
        throw new Error(`${this.s.model} did not answer in ${Math.round((this.s.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s (a CPU reading a long prompt?)`);
      }
      throw e;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${url}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const { parts, stop } = fromChat(data?.choices?.[0]);
    const u = data?.usage ?? {};
    return {
      parts,
      stop,
      model: data?.model ?? this.s.model,
      usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0 },
    };
  }
}
