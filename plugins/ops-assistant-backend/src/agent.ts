/**
 * The agent loop of the assistant: the model answers or asks for tools, the tools (MCP) run, their results go back,
 * until it answers. It speaks the neutral types of src/model/types.ts only, so it is the same loop whatever model
 * answers. Read-only by construction: the only tools are the ones of the MCP server, which only read.
 */
import type { Message, ModelProvider, Part, ToolSpec } from './model/types';

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
  chars: number;
}

/** thrown by runTurn when its signal is aborted */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface Turn {
  /** the whole conversation, with what this turn added (the client keeps it and sends it back next time) */
  messages: Message[];
  /** the text of the final answer */
  answer: string;
  toolCalls: ToolCallRecord[];
  stop: string;
  model?: string;
  usage: Record<string, number>;
}

export interface Tools {
  list(): Promise<ToolSpec[]>;
  call(name: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
}

export async function runTurn(options: {
  provider: ModelProvider;
  tools: Tools;
  system: string;
  history: Message[];
  question: string;
  maxSteps?: number;
  /** told of each tool call as soon as it returns (the page shows them while the model works) */
  onToolCall?: (call: ToolCallRecord) => void;
  /** aborted when the operator cancels: the loop stops at once, and the conversation stays as it was */
  signal?: AbortSignal;
}): Promise<Turn> {
  const { signal } = options;
  const check = () => {
    if (signal?.aborted) throw new Cancelled();
  };
  const { provider, tools, system, question } = options;
  const maxSteps = options.maxSteps ?? 12;
  const messages: Message[] = [...options.history, { role: 'user', parts: [{ type: 'text', text: question }] }];
  const specs = await tools.list();
  const toolCalls: ToolCallRecord[] = [];
  const usage: Record<string, number> = {};
  let stop = 'end';
  let model: string | undefined;

  for (let step = 0; step < maxSteps; step++) {
    check();
    let completion;
    try {
      completion = await provider.complete({ system, messages, tools: specs, signal });
    } catch (e) {
      check();
      throw e;
    }
    check();
    model = completion.model ?? model;
    for (const [k, v] of Object.entries(completion.usage ?? {})) usage[k] = (usage[k] ?? 0) + v;
    messages.push({ role: 'assistant', parts: completion.parts });
    stop = completion.stop;
    if (completion.stop === 'paused') continue;
    if (completion.stop !== 'tool_calls') break;
    const calls = completion.parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call');
    if (!calls.length) break;
    // in parallel, and every result in ONE message
    const results = await Promise.all(
      calls.map(c =>
        tools.call(c.name, c.input).then(r => {
          options.onToolCall?.({ name: c.name, input: c.input, isError: r.isError, chars: r.text.length });
          return r;
        }),
      ),
    );
    messages.push({
      role: 'user',
      parts: calls.map((c, i) => ({ type: 'tool_result', id: c.id, content: results[i].text, isError: results[i].isError })),
    });
    calls.forEach((c, i) => toolCalls.push({ name: c.name, input: c.input, isError: results[i].isError, chars: results[i].text.length }));
    if (step === maxSteps - 1) stop = 'max_steps';
  }
  const last = [...messages].reverse().find(m => m.role === 'assistant');
  let answer = (last?.parts ?? []).filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n').trim();
  if (stop === 'refusal') answer ||= 'The model declined to answer this request.';
  if (stop === 'max_steps') answer ||= `I stopped after ${maxSteps} steps without a final answer: narrow the question.`;
  if (stop === 'max_tokens') answer ||= 'The answer was cut (too long): ask for less at once.';
  return { messages, answer, toolCalls, stop, model, usage };
}
