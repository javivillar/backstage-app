import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Request, Response, Router } from 'express';
import { continuitySettings } from './config';
import { ProfilesUnavailableError } from './profiles';
import { ContinuityService } from './service';

/**
 * The Continuity portal (page /continuity): digital continuity of the platform, read only. Whether what each
 * service keeps can be found, opened, understood and held valid for decades (different from DR): its records and
 * how they are exported, the trust anchors that make them valid, the exit plan. The profiles are files of the chart
 * continuity-oneke (refresquito-services), mounted here as the ConfigMap continuity-profiles.
 *
 *   GET /api/continuity/summary            every profile with its state, the trust anchors (live expiry when the
 *                                          platform CA bundle or Keycloak says it), what needs attention, counts
 *   GET /api/continuity/profiles/:service  one profile with its state and its trust anchors
 *
 * Config: continuity.profilesDir (required, else 503), continuity.trustDir (optional), keycloakAdmin.* (optional).
 */
export const continuityPlugin = createBackendPlugin({
  pluginId: 'continuity',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, config, logger }) {
        const settings = continuitySettings(config, logger);
        const service = settings && new ContinuityService(settings);

        const signedIn = async (req: Request, res: Response) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            return true;
          } catch {
            res.status(401).json({ error: 'Sign in to read the continuity profiles' });
            return false;
          }
        };
        const failed = (res: Response, e: unknown) => {
          if (e instanceof ProfilesUnavailableError) {
            res.status(503).json({ error: e.message });
          } else {
            logger.warn(`continuity: ${(e as Error).message}`);
            res.status(500).json({ error: (e as Error).message });
          }
        };
        const notConfigured = (res: Response) =>
          res.status(503).json({ error: 'The Continuity portal is not configured: continuity.profilesDir is not set (chart cnoe-oneke, continuity-oneke installed)' });

        const router = Router();
        router.get('/summary', async (req, res) => {
          if (!(await signedIn(req, res))) return;
          if (!service) {
            notConfigured(res);
            return;
          }
          try {
            res.json(await service.summary());
          } catch (e) {
            failed(res, e);
          }
        });
        router.get('/profiles/:service', async (req, res) => {
          if (!(await signedIn(req, res))) return;
          if (!service) {
            notConfigured(res);
            return;
          }
          try {
            const p = await service.profile(req.params.service);
            if (p) res.json(p);
            else res.status(404).json({ error: `No continuity profile for ${req.params.service}` });
          } catch (e) {
            failed(res, e);
          }
        });
        httpRouter.use(router);
      },
    });
  },
});
