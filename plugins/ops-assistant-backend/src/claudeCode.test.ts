import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cancelled } from './agent';
import { ClaudeCodeRunner, StreamReader, args, sessionOf, transcript } from './claudeCode';
import type { Message } from './model/types';

const lines = [
  { type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-opus-5-5' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__ops__platform_overview', input: {} }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'all good' }] }] } },
  { type: 'result', subtype: 'success', result: 'Nothing to do.', session_id: 's-1', num_turns: 2, usage: { input_tokens: 5, output_tokens: 7 } },
];

describe('StreamReader', () => {
  it('reads tools, answer, session and usage', () => {
    const seen: string[] = [];
    const r = new StreamReader(c => seen.push(c.name));
    lines.forEach(l => r.line(JSON.stringify(l)));
    r.line('not json');
    expect(r.result).toMatchObject({ sessionId: 's-1', answer: 'Nothing to do.', model: 'claude-opus-5-5', stop: 'end' });
    expect(r.result.toolCalls).toEqual([{ name: 'platform_overview', input: {}, isError: false, chars: 8 }]);
    expect(r.result.usage).toMatchObject({ input: 5, output: 7, turns: 2 });
    expect(seen).toEqual(['platform_overview']);
  });
  it('marks max turns and errors', () => {
    const a = new StreamReader();
    a.line(JSON.stringify({ type: 'result', subtype: 'error_max_turns' }));
    expect(a.result.stop).toBe('max_steps');
    const b = new StreamReader();
    b.line(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' }));
    expect(b.result).toMatchObject({ stop: 'error', error: 'Credit balance is too low' });
  });
});

describe('conversation', () => {
  const history: Message[] = [
    { role: 'user', parts: [{ type: 'text', text: 'how is it?' }] },
    { role: 'assistant', parts: [{ type: 'opaque', provider: 'claude-code', data: { sessionId: 's-9' } }, { type: 'text', text: 'fine' }] },
  ];
  it('finds the session and the transcript', () => {
    expect(sessionOf(history)).toBe('s-9');
    expect(sessionOf([])).toBeUndefined();
    expect(transcript(history)).toBe('Operator: how is it?\n\nAssistant: fine');
  });
  it('builds a command with only the MCP tools', () => {
    const a = args({ oauthToken: 'x', model: 'm', effort: 'medium', mcpUrl: 'http://mcp', mcpToken: 'T' }, { system: 'S', user: 'user:default/j', maxSteps: 5, resume: 's-9' });
    expect(a).toEqual(expect.arrayContaining(['-p', '--model', 'm', '--effort', 'medium', '--tools', '', '--strict-mcp-config', '--max-turns', '5', '--resume', 's-9']));
    const mcp = JSON.parse(a[a.indexOf('--mcp-config') + 1]);
    expect(mcp.mcpServers.ops.headers).toEqual({ Authorization: 'Bearer T', 'X-Refresquito-User': 'user:default/j' });
    expect(a[a.indexOf('--allowedTools') + 1]).toBe('mcp__ops__*');
  });
});

/** a fake claude: prints the lines of FAKE_LINES (or fails a --resume when FAIL_RESUME), echoes its env to a file */
function fakeClaude(dir: string, script: string) {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('ClaudeCodeRunner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-test-'));
  const base = { oauthToken: 'tok', model: 'claude-opus-5-5', effort: 'medium', mcpUrl: 'http://mcp', configDir: join(dir, 'cfg') };
  const run = (bin: string, history: Message[] = [], signal = new AbortController().signal) =>
    new ClaudeCodeRunner({ ...base, bin }).run({ system: 'S', history, question: 'how is it?', user: 'u', maxSteps: 4, signal });

  it('answers, with the token and without an API key in its env', async () => {
    const bin = fakeClaude(
      dir,
      `const env = process.env; if (env.CLAUDE_CODE_OAUTH_TOKEN !== 'tok' || env.ANTHROPIC_API_KEY) process.exit(3);
       let q=''; process.stdin.on('data', d => q += d).on('end', () => {
         for (const l of ${JSON.stringify(lines)}) console.log(JSON.stringify(l)); });`,
    );
    process.env.ANTHROPIC_API_KEY = 'must-not-pass';
    const turn = await run(bin);
    delete process.env.ANTHROPIC_API_KEY;
    expect(turn.answer).toBe('Nothing to do.');
    expect(turn.toolCalls.map(t => t.name)).toEqual(['platform_overview']);
    expect(sessionOf(turn.messages)).toBe('s-1');
    expect(turn.messages).toHaveLength(2);
  });

  it('starts a new session with the transcript when the old one is gone', async () => {
    const bin = fakeClaude(
      dir,
      `const a = process.argv; let q=''; process.stdin.on('data', d => q += d).on('end', () => {
         if (a.includes('--resume')) { console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'No conversation found'})); process.exit(1); }
         console.log(JSON.stringify({type:'result',subtype:'success',result: q.includes('Operator: earlier') ? 'with transcript' : 'without', session_id:'s-2'})); });`,
    );
    const history: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: 'earlier' }] },
      { role: 'assistant', parts: [{ type: 'opaque', provider: 'claude-code', data: { sessionId: 'gone' } }, { type: 'text', text: 'ok' }] },
    ];
    const turn = await run(bin, history);
    expect(turn.answer).toBe('with transcript');
    expect(sessionOf(turn.messages)).toBe('s-2');
  });

  it('reports a failure', async () => {
    const bin = fakeClaude(dir, `console.error('Invalid API key · Please run /login'); process.exit(1);`);
    await expect(run(bin)).rejects.toThrow(/Please run \/login/);
  });

  it('is cancelled', async () => {
    const bin = fakeClaude(dir, `setTimeout(() => {}, 10000);`);
    const abort = new AbortController();
    const p = run(bin, [], abort.signal);
    setTimeout(() => abort.abort(), 200);
    await expect(p).rejects.toBeInstanceOf(Cancelled);
  });
});
