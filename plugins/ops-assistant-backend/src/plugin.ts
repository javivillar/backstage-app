import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express from 'express';
import { mayUse } from './access';
import { createAssistantRouter } from './assistant';
import { ConversationStore, DEFAULT_RETENTION_DAYS, ensureTable } from './conversations';
import { DeveloperRuns, sweepDeveloperRuns } from './developerRuns';
import { currentMonth, DEFAULT_USAGE_RETENTION_DAYS, ensureUsageTable, UsageStore } from './usage';

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
 *
 * What each question consumed (who, which assistant and model, its tokens, which system it was about) is recorded too
 * (src/usage.ts), `assistantUsage.retentionDays` (default 400), for the page /costs:
 * The runs of the developer workflow (GitHub Actions) are read from GitHub every 30 minutes (src/developerRuns.ts,
 * assistantUsage.developerWorkflow: {owner, repo, workflow}).
 *   GET /api/ops-assistant/usage?month=YYYY-MM   {month, all, groups}   (signed-in users; who asked is shown only for
 *       their own questions, or for everyone's to the members of assistantUsage.viewAllGroups, default backstage-admin)
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
        // nor without it what they consume: they answer all the same
        let usage: UsageStore | undefined;
        const usageDays = config.getOptionalNumber('assistantUsage.retentionDays') ?? DEFAULT_USAGE_RETENTION_DAYS;
        try {
          const knex = await database.getClient();
          await ensureUsageTable(knex);
          usage = new UsageStore(knex);
          await scheduler.scheduleTask({
            id: 'ops-assistant-purge-usage',
            frequency: { hours: 24 },
            timeout: { minutes: 5 },
            initialDelay: { minutes: 2 },
            fn: async () => {
              const n = await usage!.purge(usageDays);
              if (n) logger.info(`ops-assistant: ${n} usage rows older than ${usageDays} days deleted`);
            },
          });
        } catch (e) {
          logger.error(`ops-assistant: what the assistants consume is not recorded: ${(e as Error).message}`);
        }
        // the runs of the developer workflow (GitHub Actions) do not go through Backstage: read from GitHub
        const wf = config.getOptionalConfig('assistantUsage.developerWorkflow');
        const githubToken = config
          .getOptionalConfigArray('integrations.github')
          ?.find(h => (h.getOptionalString('host') ?? 'github.com') === 'github.com')
          ?.getOptionalString('token');
        if (usage && wf && githubToken) {
          const settings = {
            owner: wf.getString('owner'),
            repo: wf.getString('repo'),
            workflow: wf.getOptionalString('workflow') ?? 'develop.yml',
            token: githubToken,
          };
          const runs = new DeveloperRuns(settings);
          const store = usage;
          await scheduler.scheduleTask({
            id: 'ops-assistant-developer-runs',
            frequency: { minutes: 30 },
            timeout: { minutes: 10 },
            initialDelay: { minutes: 3 },
            fn: async () => {
              const r = await sweepDeveloperRuns(runs, settings, store);
              logger.info(`ops-assistant: developer runs swept, ${r.runs} new with usage (${r.rows} rows)`);
            },
          });
        } else if (wf) {
          logger.warn('ops-assistant: assistantUsage.developerWorkflow needs the database and a github.com token in integrations.github');
        }
        const viewAll = config.getOptionalStringArray('assistantUsage.viewAllGroups') ?? ['backstage-admin'];
        const deps = { httpAuth, userInfo, logger, conversations, keepDays: days, usage };
        const router = express.Router();
        router.get('/usage', async (req, res) => {
          let viewer: string;
          let all: boolean;
          try {
            const info = await userInfo.getUserInfo(await httpAuth.credentials(req, { allow: ['user'] }));
            viewer = info.userEntityRef;
            all = mayUse(info.ownershipEntityRefs, viewAll);
          } catch {
            res.status(401).json({ error: 'Sign in to read what the assistants consume' });
            return;
          }
          if (!usage) {
            res.status(503).json({ error: 'What the assistants consume is not recorded (no database).' });
            return;
          }
          const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : currentMonth();
          try {
            const body = await usage.month(month, viewer, all);
            if (!body) res.status(400).json({ error: 'month is YYYY-MM' });
            else res.json(body);
          } catch (e) {
            logger.error(`ops-assistant: usage: ${(e as Error).message}`);
            res.status(500).json({ error: 'What the assistants consume could not be read' });
          }
        });
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
