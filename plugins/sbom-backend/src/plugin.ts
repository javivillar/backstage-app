import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Response, Router } from 'express';
import { SbomSummary, summarize } from './cyclonedx';
import { evaluateLicenses, policyFrom } from './licenses';
import { QualityReport, parseQuality } from './quality';
import {
  FoundSbom,
  QUALITY_ARTIFACT_TYPE,
  RegistryClient,
  RegistryError,
  credentialsFromDockerConfig,
  findAttached,
  findSbom,
  parseImageRef,
} from './registry';
import { FoundReleaseSbom, findReleaseSbom } from './releases';
import { ImageScan, findImageScan } from './vulnerabilities';
import { imageCatalogFromConfig, imageDetailFromConfig } from './imageCatalogConfig';

/**
 * Backend of the SBOM tab: the CycloneDX SBOM that the CI attached to an image in the registry (oras attach), for
 * the images a component says it runs (annotation refresquito.io/sbom-images, written by the catalog of
 * refresquito-services with the tag deployed). Read only.
 *
 *   GET /api/sbom/image?ref=ghcr.io/owner/app-api:<tag>       its summary (components, ecosystems, licenses)
 *   GET /api/sbom/image/raw?ref=...                           the CycloneDX document as it is
 *   GET /api/sbom/release?ref=owner/repo@tag                   the same for the SBOM file of a release of GitHub
 *   GET /api/sbom/release/raw?ref=...                          (annotation refresquito.io/sbom-releases: a library)
 *   GET /api/sbom/vulnerabilities?ref=<image>                  its vulnerabilities, from Wazuh's daily image scan
 *   GET /api/sbom/quality?ref=<image>                          the quality report the CI attached next to the SBOM
 *                                                              (tests, coverage, linters; quality.json of the app)
 *   GET /api/sbom/kubebench                                    the CIS Kubernetes Benchmark of the cluster (kube-bench): the
 *                                                              newest run of each node and its failures (wazuh-oneke >= 0.25.10)
 *   GET /api/sbom/compliance                                   the CIS compliance of the nodes (operating system): the
 *                                                              newest SCA scan of each node as Wazuh scored it with the
 *                                                              scope of the platform (wazuh-oneke >= 0.25.0, Part M)
 *   GET /api/sbom/images                                       the image catalog: the images of Harbor a system may use
 *                                                              (imageCatalog.ts; the published catalog + Harbor's API)
 *   GET /api/sbom/images/detail?repository=common/x&tag=1.0    one image: findings (covered by the VEX or not), SBOM,
 *                                                              provenance, signature, history (imageDetail.ts)
 *
 * Config (app-config):
 *   sbom:
 *     allowedImages: ['ghcr.io/javivillar/']   # only images under these prefixes are read (default: none)
 *     dockerConfig: ${GHCR_DOCKERCONFIG}         # a Docker config JSON with the pull credentials of the registry
 *     allowedReleases: ['javivillar/']           # only releases of repositories under these prefixes
 *     vulnerabilitiesUrl: http://wazuh-oneke-security-exporter.<ns>:9950   # the security exporter of wazuh-oneke
 *                                                  # (its last image scan); empty: the tab shows no vulnerabilities
 *     licenses:                                    # the license policy (licenses.ts; defaults: DEFAULT_POLICY)
 *       denied: ['AGPL-*', 'GPL-*', 'SSPL-*']      # SPDX ids, * = any version; applied to the dependencies of the
 *       ecosystems: [pypi, npm, maven, ...]        # application (not to the OS packages of the image)
 *       ignore: ['pkg:nuget/Simple%20Launcher@']   # purl prefixes that are not dependencies
 *     imageCatalog:                                # page Images + entities (imageCatalogConfig.ts); empty: off
 *       harborUrl: https://harbor.iaas.refresquito.io
 * The releases are read with the token of integrations.github (github.com).
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
        const allowedReleases = settings?.getOptionalStringArray('allowedReleases') ?? [];
        const licensePolicy = policyFrom(settings?.getOptionalConfig('licenses'));
        // the summary of an SBOM, with the license policy applied to its components
        const summaryOf = (bom: unknown): SbomSummary => {
          const summary = summarize(bom);
          return { ...summary, licensePolicy: evaluateLicenses(summary.components, licensePolicy) };
        };
        const vulnerabilitiesUrl = settings?.getOptionalString('vulnerabilitiesUrl') ?? '';
        const githubToken = (config.getOptionalConfigArray('integrations.github') ?? [])
          .find(c => (c.getOptionalString('host') ?? 'github.com') === 'github.com')
          ?.getOptionalString('token');
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
          const entry = { at: Date.now(), found, summary: found ? summaryOf(found.bom) : undefined };
          cache.set(ref, entry);
          if (cache.size > 200) cache.delete(cache.keys().next().value as string);
          return entry;
        };

        // a release is immutable too: the same cache, by its own key
        const releases = new Map<string, { at: number; found: FoundReleaseSbom | undefined; summary?: SbomSummary }>();
        const lookupRelease = async (ref: string) => {
          const hit = releases.get(ref);
          if (hit && Date.now() - hit.at < TTL) return hit;
          const found = await findReleaseSbom(ref, githubToken);
          const entry = { at: Date.now(), found, summary: found ? summaryOf(found.bom) : undefined };
          releases.set(ref, entry);
          if (releases.size > 200) releases.delete(releases.keys().next().value as string);
          return entry;
        };
        // the quality report of an image is of its commit: immutable too
        const reports = new Map<string, { at: number; found?: { digest: string; created?: string; revision?: string }; report?: QualityReport }>();
        const lookupQuality = async (ref: string) => {
          const hit = reports.get(ref);
          if (hit && Date.now() - hit.at < TTL) return hit;
          const found = await findAttached(client, ref, QUALITY_ARTIFACT_TYPE, 1024 * 1024);
          const entry = {
            at: Date.now(),
            found: found && { digest: found.attachedDigest, created: found.created, revision: found.revision },
            report: found ? parseQuality(found.content) : undefined,
          };
          reports.set(ref, entry);
          if (reports.size > 200) reports.delete(reports.keys().next().value as string);
          return entry;
        };

        // the image scan runs once a day: its answer is kept a few minutes (the digest of a tag of a commit is stable)
        const scans = new Map<string, { at: number; digest: string; scan: ImageScan | undefined }>();
        const SCAN_TTL = 5 * 60 * 1000;
        const lookupScan = async (ref: string) => {
          const hit = scans.get(ref);
          if (hit && Date.now() - hit.at < SCAN_TTL) return hit;
          const digest = (await lookup(ref)).found?.digest ?? (await client.resolve(parseImageRef(ref)));
          const entry = { at: Date.now(), digest, scan: await findImageScan(vulnerabilitiesUrl, digest, ref) };
          scans.set(ref, entry);
          if (scans.size > 200) scans.delete(scans.keys().next().value as string);
          return entry;
        };

        // the agents scan once a day and the exporter reads the indexer every 5 minutes: kept 2 minutes
        let compliance: { at: number; body: unknown } | undefined;
        const COMPLIANCE_TTL = 2 * 60 * 1000;
        const lookupCompliance = async () => {
          if (compliance && Date.now() - compliance.at < COMPLIANCE_TTL) return compliance.body;
          const res = await fetch(`${vulnerabilitiesUrl.replace(/\/+$/, '')}/compliance`, { signal: AbortSignal.timeout(20000) });
          const body = await res.json().catch(() => ({}));
          if (res.status === 404) return { configured: false, ...body };
          if (!res.ok) throw new RegistryError(`Wazuh: ${(body as { error?: string }).error ?? res.statusText}`, 502);
          compliance = { at: Date.now(), body: { configured: true, ...body } };
          return compliance.body;
        };

        // the CIS Kubernetes Benchmark (kube-bench runs daily): same cache as the compliance of the nodes
        let kubebench: { at: number; body: unknown } | undefined;
        const lookupKubebench = async () => {
          if (kubebench && Date.now() - kubebench.at < COMPLIANCE_TTL) return kubebench.body;
          const res = await fetch(`${vulnerabilitiesUrl.replace(/\/+$/, '')}/kubebench`, { signal: AbortSignal.timeout(20000) });
          const body = await res.json().catch(() => ({}));
          if (res.status === 404) return { configured: false, nodes: [] };
          if (!res.ok) throw new RegistryError(`Wazuh: ${(body as { error?: string }).error ?? res.statusText}`, 502);
          kubebench = { at: Date.now(), body: { configured: true, ...body } };
          return kubebench.body;
        };

        const releaseOf = (req: Request): string => {
          const ref = String(req.query.ref ?? '').trim();
          if (!ref) throw new RegistryError('Missing ?ref=<owner/repo@tag>', 400);
          if (!allowedReleases.some(prefix => ref.startsWith(prefix))) {
            throw new RegistryError(`This Backstage does not read SBOMs of ${ref} (sbom.allowedReleases)`, 403);
          }
          return ref;
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
            // users, and this backend itself (the facts of the scorecard, plugin tech-insights)
            await httpAuth.credentials(req, { allow: ['user', 'service'] });
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
        router.get(
          '/release',
          guarded('release', async (req, res) => {
            const ref = releaseOf(req);
            const { found, summary } = await lookupRelease(ref);
            res.json(
              found
                ? { release: ref, url: found.url, asset: found.asset, created: found.published, summary }
                : { release: ref, summary: null },
            );
          }),
        );
        router.get(
          '/release/raw',
          guarded('release-raw', async (req, res) => {
            const ref = releaseOf(req);
            const { found } = await lookupRelease(ref);
            if (!found) throw new RegistryError(`The release ${ref} has no SBOM file`, 404);
            res.setHeader('Content-Disposition', `attachment; filename="${found.asset}"`);
            res.type('application/vnd.cyclonedx+json').send(JSON.stringify(found.bom, null, 2));
          }),
        );
        router.get(
          '/vulnerabilities',
          guarded('vulnerabilities', async (req, res) => {
            const ref = imageOf(req);
            if (!vulnerabilitiesUrl) {
              res.json({ image: ref, configured: false, scan: null });
              return;
            }
            let entry;
            try {
              entry = await lookupScan(ref);
            } catch (e) {
              if (e instanceof RegistryError) throw e;
              throw new RegistryError(`Wazuh's image scan could not be read: ${(e as Error).message}`, 502);
            }
            res.json({ image: ref, configured: true, digest: entry.digest, scan: entry.scan ?? null });
          }),
        );
        router.get(
          '/quality',
          guarded('quality', async (req, res) => {
            const ref = imageOf(req);
            const { found, report } = await lookupQuality(ref);
            res.json({ image: ref, attached: found ?? null, report: report ?? null });
          }),
        );
        router.get(
          '/compliance',
          guarded('compliance', async (_req, res) => {
            if (!vulnerabilitiesUrl) {
              res.json({ configured: false, nodes: [] });
              return;
            }
            try {
              res.json(await lookupCompliance());
            } catch (e) {
              if (e instanceof RegistryError) throw e;
              throw new RegistryError(`Wazuh's CIS compliance could not be read: ${(e as Error).message}`, 502);
            }
          }),
        );
        router.get(
          '/kubebench',
          guarded('kubebench', async (_req, res) => {
            if (!vulnerabilitiesUrl) {
              res.json({ configured: false, nodes: [] });
              return;
            }
            try {
              res.json(await lookupKubebench());
            } catch (e) {
              if (e instanceof RegistryError) throw e;
              throw new RegistryError(`Wazuh's CIS Kubernetes Benchmark could not be read: ${(e as Error).message}`, 502);
            }
          }),
        );
        const imageCatalog = imageCatalogFromConfig(config, logger);
        router.get(
          '/images',
          guarded('images', async (_req, res) => {
            if (!imageCatalog) {
              res.json({ configured: false, categories: {}, images: [], errors: [] });
              return;
            }
            res.json(await imageCatalog.view());
          }),
        );
        const imageDetail = imageDetailFromConfig(config, logger);
        router.get(
          '/images/detail',
          guarded('image-detail', async (req, res) => {
            if (!imageDetail) throw new RegistryError('The image catalog is not configured (sbom.imageCatalog.harborUrl)', 404);
            const repository = typeof req.query.repository === 'string' ? req.query.repository : '';
            const tag = typeof req.query.tag === 'string' ? req.query.tag : '';
            res.json(await imageDetail.detail(repository, tag));
          }),
        );
        router.get('/health', (_req, res) => {
          res.json({ status: 'ok', allowedImages: allowed, allowedReleases, credentials: !!dockerConfig, github: !!githubToken, vulnerabilities: !!vulnerabilitiesUrl, imageCatalog: !!imageCatalog });
        });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
      },
    });
  },
});
