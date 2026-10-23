import { fromAnthropic, toAnthropic } from './anthropic';

describe('anthropic adapter', () => {
  it('keeps its own opaque parts and drops other providers ones', () => {
    const out = toAnthropic([
      {
        role: 'assistant',
        parts: [
          { type: 'opaque', provider: 'anthropic', data: { type: 'thinking', thinking: 't', signature: 's' } },
          { type: 'opaque', provider: 'local', data: { foo: 1 } },
          { type: 'text', text: 'hi' },
          { type: 'tool_call', id: 'tu1', name: 'get_events', input: { namespace: 'x' } },
        ],
      },
      { role: 'user', parts: [{ type: 'tool_result', id: 'tu1', content: 'none', isError: false }] },
    ]);
    expect(out[0].content).toEqual([
      { type: 'thinking', thinking: 't', signature: 's' },
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tu1', name: 'get_events', input: { namespace: 'x' } },
    ]);
    expect(out[1].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: 'none', is_error: false }]);
  });

  it('maps a response to neutral parts', () => {
    const parts = fromAnthropic([
      { type: 'thinking', thinking: 'x', signature: 'y' },
      { type: 'text', text: 'answer', citations: null },
      { type: 'tool_use', id: 'a', name: 'n', input: { k: 1 } },
    ] as never);
    expect(parts.map(p => p.type)).toEqual(['opaque', 'text', 'tool_call']);
  });
});
