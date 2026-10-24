import { OpenAICompatibleProvider, fromChat, toChat } from './openaiCompatible';
import type { Message } from './types';

const history: Message[] = [
  { role: 'user', parts: [{ type: 'text', text: 'how is it?' }] },
  {
    role: 'assistant',
    parts: [
      { type: 'opaque', provider: 'anthropic', data: { type: 'thinking' } },
      { type: 'tool_call', id: 'c1', name: 'platform_overview', input: {} },
    ],
  },
  { role: 'user', parts: [{ type: 'tool_result', id: 'c1', content: 'x'.repeat(50) }] },
];

describe('openai-compatible adapter', () => {
  it('maps neutral messages, leaves out opaque parts, cuts tool results', () => {
    const out = toChat('S', history, 10);
    expect(out[0]).toEqual({ role: 'system', content: 'S' });
    expect(out[1]).toEqual({ role: 'user', content: 'how is it?' });
    expect(out[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'platform_overview', arguments: '{}' } }],
    });
    expect(out[3].role).toBe('tool');
    expect(out[3].tool_call_id).toBe('c1');
    expect(out[3].content).toMatch(/^x{10}\n\[… cut: 40 more characters/);
  });

  it('reads tool calls, reasoning apart, malformed arguments and missing ids', () => {
    const r = fromChat({
      finish_reason: 'tool_calls',
      message: {
        content: '<think>look first</think>',
        reasoning_content: 'plan',
        tool_calls: [
          { id: 'a', function: { name: 'get_events', arguments: '{"namespace":"x"}' } },
          { function: { name: 'platform_overview', arguments: '{not json' } },
          { id: 'b', function: { name: 'list_resources', arguments: { kind: 'pods' } } },
        ],
      },
    });
    expect(r.stop).toBe('tool_calls');
    expect(r.parts[0]).toEqual({ type: 'opaque', provider: 'openai-compatible', data: { reasoning: 'plan\nlook first' } });
    expect(r.parts.filter(p => p.type === 'text')).toHaveLength(0);
    const calls = r.parts.filter(p => p.type === 'tool_call') as any[];
    expect(calls.map(c => [c.name, c.input])).toEqual([
      ['get_events', { namespace: 'x' }],
      ['platform_overview', {}],
      ['list_resources', { kind: 'pods' }],
    ]);
    expect(calls[1].id).toMatch(/[0-9a-f-]{36}/);
  });

  it('reads a final answer and a cut one', () => {
    expect(fromChat({ finish_reason: 'stop', message: { content: ' All fine. ' } })).toEqual({ parts: [{ type: 'text', text: 'All fine.' }], stop: 'end' });
    expect(fromChat({ finish_reason: 'length', message: { content: 'All' } }).stop).toBe('max_tokens');
  });

  it('calls the server and reports its errors', async () => {
    const seen: any[] = [];
    const ok = (async (url: string, init: any) => {
      seen.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      return new Response(JSON.stringify({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ baseUrl: 'http://srv:8080/v1/', model: 'm' }, ok);
    const c = await p.complete({ system: 'S', messages: history, tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }] });
    expect(seen[0].url).toBe('http://srv:8080/v1/chat/completions');
    expect(seen[0].auth).toBeUndefined();
    expect(seen[0].body.tools[0]).toEqual({ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } });
    expect(c).toMatchObject({ stop: 'end', usage: { input: 3, output: 1 } });

    const bad = (async () => new Response('model not found', { status: 404 })) as unknown as typeof fetch;
    await expect(new OpenAICompatibleProvider({ baseUrl: 'http://srv', model: 'm' }, bad).complete({ system: 'S', messages: [], tools: [] })).rejects.toThrow(/HTTP 404 model not found/);
  });

  it('times out with a clear message, and is cancelled', async () => {
    const hang = ((_u: string, init: any) =>
      new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(new OpenAICompatibleProvider({ baseUrl: 'http://srv', model: 'm', timeoutMs: 50 }, hang).complete({ system: 'S', messages: [], tools: [] })).rejects.toThrow(/did not answer in 0 s/);
    const abort = new AbortController();
    const p = new OpenAICompatibleProvider({ baseUrl: 'http://srv', model: 'm' }, hang).complete({ system: 'S', messages: [], tools: [], signal: abort.signal });
    abort.abort();
    await expect(p).rejects.toThrow('aborted');
  });
});
