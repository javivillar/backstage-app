import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express from 'express';
import { createAssistantRouter } from './assistant';
import { ConversationStore, DEFAULT_RETENTION_DAYS, ensureTable } from './conversations';

/** an assistant id: its routes, the name of its MCP server for Claude Code, its logs */
const ID = /^[a-z][a-z0-9]{1,15}$/;

/**
 * Backend of the assistants of Backstage: each one a model with the READ-ONLY tools of its own MCP server, answering
 * on a page of its own, a session apart from the others. The same engine for all of them (src/assistant.ts):
 *
 *   ops   the operations assistant (page /ops-assistant): opsassistant-oneke (Kubernetes, Argo CD, logs, metrics,
 *         the documentation of the platform). Block `opsAssistant`; routes /api/ops-assistant/... (as before) and
 *         /api/ops-assistant/ops/...
 *   <id>  any other one, block `assistants.<id>`, routes /api/ops-assistant/<id>/...: today `sec`, the security
 *         assistant (page /sec-assistant): secassistant-oneke (catalog, scorecard, vulnerabilities, SBOMs and
 *         licenses, quality reports, code and CI).
 *
 * The model of each one is its `model` (src/model/: Anthropic today, another adapter for a local model) or its runner
 * claude-code; the instructions are its `systemPrompt` (chart cnoe-oneke, provider-neutral text). Routes and config
 * of one assistant: src/assistant.ts.
 *
 * The conversations of every assistant are kept in the database of this plugin (src/conversations.ts), each user's
 * apart, `assistantConversations.retentionDays` (default 90) after their last change.
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
        database: coreServices.database,
        scheduler: coreServices.scheduler,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger, database, scheduler }) {
        // without its database the assistants still answer; only their conversations are not kept
        let conversations: ConversationStore | undefined;
        const days = config.getOptionalNumber('assistantConversations.retentionDays') ?? DEFAULT_RETENTION_DAYS;
        try {
          const knex = await database.getClient();
          await ensureTable(knex);
          conversations = new ConversationStore(knex);
          await scheduler.scheduleTask({
            id: 'ops-assistant-purge-conversations',
            frequency: { hours: 24 },
            timeout: { minutes: 5 },
            initialDelay: { minutes: 1 },
            fn: async () => {
              const n = await conversations!.purge(days);
              if (n) logger.info(`ops-assistant: ${n} conversations older than ${days} days deleted`);
            },
          });
        } catch (e) {
          logger.error(`ops-assistant: conversations are not kept: ${(e as Error).message}`);
        }
        const deps = { httpAuth, userInfo, logger, conversations, keepDays: days };
        const router = express.Router();
        // the operations assistant: at the root, as before the other assistants existed, and at /ops
        const ops = createAssistantRouter({ id: 'ops', settings: config.getOptionalConfig('opsAssistant'), ...deps });
        router.use('/ops', ops);
        const others = config.getOptionalConfig('assistants');
        for (const id of others?.keys() ?? []) {
          if (id === 'ops') {
            logger.warn('ops-assistant: assistants.ops is ignored (the operations assistant is the block opsAssistant)');
            continue;
          }
          if (!ID.test(id)) {
            logger.error(`ops-assistant: assistants.${id}: an id is 2 to 16 lowercase letters and digits`);
            continue;
          }
          router.use(`/${id}`, createAssistantRouter({ id, settings: others!.getConfig(id), ...deps }));
        }
        router.use(ops);
        httpRouter.use(router);
      },
    });
  },
});
