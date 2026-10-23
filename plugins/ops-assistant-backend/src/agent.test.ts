import { runTurn, Tools } from './agent';
import type { Completion, CompletionRequest, ModelProvider } from './model/types';

class Scripted implements ModelProvider {
  readonly id = 'fake';
  readonly label = 'fake';
  requests: CompletionRequest[] = [];
  constructor(private readonly script: Completion[]) {}
  async complete(req: CompletionRequest) {
    this.requests.push(JSON.parse(JSON.stringify(req)));
    return this.script.shift() ?? { parts: [{ type: 'text', text: 'done' }], stop: 'end' as const };
  }
}

const tools: Tools = {
  list: async () => [{ name: 'platform_overview', description: '', inputSchema: { type: 'object' } }],
  call: async name => ({ text: `result of ${name}`, isError: name === 'bad' }),
};

describe('runTurn', () => {
  it('runs tools in parallel and returns their results in one message', async () => {
    const p = new Scripted([
      {
        parts: [
          { type: 'opaque', provider: 'fake', data: 'thinking' },
          { type: 'tool_call', id: 'a', name: 'platform_overview', input: {} },
          { type: 'tool_call', id: 'b', name: 'bad', input: { x: 1 } },
        ],
        stop: 'tool_calls',
        usage: { input: 10 },
      },
      { parts: [{ type: 'text', text: 'All good.' }], stop: 'end', usage: { input: 5 } },
    ]);
    const turn = await runTurn({ provider: p, tools, system: 's', history: [], question: 'how is it?' });
    expect(turn.answer).toBe('All good.');
    expect(turn.toolCalls.map(t => [t.name, t.isError])).toEqual([['platform_overview', false], ['bad', true]]);
    expect(turn.usage.input).toBe(15);
    const second = p.requests[1].messages;
    expect(second[2]).toEqual({
      role: 'user',
      parts: [
        { type: 'tool_result', id: 'a', content: 'result of platform_overview', isError: false },
        { type: 'tool_result', id: 'b', content: 'result of bad', isError: true },
      ],
    });
    expect(turn.messages).toHaveLength(4);
  });

  it('continues a paused turn and stops at maxSteps', async () => {
    const loop: Completion = { parts: [{ type: 'tool_call', id: 'x', name: 'platform_overview', input: {} }], stop: 'tool_calls' };
    const p = new Scripted([{ parts: [], stop: 'paused' }, loop, loop, loop]);
    const turn = await runTurn({ provider: p, tools, system: 's', history: [], question: 'q', maxSteps: 3 });
    expect(turn.stop).toBe('max_steps');
    expect(turn.answer).toMatch(/stopped after 3 steps/);
  });

  it('explains a refusal', async () => {
    const p = new Scripted([{ parts: [], stop: 'refusal' }]);
    const turn = await runTurn({ provider: p, tools, system: 's', history: [], question: 'q' });
    expect(turn.answer).toMatch(/declined/);
  });
});
