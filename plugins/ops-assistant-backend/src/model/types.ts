/**
 * The contract between the agent loop of the assistant and a model, whoever runs it. Nothing outside src/model/
 * knows which provider answers: the loop (agent.ts), the HTTP API (plugin.ts) and the page of Backstage speak these
 * types only. To use another model — one running on the operator's own machine, for instance — write one more
 * ModelProvider (src/model/<provider>.ts) and register it in src/model/index.ts; nothing else changes.
 */

/** One piece of a message. */
export type Part =
  | { type: 'text'; text: string }
  /** the model asks for a tool (an MCP tool of opsassistant-oneke) */
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  /** what the tool answered, for the model */
  | { type: 'tool_result'; id: string; content: string; isError?: boolean }
  /**
   * Something only the provider that produced it understands (Claude's thinking blocks, fallback markers...). It is
   * kept in the conversation and sent back to that same provider, which may need it to continue (a provider that
   * reasons may refuse a turn whose earlier reasoning was dropped); any other provider leaves it out.
   */
  | { type: 'opaque'; provider: string; data: unknown };

export interface Message {
  role: 'user' | 'assistant';
  parts: Part[];
}

/** A tool as MCP describes it (tools/list): its input is a JSON Schema. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  /** the instructions of the assistant (charts/cnoe-oneke: provider-neutral text) */
  system: string;
  messages: Message[];
  tools: ToolSpec[];
}

export interface Completion {
  /** what the model said: text, tool calls, opaque parts */
  parts: Part[];
  /** end: it answered; tool_calls: it waits for their results; paused: call again as is; max_tokens / refusal: it stopped */
  stop: 'end' | 'tool_calls' | 'paused' | 'max_tokens' | 'refusal';
  /** the model that answered (a provider may fall back to another one) */
  model?: string;
  /** tokens, as the provider counts them (shown and logged, never relied on) */
  usage?: Record<string, number>;
}

export interface ModelProvider {
  /** "anthropic", "local"...: the owner of its opaque parts */
  readonly id: string;
  /** a short description for the page ("Claude claude-opus-5-5 (Anthropic API)") */
  readonly label: string;
  complete(request: CompletionRequest): Promise<Completion>;
}
