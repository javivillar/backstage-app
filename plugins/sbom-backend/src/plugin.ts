import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Response, Router } from 'express';
import { SbomSummary, summarize } from './cyclonedx';
import { FoundSbom, RegistryClient, RegistryError, credentialsFromDockerConfig, findSbom } from './registry';

/**
 * Backend of the SBOM tab: the CycloneDX SBOM that the CI attached to an image in the registry (oras attach), for
 * the images a component says it runs (annotation refresquito.io/sbom-images, written by the catalog of
 * refresquito-services with the tag deployed). Read only.
 *
 *   GET /api/sbom/image?ref=ghcr.io/owner/app-api:<tag>       its summary (components, ecosystems, licenses)
 *   GET /api/sbom/image/raw?ref=...                           the CycloneDX document as it is
 *
 * Config (app-config):
 *   sbom:
 *     allowedImages: ['ghcr.io/javivillar/']   # only images under these prefixes are read (default: none)
 *     dockerConfig: ${GHCR_DOCKERCONFIG}         # a Docker config JSON with the pull credentials of the registry
 */
export const sbomPlugin = createBackendPlugin({
  pluginId: 'sbom',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, config, logger }) {
        const settings = config.getOptionalConfig('sbom');
        const allowed = settings?.getOptionalStringArray('allowedImages') ?? [];
        const dockerConfig = settings?.getOptionalString('dockerConfig');
        const client = new RegistryClient(host => {
          try {
            return credentialsFromDockerConfig(dockerConfig, host);
          } catch {
            logger.warn('sbom: sbom.dockerConfig is not a Docker config JSON; reading without credentials');
            return undefined;
          }
        });

        // an image tag of the platform is a commit: what it points at does not change, so its SBOM is kept a while
        const cache = new Map<string, { at: number; found: FoundSbom | undefined; summary?: SbomSummary }>();
        const TTL = 15 * 60 * 1000;
        const lookup = async (ref: string) => {
          const hit = cache.get(ref);
          if (hit && Date.now() - hit.at < TTL) return hit;
          const found = await findSbom(client, ref);
          const entry = { at: Date.now(), found, summary: found ? summarize(found.bom) : undefined };
          cache.set(ref, entry);
          if (cache.size > 200) cache.delete(cache.keys().next().value as string);
          return entry;
        };

        const imageOf = (req: Request): string => {
          const ref = String(req.query.ref ?? '').trim();
          if (!ref) throw new RegistryError('Missing ?ref=<image>', 400);
          if (!allowed.some(prefix => ref.startsWith(prefix))) {
            throw new RegistryError(`This Backstage does not read SBOMs of ${ref} (sbom.allowedImages)`, 403);
          }
          return ref;
        };

        const guarded = (name: string, handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            await handler(req, res);
          } catch (e) {
            const err = e as Error & { status?: number; name?: string };
            if (err.name === 'AuthenticationError' || err.name === 'NotAllowedError') {
              res.status(401).json({ error: 'Sign in to read SBOMs' });
            } else if (err instanceof RegistryError) {
              res.status(err.status).json({ error: err.message });
            } else {
              logger.error(`sbom ${name} failed`, err);
              res.status(500).json({ error: err.message });
            }
          }
        };

        const router = Router();
        router.use(express.json());
        router.get(
          '/image',
          guarded('image', async (req, res) => {
            const ref = imageOf(req);
            const { found, summary } = await lookup(ref);
            res.json(
              found
                ? { image: ref, digest: found.digest, sbomDigest: found.sbomDigest, created: found.created, revision: found.revision, summary }
                : { image: ref, summary: null },
            );
          }),
        );
        router.get(
          '/image/raw',
          guarded('raw', async (req, res) => {
            const ref = imageOf(req);
            const { found } = await lookup(ref);
            if (!found) throw new RegistryError(`${ref} has no SBOM attached`, 404);
            const file = `${ref.split('/').pop()!.replace(/[:@]/g, '-')}.cdx.json`;
            res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
            res.type('application/vnd.cyclonedx+json').send(JSON.stringify(found.bom, null, 2));
          }),
        );
        router.get('/health', (_req, res) => {
          res.json({ status: 'ok', allowedImages: allowed, credentials: !!dockerConfig });
        });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
      },
    });
  },
});
