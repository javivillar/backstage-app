import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Response } from 'express';
import { mayUse } from './access';
import { runTurn } from './agent';
import { MAX_QUESTION_CHARS, parseHistory } from './history';
import { McpClient } from './mcp';
import { providerFromConfig } from './model';

/**
 * Backend of the operations assistant (page /ops-assistant): answers questions about operating and troubleshooting
 * the cluster with a model and the READ-ONLY tools of the MCP server opsassistant-oneke (state of Kubernetes and Argo
 * CD, events, logs, Prometheus, Loki, the documentation of the platform). The model is whatever
 * opsAssistant.model says (src/model/: Anthropic today, another adapter for a local model); the instructions are
 * opsAssistant.systemPrompt (chart cnoe-oneke, provider-neutral text).
 *
 *   GET  /api/ops-assistant/info     {enabled, model, allowed}: what the page shows
 *   POST /api/ops-assistant/chat     {question, messages?} -> {answer, messages, toolCalls, stop, model, usage}
 *                                    messages: the conversation so far, as the last answer returned it
 *
 * Config (app-config):
 *   opsAssistant:
 *     mcpUrl: http://opsassistant-oneke.<ns>:8080/mcp
 *     mcpToken: ${OPS_ASSISTANT_MCP_TOKEN}
 *     allowedGroups: [backstage-admin]   # who may use it (deny by default)
 *     maxSteps: 12                       # model calls per question at most
 *     systemPrompt: |                    # the instructions
 *     model: {provider, name, effort, apiKey, baseUrl}   (src/model/index.ts)
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
        let provider;
        try {
          provider = providerFromConfig(settings?.getOptionalConfig('model'));
        } catch (e) {
          logger.error(`ops-assistant: ${(e as Error).message}`);
        }
        const mcp = mcpUrl ? new McpClient({ url: mcpUrl, token: settings?.getOptionalString('mcpToken') }) : undefined;
        const enabled = !!(provider && mcp && system);
        if (!enabled) logger.info('ops-assistant: disabled (needs opsAssistant.mcpUrl, systemPrompt and model.apiKey)');

        const caller = async (req: Request) => {
          const credentials = await httpAuth.credentials(req, { allow: ['user'] });
          const info = await userInfo.getUserInfo(credentials);
          return { user: info.userEntityRef, allowed: mayUse(info.ownershipEntityRefs, allowedGroups) };
        };

        const router = express.Router();
        router.use(express.json({ limit: '4mb' }));

        router.get('/info', async (req: Request, res: Response) => {
          const { allowed } = await caller(req);
          res.json({ enabled, allowed, model: enabled ? provider!.label : undefined, maxSteps });
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
          const started = Date.now();
          try {
            const turn = await runTurn({
              provider: provider!,
              system,
              history,
              question,
              maxSteps,
              tools: { list: () => mcp!.listTools(), call: (name, input) => mcp!.callTool(name, input, user) },
            });
            // one audit line per question: who, what was looked at, what it cost (never the answer or the data)
            logger.info('ops-assistant turn', {
              user,
              model: turn.model ?? provider!.label,
              stop: turn.stop,
              tools: turn.toolCalls.map(t => `${t.name}${t.isError ? '!' : ''}`).join(','),
              ms: Date.now() - started,
              ...Object.fromEntries(Object.entries(turn.usage).map(([k, v]) => [`tokens_${k}`, v])),
            });
            res.json(turn);
          } catch (e) {
            logger.warn(`ops-assistant: ${user}: ${(e as Error).message}`);
            res.status(502).json({ error: `The model could not answer: ${(e as Error).message}` });
          }
        });

        httpRouter.use(router);
      },
    });
  },
});
