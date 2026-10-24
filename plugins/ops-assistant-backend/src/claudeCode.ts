/**
 * The runner "claude-code": the question is answered by Claude Code (the CLI, in print mode) with the operator's
 * Claude subscription (CLAUDE_CODE_OAUTH_TOKEN, made with `claude setup-token`), instead of the Anthropic API.
 * Claude Code runs its own agent loop and connects to the same MCP server; this file starts it, reads what it
 * does (--output-format stream-json) and turns it into the same Turn as the runner "api" (agent.ts).
 *
 * Only for the operator's own use: Anthropic does not allow offering claude.ai login to other users of a product.
 * The conversation continues through the session of Claude Code (--resume), kept in its config dir in the pod; when
 * that is gone (the pod restarted), the earlier text of the conversation is given to it instead.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { Cancelled, type ToolCallRecord, type Turn } from './agent';
import type { Message, Part } from './model/types';

export const PROVIDER = 'claude-code';
/** the name of the MCP server for Claude Code by default (the assistant ops): its tools are mcp__ops__<tool> */
const SERVER = 'ops';

export interface ClaudeCodeSettings {
  oauthToken: string;
  model: string;
  effort?: string;
  mcpUrl: string;
  mcpToken?: string;
  /** the CLI (default: claude on the PATH) */
  bin?: string;
  /** its config dir (sessions, settings): its own, never the operator's; one per assistant */
  configDir?: string;
  /** the name of the MCP server, one per assistant (ops, sec): its tools are mcp__<server>__<tool> */
  server?: string;
}

/** what one run of Claude Code did, from its stream-json lines */
export interface RunResult {
  sessionId?: string;
  answer: string;
  model?: string;
  toolCalls: ToolCallRecord[];
  stop: string;
  usage: Record<string, number>;
  error?: string;
}

const toolName = (name: string, server = SERVER) => name.replace(`mcp__${server}__`, '');

/** Reads the stream-json lines of `claude -p --output-format stream-json --verbose` (pure, unit-tested). */
export class StreamReader {
  readonly result: RunResult = { answer: '', toolCalls: [], stop: 'end', usage: {} };
  private pending = new Map<string, { name: string; input: Record<string, unknown> }>();

  constructor(
    private readonly onToolCall?: (call: ToolCallRecord) => void,
    private readonly server: string = SERVER,
  ) {}

  line(raw: string) {
    let ev: any;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (ev.session_id) this.result.sessionId = ev.session_id;
    if (ev.type === 'system' && ev.subtype === 'init' && ev.model) this.result.model = ev.model;
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') this.pending.set(c.id, { name: toolName(c.name, this.server), input: c.input ?? {} });
      }
      if (ev.message?.model) this.result.model = ev.message.model;
    }
    if (ev.type === 'user') {
      for (const c of ev.message?.content ?? []) {
        if (c.type !== 'tool_result') continue;
        const call = this.pending.get(c.tool_use_id);
        if (!call) continue;
        this.pending.delete(c.tool_use_id);
        const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join('');
        const record = { name: call.name, input: call.input, isError: !!c.is_error, chars: text.length };
        this.result.toolCalls.push(record);
        this.onToolCall?.(record);
      }
    }
    if (ev.type === 'result') {
      this.result.answer = typeof ev.result === 'string' ? ev.result : '';
      const u = ev.usage ?? {};
      this.result.usage = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        turns: ev.num_turns ?? 0,
      };
      if (ev.subtype === 'error_max_turns') this.result.stop = 'max_steps';
      else if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
        this.result.stop = 'error';
        this.result.error = this.result.answer || ev.subtype;
      }
    }
  }
}

/** the session of Claude Code a conversation is in: an opaque part of its last answer */
export function sessionOf(history: Message[]): string | undefined {
  for (const m of [...history].reverse()) {
    for (const p of m.parts) {
      if (p.type === 'opaque' && p.provider === PROVIDER) return (p.data as { sessionId?: string })?.sessionId;
    }
  }
  return undefined;
}

/** the text of a conversation, for a Claude Code that lost its session */
export function transcript(history: Message[]): string {
  return history
    .map(m => {
      const text = m.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n').trim();
      return text ? `${m.role === 'user' ? 'Operator' : 'Assistant'}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function args(s: ClaudeCodeSettings, o: { system: string; user: string; maxSteps: number; resume?: string }) {
  const server = s.server ?? SERVER;
  const mcp = {
    mcpServers: {
      [server]: {
        type: 'http',
        url: s.mcpUrl,
        headers: { ...(s.mcpToken ? { Authorization: `Bearer ${s.mcpToken}` } : {}), 'X-Refresquito-User': o.user },
      },
    },
  };
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', s.model,
    ...(s.effort ? ['--effort', s.effort] : []),
    '--system-prompt', o.system,
    '--mcp-config', JSON.stringify(mcp),
    '--strict-mcp-config',
    // no built-in tool (no shell, no files): only the read-only tools of the MCP server
    '--tools', '',
    '--allowedTools', `mcp__${server}__*`,
    '--permission-mode', 'dontAsk',
    '--setting-sources', '',
    '--max-turns', String(o.maxSteps),
    ...(o.resume ? ['--resume', o.resume] : []),
  ];
}

export class ClaudeCodeRunner {
  readonly label: string;

  constructor(private readonly s: ClaudeCodeSettings) {
    this.label = `Claude ${s.model} (Claude Code, Claude subscription)`;
  }

  private once(argv: string[], prompt: string, onToolCall?: (c: ToolCallRecord) => void, signal?: AbortSignal) {
    const configDir = this.s.configDir ?? `/tmp/${this.s.server ?? SERVER}-assistant-claude`;
    mkdirSync(configDir, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: configDir,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_OAUTH_TOKEN: this.s.oauthToken,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      // never an API key: it would take precedence over the subscription token
    };
    return new Promise<RunResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Cancelled());
        return;
      }
      const child = spawn(this.s.bin ?? 'claude', argv, { cwd: configDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const reader = new StreamReader(onToolCall, this.s.server ?? SERVER);
      let buf = '';
      let stderr = '';
      const onAbort = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', d => {
        buf += d.toString();
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          reader.line(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      child.stderr.on('data', d => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      child.on('error', e => reject(new Error(`claude: ${e.message}`)));
      child.on('close', code => {
        signal?.removeEventListener('abort', onAbort);
        if (buf.trim()) reader.line(buf);
        if (signal?.aborted) {
          reject(new Cancelled());
          return;
        }
        const r = reader.result;
        if (code !== 0 && !r.answer && r.stop !== 'max_steps') {
          r.stop = 'error';
          r.error = r.error ?? (stderr.trim().split('\n').pop() || `claude exited with code ${code}`);
        }
        resolve(r);
      });
      child.stdin.end(prompt);
    });
  }

  async run(o: {
    system: string;
    history: Message[];
    question: string;
    user: string;
    maxSteps: number;
    onToolCall?: (c: ToolCallRecord) => void;
    signal?: AbortSignal;
  }): Promise<Turn> {
    const resume = sessionOf(o.history);
    let r = await this.once(args(this.s, { ...o, resume }), o.question, o.onToolCall, o.signal);
    if (resume && r.stop === 'error' && !r.toolCalls.length) {
      // the session is gone (the pod restarted): start a new one with the conversation as text
      const earlier = transcript(o.history);
      const prompt = earlier ? `The conversation so far:\n\n${earlier}\n\nNew question:\n${o.question}` : o.question;
      r = await this.once(args(this.s, o), prompt, o.onToolCall, o.signal);
    }
    if (r.stop === 'error') throw new Error(r.error ?? 'Claude Code failed');
    const answer =
      r.answer.trim() ||
      (r.stop === 'max_steps' ? `I stopped after ${o.maxSteps} steps without a final answer: narrow the question.` : '');
    const parts: Part[] = [
      { type: 'opaque', provider: PROVIDER, data: { sessionId: r.sessionId } },
      { type: 'text', text: answer },
    ];
    const messages: Message[] = [
      ...o.history,
      { role: 'user', parts: [{ type: 'text', text: o.question }] },
      { role: 'assistant', parts },
    ];
    return { messages, answer, toolCalls: r.toolCalls, stop: r.stop, model: r.model ?? this.s.model, usage: r.usage };
  }
}
