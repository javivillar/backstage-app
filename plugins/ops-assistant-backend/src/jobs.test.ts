import { Jobs, KEEP_MS, MAX_RUNNING_PER_USER } from './jobs';
import type { Turn } from './agent';

const turn = { answer: 'ok', messages: [], toolCalls: [], stop: 'end', usage: {} } as Turn;
const flush = () => new Promise(r => setImmediate(r));

describe('Jobs', () => {
  it('runs in the background and keeps the result for its user only', async () => {
    const jobs = new Jobs();
    let finish!: (t: Turn) => void;
    const job = jobs.start('user:default/a', j => {
      j.toolCalls.push({ name: 'platform_overview', input: {}, isError: false, chars: 10 });
      return new Promise<Turn>(r => (finish = r));
    })!;
    expect(jobs.get(job.id, 'user:default/a')?.status).toBe('running');
    expect(jobs.get(job.id, 'user:default/a')?.toolCalls).toHaveLength(1);
    expect(jobs.get(job.id, 'user:default/b')).toBeUndefined();
    finish(turn);
    await flush();
    expect(jobs.get(job.id, 'user:default/a')?.status).toBe('done');
    expect(jobs.get(job.id, 'user:default/a')?.turn?.answer).toBe('ok');
  });

  it('records a failure', async () => {
    const jobs = new Jobs();
    const job = jobs.start('u', async () => {
      throw new Error('401 invalid x-api-key');
    })!;
    await flush();
    expect(jobs.get(job.id, 'u')).toMatchObject({ status: 'error', error: '401 invalid x-api-key' });
  });

  it('limits the questions running per user', () => {
    const jobs = new Jobs();
    const never = () => new Promise<Turn>(() => {});
    for (let i = 0; i < MAX_RUNNING_PER_USER; i++) expect(jobs.start('u', never)).toBeDefined();
    expect(jobs.start('u', never)).toBeUndefined();
    expect(jobs.start('other', never)).toBeDefined();
  });

  it('forgets finished jobs after a while', async () => {
    let now = 0;
    const jobs = new Jobs(() => now);
    const job = jobs.start('u', async () => turn)!;
    await flush();
    now = KEEP_MS * 2 + 1;
    jobs.start('u', async () => turn);
    expect(jobs.get(job.id, 'u')).toBeUndefined();
  });
});

describe('Jobs.cancel', () => {
  it('aborts the work of its own user only', async () => {
    const jobs = new Jobs();
    let seen: AbortSignal | undefined;
    const job = jobs.start('u', j => {
      seen = j.signal;
      return new Promise<Turn>((_, reject) => j.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    })!;
    expect(jobs.cancel(job.id, 'other')).toBe(false);
    expect(jobs.cancel(job.id, 'u')).toBe(true);
    expect(seen?.aborted).toBe(true);
    await flush();
    expect(jobs.get(job.id, 'u')?.status).toBe('cancelled');
    expect(jobs.cancel(job.id, 'u')).toBe(false);
    expect(jobs.running('u')).toBe(0);
  });
  it('takes another limit per caller (the analyses of an application)', () => {
    const jobs = new Jobs();
    const never = () => new Promise<never>(() => undefined);
    expect(jobs.start('app:a', never, 1)).toBeDefined();
    expect(jobs.start('app:a', never, 1)).toBeUndefined();
  });
});
