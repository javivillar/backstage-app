import { McpClient } from './mcp';

function fakeFetch() {
  const calls: any[] = [];
  const impl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ headers: init.headers, body });
    let result: unknown;
    if (body.method === 'initialize') result = { protocolVersion: '2025-06-18' };
    else if (body.method === 'tools/list') result = { tools: [{ name: 'b', description: 'B', inputSchema: { type: 'object' } }] };
    else if (body.params.name !== 'boom') result = { content: [{ type: 'text', text: 'ok' }], isError: false };
    const payload = result ? { jsonrpc: '2.0', id: body.id, result } : { jsonrpc: '2.0', id: body.id, error: { message: 'unknown tool' } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('McpClient', () => {
  it('initializes once, sends the token and the user, caches tools', async () => {
    const f = fakeFetch();
    const c = new McpClient({ url: 'http://mcp', token: 'T' }, f.impl);
    expect((await c.listTools())[0].name).toBe('b');
    await c.listTools();
    expect(await c.callTool('a', {}, 'user:default/x')).toEqual({ text: 'ok', isError: false });
    expect(f.calls.map(x => x.body.method)).toEqual(['initialize', 'tools/list', 'tools/call']);
    expect(f.calls[2].headers.Authorization).toBe('Bearer T');
    expect(f.calls[2].headers['X-Refresquito-User']).toBe('user:default/x');
  });
  it('turns a failed call into a tool error for the model', async () => {
    const f = fakeFetch();
    const out = await new McpClient({ url: 'http://mcp' }, f.impl).callTool('boom', {}, 'u');
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/unknown tool/);
  });
});
