import type { HttpAuthService, LoggerService, RootConfigService, UserInfoService } from '@backstage/backend-plugin-api';
import express, { Request, Response, Router } from 'express';
import { mayUse } from './access';
import { runTurn, type ToolCallRecord, type Turn } from './agent';
import { ClaudeCodeRunner } from './claudeCode';
import { CONVERSATION_ID, type ConversationStore } from './conversations';
import { MAX_QUESTION_CHARS, parseHistory } from './history';
import { Jobs, MAX_RUNNING_PER_USER } from './jobs';
import { McpClient } from './mcp';
import { providerFromConfig, type Message } from './model';
import { subjectName, subjectsOf, type UsageStore } from './usage';

type Config = NonNullable<ReturnType<RootConfigService['getOptionalConfig']>>;

/**
 * One assistant: its MCP server, its runner and model, its instructions, who may use it, and its own questions being
 * answered (each assistant is a session apart: the operations one and the security one never share a conversation,
 * a queue or a Claude Code session). The same engine for every assistant; what differs is its configuration block.
 *
 * Its block (app-config: `opsAssistant` for the assistant `ops`, `assistants.<id>` for the others):
 *     title: Security assistant           # how the page and the logs name it
 *     mcpUrl: http://...:8080/mcp         # its read-only tools
 *     mcpToken: ${..._MCP_TOKEN}
 *     allowedGroups: [backstage-admin]    # who may use it (deny by default)
 *     maxSteps: 12                        # model calls per question at most
 *     systemPrompt: |                     # its instructions (provider-neutral text)
 *     runner: api                         # api: our loop + the model of `model` (src/model/), billed by use;
 *                                         # claude-code: Claude Code with the operator's Claude subscription
 *     model: {provider, name, effort, apiKey, baseUrl}   (src/model/index.ts; claude-code uses name and effort)
 *     claudeCode: {oauthToken, bin}       # `claude setup-token` (Pro/Max)
 *
 * Its routes (under the router this returns):
 *   GET    /info       {enabled, allowed, model, runner, maxSteps, title, keepDays}
 *   POST   /chat       {question, messages?, system?} -> 202 {id}   system: the one its cost is charged to
 *   GET    /chat/:id   {status: running|done|error, toolCalls, elapsedMs, turn?, error?}
 *   DELETE /chat/:id   cancels it
 *   GET    /conversations       the user's conversations with it, the most recent first [{id, title, updatedAt}]
 *   GET    /conversations/:id   one of them {id, title, updatedAt, state}
 *   PUT    /conversations/:id   {title, state: {exchanges, messages, system?}} creates or replaces it (the page saves after each change)
 *   DELETE /conversations/:id   deletes it
 * Each user sees only their own conversations (src/conversations.ts); without a store they answer 503.
 * Each question answered is recorded in `usage` (src/usage.ts): who, which model, its tokens, what it was about.
 */
export function createAssistantRouter(o: {
  id: string;
  settings?: Config;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  logger: LoggerService;
  conversations?: ConversationStore;
  /** how long the conversations are kept (the page says it) */
  keepDays?: number;
  /** where what each question consumed is recorded, for the costs; without it nothing is recorded */
  usage?: UsageStore;
}): Router {
  const { id, settings, httpAuth, userInfo, logger, conversations, keepDays, usage } = o;
  const key = id === 'ops' ? 'opsAssistant' : `assistants.${id}`;
  const title = settings?.getOptionalString('title') ?? (id === 'ops' ? 'Operations assistant' : `Assistant ${id}`);
  const mcpUrl = settings?.getOptionalString('mcpUrl') ?? '';
  const allowedGroups = settings?.getOptionalStringArray('allowedGroups') ?? [];
  const maxSteps = settings?.getOptionalNumber('maxSteps') ?? 12;
  const system = settings?.getOptionalString('systemPrompt') ?? '';
  const runnerName = settings?.getOptionalString('runner') ?? 'api';
  const modelConfig = settings?.getOptionalConfig('model');
  const mcpToken = settings?.getOptionalString('mcpToken');
  const mcp = mcpUrl ? new McpClient({ url: mcpUrl, token: mcpToken }) : undefined;
  const log = `${id}-assistant`;

  type Run = (r: {
    history: Message[];
    question: string;
    user: string;
    onToolCall: (c: ToolCallRecord) => void;
    signal: AbortSignal;
  }) => Promise<Turn>;
  let run: Run | undefined;
  let label: string | undefined;
  let needs = '';
  try {
    if (runnerName === 'claude-code') {
      needs = `${key}.claudeCode.oauthToken`;
      // empty while the store key has no token yet: "needs …", not a config error
      let oauthToken = '';
      try {
        oauthToken = settings?.getOptionalString('claudeCode.oauthToken') ?? '';
      } catch {
        oauthToken = '';
      }
      if (oauthToken && mcpUrl) {
        const cc = new ClaudeCodeRunner({
          oauthToken,
          model: modelConfig?.getOptionalString('name') ?? 'claude-opus-5-5',
          effort: modelConfig?.getOptionalString('effort'),
          mcpUrl,
          mcpToken,
          bin: settings?.getOptionalString('claudeCode.bin'),
          // its own MCP server name and its own sessions: the assistants never share a Claude Code session
          server: id,
          configDir: `/tmp/${id}-assistant-claude`,
        });
        label = cc.label;
        run = r => cc.run({ ...r, system, maxSteps });
      }
    } else if (runnerName === 'api') {
      needs = `${key}.model.apiKey`;
      const provider = providerFromConfig(modelConfig);
      if (provider && mcp) {
        label = provider.label;
        run = r =>
          runTurn({
            provider,
            system,
            history: r.history,
            question: r.question,
            maxSteps,
            tools: { list: () => mcp.listTools(), call: (name, input) => mcp.callTool(name, input, r.user) },
            onToolCall: r.onToolCall,
            signal: r.signal,
          });
      }
    } else {
      throw new Error(`${key}.runner ${runnerName}: api or claude-code`);
    }
  } catch (e) {
    logger.error(`${log}: ${(e as Error).message}`);
  }
  const enabled = !!(run && mcpUrl && system);
  if (!settings) logger.info(`${log}: not configured (${key})`);
  else if (!enabled) logger.info(`${log}: disabled (runner ${runnerName} needs ${key}.mcpUrl, systemPrompt and ${needs})`);
  else logger.info(`${log}: ${label}`);

  const caller = async (req: Request) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);
    return { user: info.userEntityRef, allowed: mayUse(info.ownershipEntityRefs, allowedGroups) };
  };

  const jobs = new Jobs();
  const router = express.Router();
  router.use(express.json({ limit: '4mb' }));

  router.get('/info', async (req: Request, res: Response) => {
    const { allowed } = await caller(req);
    res.json({ enabled, allowed, model: enabled ? label : undefined, runner: runnerName, maxSteps, title, keepDays: conversations ? keepDays : undefined });
  });

  router.post('/chat', async (req: Request, res: Response) => {
    const { user, allowed } = await caller(req);
    if (!allowed) {
      res.status(403).json({ error: `Only members of ${allowedGroups.join(', ') || '(no group configured)'} may use the ${title.toLowerCase()}.` });
      return;
    }
    if (!enabled) {
      res.status(503).json({ error: 'The assistant is not configured.' });
      return;
    }
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question || question.length > MAX_QUESTION_CHARS) {
      res.status(400).json({ error: `question: 1 to ${MAX_QUESTION_CHARS} characters` });
      return;
    }
    // the system its cost is charged to (chosen in the page); without it, what the tools looked at
    const rawSystem = req.body?.system;
    const chosen = rawSystem === undefined || rawSystem === null || rawSystem === '' ? undefined : subjectName(rawSystem);
    if (rawSystem && !chosen) {
      res.status(400).json({ error: 'system: the name of a system of the catalog' });
      return;
    }
    let history;
    try {
      history = parseHistory(req.body?.messages);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const job = jobs.start(user, async j => {
      const turn = await run!({
        history,
        question,
        user,
        onToolCall: call => j.toolCalls.push(call),
        signal: j.signal,
      });
      const ms = Date.now() - j.startedAt;
      // one audit line per question: which assistant, who, what was looked at, what it cost (never the answer or the data)
      logger.info(`${log} turn`, {
        assistant: id,
        user,
        runner: runnerName,
        model: turn.model ?? label,
        stop: turn.stop,
        system: chosen,
        tools: turn.toolCalls.map(t => `${t.name}${t.isError ? '!' : ''}`).join(','),
        ms,
        ...Object.fromEntries(Object.entries(turn.usage ?? {}).map(([k, v]) => [`tokens_${k}`, v])),
      });
      // what it consumed, for the costs: a failure here never loses the answer
      await usage
        ?.record({
          at: new Date(),
          assistant: id,
          user,
          runner: runnerName,
          model: turn.model ?? label ?? 'unknown',
          system: chosen,
          subjects: subjectsOf(turn.toolCalls),
          usage: turn.usage ?? {},
          ms,
          tools: turn.toolCalls.length,
        })
        .catch(e => logger.warn(`${log}: its usage was not recorded: ${(e as Error).message}`));
      return turn;
    });
    if (!job) {
      res.status(429).json({ error: `You already have ${MAX_RUNNING_PER_USER} questions being answered; wait for them.` });
      return;
    }
    res.status(202).json({ id: job.id });
  });

  router.delete('/chat/:id', async (req: Request, res: Response) => {
    const { user, allowed } = await caller(req);
    if (!allowed) {
      res.status(403).json({ error: 'Not allowed.' });
      return;
    }
    if (!jobs.cancel(req.params.id, user)) {
      res.status(404).json({ error: 'No such question being answered.' });
      return;
    }
    logger.info(`${log} cancelled`, { assistant: id, user });
    res.status(204).end();
  });

  router.get('/chat/:id', async (req: Request, res: Response) => {
    const { user, allowed } = await caller(req);
    if (!allowed) {
      res.status(403).json({ error: 'Not allowed.' });
      return;
    }
    const job = jobs.get(req.params.id, user);
    if (!job) {
      res.status(404).json({ error: 'This question is no longer here (Backstage restarted?): ask it again.' });
      return;
    }
    if (job.status === 'error') logger.warn(`${log}: ${user}: ${job.error}`);
    res.json({
      status: job.status,
      toolCalls: job.toolCalls,
      elapsedMs: (job.endedAt ?? Date.now()) - job.startedAt,
      turn: job.turn,
      error: job.error ? `The model could not answer: ${job.error}` : undefined,
    });
  });

  /** the user and the store, or the answer already sent (no access, no store, a bad id) */
  const ownConversations = async (req: Request, res: Response) => {
    const { user, allowed } = await caller(req);
    if (!allowed) {
      res.status(403).json({ error: 'Not allowed.' });
      return undefined;
    }
    if (!conversations) {
      res.status(503).json({ error: 'Conversations are not kept (no database).' });
      return undefined;
    }
    if (req.params.id !== undefined && !CONVERSATION_ID.test(req.params.id)) {
      res.status(400).json({ error: 'Not a conversation id.' });
      return undefined;
    }
    return { user, store: conversations };
  };

  router.get('/conversations', async (req: Request, res: Response) => {
    const own = await ownConversations(req, res);
    if (own) res.json(await own.store.list(own.user, id));
  });

  router.get('/conversations/:id', async (req: Request, res: Response) => {
    const own = await ownConversations(req, res);
    if (!own) return;
    const c = await own.store.get(own.user, id, req.params.id);
    if (c) res.json(c);
    else res.status(404).json({ error: 'No such conversation (deleted, or older than its retention).' });
  });

  router.put('/conversations/:id', async (req: Request, res: Response) => {
    const own = await ownConversations(req, res);
    if (!own) return;
    const name = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const state = req.body?.state;
    if (!name || !state || typeof state !== 'object' || !Array.isArray(state.exchanges) || !Array.isArray(state.messages)) {
      res.status(400).json({ error: 'title and state {exchanges, messages} are required' });
      return;
    }
    // system: the one its questions are charged to, chosen in the page
    const kept = { exchanges: state.exchanges, messages: state.messages, ...(typeof state.system === 'string' && state.system ? { system: state.system.slice(0, 253) } : {}) };
    if (!(await own.store.put(own.user, id, req.params.id, name, kept))) {
      res.status(404).json({ error: 'No such conversation.' });
      return;
    }
    res.status(204).end();
  });

  router.delete('/conversations/:id', async (req: Request, res: Response) => {
    const own = await ownConversations(req, res);
    if (!own) return;
    if (!(await own.store.delete(own.user, id, req.params.id))) {
      res.status(404).json({ error: 'No such conversation.' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
