/**
 * The ModelProvider for Claude, through the Anthropic API (official SDK). Everything specific to Claude lives here:
 * its message format, prompt caching, adaptive thinking and effort, and the server-side fallback that re-runs a
 * declined request on another Claude model. Replacing Claude by another model means another file like this one.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
} from '@anthropic-ai/sdk/resources/beta/messages';
import type { Completion, CompletionRequest, Message, ModelProvider, Part } from './types';

export interface AnthropicSettings {
  apiKey: string;
  /** e.g. claude-opus-5-5 */
  model: string;
  /** low | medium | high | xhigh | max: how hard the model thinks (and how much it costs) */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /** an Anthropic-compatible endpoint (a proxy of the zone); empty: the Anthropic API */
  baseURL?: string;
}

const PROVIDER = 'anthropic';

/** neutral parts -> content blocks of the Messages API */
export function toAnthropic(messages: Message[]): BetaMessageParam[] {
  return messages.map(m => {
    const content: BetaContentBlockParam[] = [];
    for (const p of m.parts) {
      if (p.type === 'text') {
        if (p.text) content.push({ type: 'text', text: p.text });
      } else if (p.type === 'tool_call') {
        content.push({ type: 'tool_use', id: p.id, name: p.name, input: p.input });
      } else if (p.type === 'tool_result') {
        content.push({ type: 'tool_result', tool_use_id: p.id, content: p.content, is_error: !!p.isError });
      } else if (p.type === 'opaque' && p.provider === PROVIDER) {
        // thinking and fallback blocks go back unchanged (Claude checks them); other providers' opaque parts drop
        content.push(p.data as BetaContentBlockParam);
      }
    }
    return { role: m.role, content } as BetaMessageParam;
  });
}

/** content blocks of a response -> neutral parts */
export function fromAnthropic(blocks: BetaContentBlock[]): Part[] {
  return blocks.map((b): Part => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'tool_use') return { type: 'tool_call', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> };
    return { type: 'opaque', provider: PROVIDER, data: b };
  });
}

const STOPS: Record<string, Completion['stop']> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_calls',
  pause_turn: 'paused',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
};

export class AnthropicProvider implements ModelProvider {
  readonly id = PROVIDER;
  readonly label: string;
  private readonly client: Anthropic;

  constructor(private readonly settings: AnthropicSettings) {
    this.client = new Anthropic({ apiKey: settings.apiKey, ...(settings.baseURL ? { baseURL: settings.baseURL } : {}) });
    this.label = `Claude ${settings.model} (${settings.baseURL ? settings.baseURL : 'Anthropic API'})`;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    // The tools (sorted: a stable order keeps the cache) and the instructions are the same on every turn: the
    // breakpoint on the system prompt caches both (the API renders tools, then system, then messages); the
    // top-level cache_control caches the conversation so far.
    const tools: BetaTool[] = [...request.tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as BetaTool['input_schema'] }));
    const response = await this.client.beta.messages.create({
      model: this.settings.model,
      max_tokens: this.settings.maxTokens ?? 16000,
      // a request a safety classifier declines is re-run on the model Anthropic recommends for that category
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: this.settings.effort ?? 'high' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages: toAnthropic(request.messages),
    });
    const u = response.usage;
    return {
      parts: fromAnthropic(response.content),
      stop: STOPS[response.stop_reason ?? ''] ?? 'end',
      model: response.model,
      usage: {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
