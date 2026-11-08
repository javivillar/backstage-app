import type { HttpAuthService, LoggerService, RootConfigService, UserInfoService } from '@backstage/backend-plugin-api';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import express, { Router } from 'express';
import { mayAct } from '../clusterActions';
import { writers } from './exercisesModel';
import { InputError, previewOf, readImportInput } from './prepareImport';

/**
 *   POST /api/business-map/import/preview   the input of the action refresquito:business-model:preview (source, file
 *        as a data URL, fileName?, sheet?, namespace, owner?, mapping?, valueMapping?, keepFrom?, industry?, version?)
 *        → its outputs { counts, errors, warnings, changes }; writes nothing. The form field BusinessModelPreview of
 *        the template Import business model calls it, so the preview is in the form and an import with errors is
 *        stopped before it runs.
 *
 * Who may: the groups that may change the business map (business-architect, backstage-admin, console.actions.groups),
 * the same as the template.
 */

export type BusinessMapRouteDeps = {
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  config: RootConfigService;
  logger: LoggerService;
  catalog: CatalogService;
};

/** Who asks, and whether they may change the business map. */
export function whoAsks(deps: Pick<BusinessMapRouteDeps, 'httpAuth' | 'userInfo' | 'config'>) {
  const groups = writers(deps.config.getOptionalStringArray('console.actions.groups'));
  return async (req: express.Request) => {
    const credentials = await deps.httpAuth.credentials(req, { allow: ['user'] });
    const info = await deps.userInfo.getUserInfo(credentials);
    return { credentials, user: info.userEntityRef, may: mayAct(info.ownershipEntityRefs, groups), groups };
  };
}

/** The status of a failed request: 401 without a user, 400 for a bad body, else the given one. */
export function statusOf(e: unknown, otherwise: number): number {
  const name = (e as Error)?.name;
  if (name === 'AuthenticationError') return 401;
  if (name === 'NotAllowedError') return 403;
  return otherwise;
}

export function createPreviewRouter(deps: BusinessMapRouteDeps): Router {
  const who = whoAsks(deps);
  const router = Router();
  // the file comes inside the body as a data URL (an .xlsx of a few MB is a third bigger in base64)
  router.post('/import/preview', express.json({ limit: '25mb' }), async (req, res) => {
    try {
      const w = await who(req);
      if (!w.may) {
        res.status(403).json({ error: `Only ${w.groups.join(', ')} may import a business model.` });
        return;
      }
      const input = readImportInput(req.body);
      res.json(await previewOf(input, deps, w.credentials, w.user));
    } catch (e) {
      if (e instanceof InputError) {
        res.status(400).json({ error: e.message });
        return;
      }
      // the file cannot be read, a sheet or a model is not there, GitHub or the catalog failed: the field shows it
      const status = statusOf(e, 422);
      if (status === 422) deps.logger.warn(`business-map preview: ${(e as Error).message}`);
      res.status(status).json({ error: (e as Error).message });
    }
  });
  return router;
}
