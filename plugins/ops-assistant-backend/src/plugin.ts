import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Response } from 'express';
import { mayUse } from './access';
import { runTurn, type ToolCallRecord, type Turn } from './agent';
import { ClaudeCodeRunner } from './claudeCode';
import { MAX_QUESTION_CHARS, parseHistory } from './history';
import { Jobs, MAX_RUNNING_PER_USER } from './jobs';
import { McpClient } from './mcp';
import { providerFromConfig, type Message } from './model';

/**
 * Backend of the operations assistant (page /ops-assistant): answers questions about operating and troubleshooting
 * the cluster with a model and the READ-ONLY tools of the MCP server opsassistant-oneke (state of Kubernetes and Argo
 * CD, events, logs, Prometheus, Loki, the documentation of the platform). The model is whatever
 * opsAssistant.model says (src/model/: Anthropic today, another adapter for a local model); the instructions are
 * opsAssistant.systemPrompt (chart cnoe-oneke, provider-neutral text).
 *
 *   GET  /api/ops-assistant/info     {enabled, model, allowed}: what the page shows
 *   POST /api/ops-assistant/chat     {question, messages?} -> 202 {id}: the question is being answered
 *                                    messages: the conversation so far, as the last answer returned it
 *   GET  /api/ops-assistant/chat/:id {status: running|done|error, toolCalls, elapsedMs, turn?, error?}
 *                                    turn: {answer, messages, toolCalls, stop, model, usage}
 *   DELETE /api/ops-assistant/chat/:id   cancels it (the conversation stays as it was before the question)
 *   (a question takes longer than a proxy keeps a request open: src/jobs.ts)
 *
 * Config (app-config):
 *   opsAssistant:
 *     mcpUrl: http://opsassistant-oneke.<ns>:8080/mcp
 *     mcpToken: ${OPS_ASSISTANT_MCP_TOKEN}
 *     allowedGroups: [backstage-admin]   # who may use it (deny by default)
 *     maxSteps: 12                       # model calls per question at most
 *     systemPrompt: |                    # the instructions
 *     runner: api                        # api: our loop + the model of `model` (src/model/), billed by use;
 *                                        # claude-code: Claude Code with the operator's Claude subscription
 *     model: {provider, name, effort, apiKey, baseUrl}   (src/model/index.ts; claude-code uses name and effort)
 *     claudeCode:
 *       oauthToken: ${OPS_ASSISTANT_CLAUDE_CODE_TOKEN}   # `claude setup-token` (Pro/Max)
 */
export const opsAssistantPlugin = createBackendPlugin({
  pluginId: 'ops-assistant',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger }) {
        const settings = config.getOptionalConfig('opsAssistant');
        const mcpUrl = settings?.getOptionalString('mcpUrl') ?? '';
        const allowedGroups = settings?.getOptionalStringArray('allowedGroups') ?? [];
        const maxSteps = settings?.getOptionalNumber('maxSteps') ?? 12;
        const system = settings?.getOptionalString('systemPrompt') ?? '';
        const runnerName = settings?.getOptionalString('runner') ?? 'api';
        const modelConfig = settings?.getOptionalConfig('model');
        const mcpToken = settings?.getOptionalString('mcpToken');
        const mcp = mcpUrl ? new McpClient({ url: mcpUrl, token: mcpToken }) : undefined;

        type Run = (o: {
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
            const oauthToken = settings?.getOptionalString('claudeCode.oauthToken') ?? '';
            needs = 'opsAssistant.claudeCode.oauthToken';
            if (oauthToken && mcpUrl) {
              const cc = new ClaudeCodeRunner({
                oauthToken,
                model: modelConfig?.getOptionalString('name') ?? 'claude-opus-5-5',
                effort: modelConfig?.getOptionalString('effort'),
                mcpUrl,
                mcpToken,
                bin: settings?.getOptionalString('claudeCode.bin'),
              });
              label = cc.label;
              run = o => cc.run({ ...o, system, maxSteps });
            }
          } else if (runnerName === 'api') {
            needs = 'opsAssistant.model.apiKey';
            const provider = providerFromConfig(modelConfig);
            if (provider && mcp) {
              label = provider.label;
              run = o =>
                runTurn({
                  provider,
                  system,
                  history: o.history,
                  question: o.question,
                  maxSteps,
                  tools: { list: () => mcp.listTools(), call: (name, input) => mcp.callTool(name, input, o.user) },
                  onToolCall: o.onToolCall,
                  signal: o.signal,
                });
            }
          } else {
            throw new Error(`opsAssistant.runner ${runnerName}: api or claude-code`);
          }
        } catch (e) {
          logger.error(`ops-assistant: ${(e as Error).message}`);
        }
        const enabled = !!(run && mcpUrl && system);
        if (!enabled) logger.info(`ops-assistant: disabled (runner ${runnerName} needs opsAssistant.mcpUrl, systemPrompt and ${needs})`);
        else logger.info(`ops-assistant: ${label}`);

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
          res.json({ enabled, allowed, model: enabled ? label : undefined, runner: runnerName, maxSteps });
        });

        router.post('/chat', async (req: Request, res: Response) => {
          const { user, allowed } = await caller(req);
          if (!allowed) {
            res.status(403).json({ error: `Only members of ${allowedGroups.join(', ') || '(no group configured)'} may use the assistant.` });
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
            // one audit line per question: who, what was looked at, what it cost (never the answer or the data)
            logger.info('ops-assistant turn', {
              user,
              runner: runnerName,
              model: turn.model ?? label,
              stop: turn.stop,
              tools: turn.toolCalls.map(t => `${t.name}${t.isError ? '!' : ''}`).join(','),
              ms: Date.now() - j.startedAt,
              ...Object.fromEntries(Object.entries(turn.usage).map(([k, v]) => [`tokens_${k}`, v])),
            });
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
          logger.info('ops-assistant cancelled', { user });
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
          if (job.status === 'error') logger.warn(`ops-assistant: ${user}: ${job.error}`);
          res.json({
            status: job.status,
            toolCalls: job.toolCalls,
            elapsedMs: (job.endedAt ?? Date.now()) - job.startedAt,
            turn: job.turn,
            error: job.error ? `The model could not answer: ${job.error}` : undefined,
          });
        });

        httpRouter.use(router);
      },
    });
  },
});
