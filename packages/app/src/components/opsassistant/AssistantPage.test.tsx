import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { AssistantPage, AssistantProfile } from './AssistantPage';

const profile: AssistantProfile = {
  path: '/functional',
  store: 'test-assistant',
  title: 'Test Assistant',
  subtitle: 'test',
  intro: 'Answers.',
  examples: [],
  placeholder: 'Ask',
  working: 'Working…',
  notConfigured: 'not configured',
};

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  statusText: '',
  json: async () => body,
});

/** the conversations the backend keeps for the user: {id: {title, state}} */
type Kept = Record<string, { title: string; updatedAt?: string; state: unknown }>;

async function render(jobs: Record<string, unknown>, kept: Kept = {}) {
  const calls: string[] = [];
  const puts: Array<{ url: string; body: any }> = [];
  const posts: any[] = [];
  const fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push(url);
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body!));
      return json({ id: 'new' }, 202);
    }
    if (url.endsWith('/conversations'))
      return json(Object.entries(kept).map(([id, c]) => ({ id, title: c.title, updatedAt: c.updatedAt ?? '2026-10-29T10:00:00Z' })));
    if (url.includes('/conversations/')) {
      const id = url.split('/conversations/')[1];
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body!);
        puts.push({ url, body });
        kept[id] = body;
        return json({}, 204);
      }
      return id in kept ? json({ id, ...kept[id] }) : json({ error: 'No such conversation' }, 404);
    }
    if (url.endsWith('/info'))
      return json({ enabled: true, allowed: true, model: 'm' });
    const id = url.split('/chat/')[1];
    return id in jobs
      ? json(jobs[id])
      : json(
          {
            error:
              'This question is no longer here (Backstage restarted?): ask it again.',
          },
          404,
        );
  });
  const discovery = { getBaseUrl: async () => 'http://b/api/ops-assistant' };
  // the systems of the catalog, to charge the questions to one of them
  const catalog = { getEntities: async () => ({ items: [{ metadata: { name: 'petstore' } }, { metadata: { name: 'animalshelter' } }] }) };
  return {
    calls,
    puts,
    posts,
    view: await renderInTestApp(
      <TestApiProvider
        apis={[
          [discoveryApiRef, discovery],
          [fetchApiRef, { fetch }],
          [catalogApiRef, catalog],
        ]}
      >
        <AssistantPage profile={profile} />
      </TestApiProvider>,
    ),
  };
}

const stored = (exchange: Record<string, unknown>) =>
  sessionStorage.setItem(
    profile.store,
    JSON.stringify({ messages: [], exchanges: [exchange] }),
  );

jest.setTimeout(15000);

describe('AssistantPage, a question left waiting', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Element.prototype.scrollIntoView = jest.fn(); // not in jsdom
  });

  it('collects the answer of its job when the page comes back', async () => {
    stored({ question: 'q', job: 'j1' });
    const turn = {
      answer: 'the answer',
      toolCalls: [],
      model: 'm',
      messages: [{ role: 'user', parts: [] }],
    };
    const { calls, puts } = await render({
      j1: { status: 'done', elapsedMs: 1000, turn },
    });
    expect(
      await screen.findByText('the answer', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(calls).toContain('http://b/api/ops-assistant/functional/chat/j1');
    const saved = JSON.parse(sessionStorage.getItem(profile.store)!);
    expect(saved.exchanges[0]).not.toHaveProperty('job');
    expect(saved.messages).toEqual(turn.messages);
    // and kept in the backend, under the id of the tab's conversation, titled by its first question
    await waitFor(() =>
      expect(puts.some(p => p.body.state.exchanges[0]?.answer === 'the answer')).toBe(true),
    );
    const last = puts[puts.length - 1];
    expect(last.url).toBe(`http://b/api/ops-assistant/functional/conversations/${saved.id}`);
    expect(last.body.title).toBe('q');
  });

  it('says so when the job is gone', async () => {
    stored({ question: 'q', job: 'gone' });
    await render({});
    expect(
      await screen.findByText(/no longer here/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('says so when the question was stored without its job (pages before this change)', async () => {
    stored({ question: 'q' });
    await render({});
    expect(await screen.findByText(/answer was not kept/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Thinking…')).not.toBeInTheDocument(),
    );
  });

  it('keeps the job with the question, so leaving the page does not lose it', async () => {
    const { view } = await render({
      new: { status: 'running', toolCalls: [], elapsedMs: 10 },
    });
    fireEvent.change(await screen.findByPlaceholderText('Ask'), {
      target: { value: 'a question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() =>
      expect(
        JSON.parse(sessionStorage.getItem(profile.store)!).exchanges[0],
      ).toEqual({ question: 'a question', job: 'new' }),
    );
    view.unmount();
    await new Promise(r => setTimeout(r, 2500)); // the next poll sees the page gone and stops quietly
    expect(
      JSON.parse(sessionStorage.getItem(profile.store)!).exchanges[0],
    ).toEqual({ question: 'a question', job: 'new' });
  });
});

describe('AssistantPage, the conversations kept in the backend', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Element.prototype.scrollIntoView = jest.fn(); // not in jsdom
  });

  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const conv = (q: string, a: string, updatedAt: string) => ({
    title: q,
    updatedAt,
    state: { messages: [], exchanges: [{ question: q, answer: a }] },
  });

  it('a new tab opens the most recent one and lists the others', async () => {
    await render({}, { [A]: conv('the last question', 'the last answer', '2026-10-29T10:00:00Z'), [B]: conv('an older one', 'older answer', '2026-10-01T10:00:00Z') });
    expect(await screen.findByText('the last answer')).toBeInTheDocument();
    expect(screen.getByText('an older one')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(profile.store)!).id).toBe(A);
  });

  it('opens another one when it is chosen, without saving it again', async () => {
    const { puts } = await render({}, { [A]: conv('the last question', 'the last answer', '2026-10-29T10:00:00Z'), [B]: conv('an older one', 'older answer', '2026-10-01T10:00:00Z') });
    await screen.findByText('the last answer');
    fireEvent.click(screen.getByText('an older one'));
    expect(await screen.findByText('older answer')).toBeInTheDocument();
    expect(puts).toEqual([]);
  });

  it('keeps the tab\'s conversation, not the most recent, when the tab already has one', async () => {
    sessionStorage.setItem(profile.store, JSON.stringify({ id: B, messages: [], exchanges: [{ question: 'mine', answer: 'my answer' }] }));
    await render({}, { [A]: conv('the last question', 'the last answer', '2026-10-29T10:00:00Z') });
    expect(await screen.findByText('my answer')).toBeInTheDocument();
    expect(screen.queryByText('the last answer')).not.toBeInTheDocument();
  });
});

describe('AssistantPage, the system its cost is charged to', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Element.prototype.scrollIntoView = jest.fn(); // not in jsdom
  });

  it('sends the system chosen with the question, and keeps it with the conversation', async () => {
    const { posts, puts } = await render({ new: { status: 'running', toolCalls: [], elapsedMs: 10 } });
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Charge its cost to/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'petstore' }));
    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'a question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ question: 'a question', system: 'petstore' })]));
    await waitFor(() => expect(puts.some(p => p.body.state.system === 'petstore')).toBe(true));
    expect(JSON.parse(sessionStorage.getItem(profile.store)!).system).toBe('petstore');
  });

  it('sends no system when none is chosen (the backend works it out from the tools)', async () => {
    const { posts } = await render({ new: { status: 'running', toolCalls: [], elapsedMs: 10 } });
    fireEvent.change(await screen.findByPlaceholderText('Ask'), { target: { value: 'a question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty('system');
  });
});
