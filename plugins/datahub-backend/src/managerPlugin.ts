import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Response, Router } from 'express';
import { DatahubError, DatahubSettings, datahubQuery, datahubSettings } from './datahubClient';
import { Caller, Forbidden, callerFrom, requireDatahubAccess } from './datahubAuthz';
import { RawEntity, Summary, isMissing, summarize } from './governance';
import { Q_DATASET, Q_DATA_FLOW, Q_DATA_PRODUCT, Q_IMPACT, Q_SEARCH } from './queries';
import { RawImpactResult, summarizeImpact } from './impact';
import { loadVocabulary } from './vocabulary';
import { isSoftDeleted } from './datahubRest';
import { ASSET_TYPES, AssetType, assetTypeOf } from './urn';

/**
 * Backend of the DataHub integration -- PHASE 1, READ ONLY
 * (BACKSTAGE-DATAHUB-DESIGN.md §10). Serves the entity card, the governance
 * tab and the /datahub catalog page.
 *
 * Every route: (1) 503 if not configured, (2) requireDatahubAccess() -- the
 * caller must be in a datahub-* Keycloak group or backstage-admin, (3) an
 * audit log line naming the user (DataHub's own logs only ever see the
 * service account, design §7.3). There is no write route and the client would
 * refuse a mutation anyway.
 *
 * No database of its own: the state lives in DataHub and in Git.
 */
export const datahubManagerPlugin = createBackendPlugin({
  pluginId: 'datahub-manager',
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
        const router = Router();
        router.use(express.json());

        class HttpError extends Error {
          constructor(
            message: string,
            readonly status: number,
          ) {
            super(message);
          }
        }

        type Handler = (req: Request, res: Response, ctx: { caller: Caller; settings: DatahubSettings }) => Promise<unknown>;

        // Wraps every route with configuration check, access gate, audit log
        // and uniform error mapping.
        const guarded =
          (name: string, handler: Handler) => async (req: Request, res: Response) => {
            try {
              const settings = datahubSettings(config);
              if (!settings) {
                res.status(503).json({ error: 'The DataHub integration is not configured (datahub.baseUrl / datahub.token).' });
                return;
              }
              const caller = await callerFrom(await httpAuth.credentials(req), userInfo);
              await requireDatahubAccess(config, caller, settings.accessGroups);
              logger.info(`datahub-manager ${name} user=${caller.entityRef} ${JSON.stringify(req.query)}`);
              res.json(await handler(req, res, { caller, settings }));
            } catch (e) {
              const err = e as Error;
              if (err instanceof Forbidden) {
                logger.warn(`datahub-manager ${name} denied: ${err.message}`);
                res.status(403).json({ error: err.message });
              } else if (err instanceof HttpError) {
                res.status(err.status).json({ error: err.message });
              } else {
                logger.error(`datahub-manager ${name} failed`, err);
                res.status(err instanceof DatahubError ? err.status : 500).json({ error: err.message });
              }
            }
          };

        const QUERY_BY_TYPE: Record<AssetType, { doc: string; key: string }> = {
          dataset: { doc: Q_DATASET, key: 'dataset' },
          dataProduct: { doc: Q_DATA_PRODUCT, key: 'dataProduct' },
          dataFlow: { doc: Q_DATA_FLOW, key: 'dataFlow' },
        };

        async function loadSummary(settings: DatahubSettings, urn: unknown): Promise<Summary> {
          const type = typeof urn === 'string' ? assetTypeOf(urn) : undefined;
          if (!type || typeof urn !== 'string') {
            throw new HttpError('urn must be a dataset, dataProduct or dataFlow URN', 400);
          }
          const { doc, key } = QUERY_BY_TYPE[type];
          const data = await datahubQuery<Record<string, RawEntity | null>>(settings, doc, { urn });
          const raw = data[key];
          if (!raw || isMissing(raw) || (await isSoftDeleted(settings, type, urn))) {
            throw new HttpError(`No such ${type} in DataHub: ${urn}`, 404);
          }
          return summarize(type, raw, settings.publicUrl, settings.governedThreshold);
        }

        // NOTE: the URN goes in the QUERY STRING (not the path as the design
        // sketched): URNs contain `/`, `(` and `,`, and encoded slashes in a
        // path segment are rewritten or rejected by some proxies.

        router.get('/assets/summary', guarded('GET /assets/summary', (req, _res, { settings }) => loadSummary(settings, req.query.urn)));

        router.get(
          '/assets/score',
          guarded('GET /assets/score', async (req, _res, { settings }) => {
            const s = await loadSummary(settings, req.query.urn);
            return { urn: s.urn, ...s.score };
          }),
        );

        // Phase 3: what is downstream of this asset (per DataHub lineage), and who to tell.
        router.get(
          '/impact',
          guarded('GET /impact', async (req, _res, { settings }) => {
            const urn = typeof req.query.urn === 'string' ? req.query.urn : '';
            const type = assetTypeOf(urn);
            if (!type) throw new HttpError('urn must be a dataset, dataProduct or dataFlow URN', 400);
            if (await isSoftDeleted(settings, type, urn)) throw new HttpError(`No such ${type} in DataHub: ${urn}`, 404);
            const data = await datahubQuery<{ searchAcrossLineage: RawImpactResult }>(settings, Q_IMPACT, { urn, count: 100 });
            return summarizeImpact(urn, data.searchAcrossLineage);
          }),
        );

        router.get(
          '/search',
          guarded('GET /search', async (req, _res, { settings }) => {
            const q = typeof req.query.query === 'string' && req.query.query.trim() ? req.query.query.trim().slice(0, 200) : '*';
            const wanted = typeof req.query.type === 'string' ? req.query.type : undefined;
            if (wanted && !ASSET_TYPES.includes(wanted as AssetType)) {
              throw new HttpError(`type must be one of ${ASSET_TYPES.join(', ')}`, 400);
            }
            const types = ((wanted ? [wanted] : ASSET_TYPES) as AssetType[]).map(
              t => ({ dataset: 'DATASET', dataProduct: 'DATA_PRODUCT', dataFlow: 'DATA_FLOW' })[t],
            );
            const start = Math.max(0, parseInt(String(req.query.start ?? '0'), 10) || 0);
            const count = Math.min(50, Math.max(1, parseInt(String(req.query.count ?? '25'), 10) || 25));
            const data = await datahubQuery<{
              searchAcrossEntities: { total: number; searchResults: Array<{ entity: RawEntity & { type: string } }> };
            }>(settings, Q_SEARCH, { input: { query: q, start, count, types } });
            const typeOf: Record<string, AssetType> = { DATASET: 'dataset', DATA_PRODUCT: 'dataProduct', DATA_FLOW: 'dataFlow' };
            let items = data.searchAcrossEntities.searchResults.map(r =>
              summarize(typeOf[r.entity.type], r.entity, settings.publicUrl, settings.governedThreshold),
            );
            // "Governance gaps" view. Filters the fetched PAGE (DataHub cannot
            // search on a score we compute), so `total` stays the unfiltered count.
            if (req.query.gaps === 'true') items = items.filter(i => !i.score.governed);
            return { total: data.searchAcrossEntities.total, start, count, items, threshold: settings.governedThreshold };
          }),
        );

        let vocabCache: { at: number; value: unknown } | undefined;
        router.get(
          '/vocabulary',
          guarded('GET /vocabulary', async (_req, _res, { settings }) => {
            if (vocabCache && Date.now() - vocabCache.at < 60_000) return vocabCache.value;
            const value = await loadVocabulary(settings);
            vocabCache = { at: Date.now(), value };
            return value;
          }),
        );

        httpRouter.use(router);
      },
    });
  },
});
