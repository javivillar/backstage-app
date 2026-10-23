/**
 * A client of the MCP server of the tools (opsassistant-oneke): JSON-RPC 2.0 over HTTP (Streamable HTTP, JSON
 * responses). Only what the assistant needs: initialize, tools/list, tools/call.
 */
import type { ToolSpec } from './model/types';

export interface McpSettings {
  url: string;
  token?: string;
  timeoutMs?: number;
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

export class McpClient {
  private id = 0;
  private session?: string;
  private initialized?: Promise<void>;
  private tools?: { at: number; list: ToolSpec[] };

  constructor(private readonly settings: McpSettings, private readonly fetchImpl: typeof fetch = fetch) {}

  private async rpc(method: string, params: unknown, user?: string): Promise<any> {
    const res = await this.fetchImpl(this.settings.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.settings.token ? { Authorization: `Bearer ${this.settings.token}` } : {}),
        ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
        ...(user ? { 'X-Refresquito-User': user } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.settings.timeoutMs ?? 60000),
    });
    if (!res.ok) throw new Error(`MCP ${method}: HTTP ${res.status}`);
    this.session = res.headers.get('Mcp-Session-Id') ?? this.session;
    const body = await res.json();
    if (body.error) throw new Error(`MCP ${method}: ${body.error.message}`);
    return body.result;
  }

  private async ensureInitialized() {
    this.initialized ??= this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'backstage-ops-assistant', version: '0.1.0' },
    }).then(() => undefined, e => {
      this.initialized = undefined;
      throw e;
    });
    return this.initialized;
  }

  /** the tools of the server, kept 5 minutes */
  async listTools(): Promise<ToolSpec[]> {
    if (this.tools && Date.now() - this.tools.at < 300000) return this.tools.list;
    await this.ensureInitialized();
    const result = await this.rpc('tools/list', {});
    const list: ToolSpec[] = (result.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
    this.tools = { at: Date.now(), list };
    return list;
  }

  async callTool(name: string, args: Record<string, unknown>, user: string): Promise<ToolOutcome> {
    await this.ensureInitialized();
    try {
      const result = await this.rpc('tools/call', { name, arguments: args }, user);
      const text = (result.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      return { text, isError: !!result.isError };
    } catch (e) {
      return { text: `the tool ${name} could not be called: ${(e as Error).message}`, isError: true };
    }
  }
}
