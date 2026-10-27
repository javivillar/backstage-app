import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
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

async function render(jobs: Record<string, unknown>) {
  const calls: string[] = [];
  const fetch = jest.fn(async (url: string, init?: { method?: string }) => {
    calls.push(url);
    if (init?.method === 'POST') return json({ id: 'new' }, 202);
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
  return {
    calls,
    view: await renderInTestApp(
      <TestApiProvider
        apis={[
          [discoveryApiRef, discovery],
          [fetchApiRef, { fetch }],
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
    const { calls } = await render({
      j1: { status: 'done', elapsedMs: 1000, turn },
    });
    expect(
      await screen.findByText('the answer', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(calls).toContain('http://b/api/ops-assistant/functional/chat/j1');
    const saved = JSON.parse(sessionStorage.getItem(profile.store)!);
    expect(saved.exchanges[0]).not.toHaveProperty('job');
    expect(saved.messages).toEqual(turn.messages);
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
