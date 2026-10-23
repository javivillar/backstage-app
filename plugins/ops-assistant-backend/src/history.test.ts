import { parseHistory } from './history';

describe('parseHistory', () => {
  it('accepts a conversation', () => {
    const m = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'opaque', provider: 'anthropic', data: {} }, { type: 'tool_call', id: '1', name: 't', input: {} }] },
      { role: 'user', parts: [{ type: 'tool_result', id: '1', content: 'ok' }] },
    ];
    expect(parseHistory(m)).toHaveLength(3);
    expect(parseHistory(undefined)).toEqual([]);
  });
  it('rejects what is not one', () => {
    expect(() => parseHistory({})).toThrow();
    expect(() => parseHistory([{ role: 'system', parts: [] }])).toThrow();
    expect(() => parseHistory([{ role: 'user', parts: [{ type: 'image' }] }])).toThrow();
  });
});
