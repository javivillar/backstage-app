import { LoggerService, RootConfigService } from '@backstage/backend-plugin-api';
import { DEFAULT_PROJECTS, ImageCatalogService, ImageCatalogSettings } from './imageCatalog';
import { ImageDetailService } from './imageDetail';
import { RegistryClient } from './registry';

/**
 * sbom.imageCatalog (app-config):
 *   harborUrl: https://harbor.iaas.refresquito.io     # Harbor of the zone: API, UI and the published catalog
 *   projects: [common, framework-python, framework-spring]   # optional (this is the default)
 * Harbor is read anonymously (the projects are public); its certificate must be trusted (NODE_EXTRA_CA_CERTS).
 */
export function imageCatalogSettings(config: RootConfigService, logger: LoggerService): ImageCatalogSettings | undefined {
  const c = config.getOptionalConfig('sbom.imageCatalog');
  const harborUrl = c?.getOptionalString('harborUrl');
  if (!harborUrl) return undefined;
  try {
    if (!new URL(harborUrl).host) throw new Error('no host');
  } catch {
    logger.warn(`sbom.imageCatalog.harborUrl is not a URL: ${harborUrl}`);
    return undefined;
  }
  return { harborUrl, projects: c?.getOptionalStringArray('projects') ?? DEFAULT_PROJECTS };
}

export function imageCatalogFromConfig(config: RootConfigService, logger: LoggerService): ImageCatalogService | undefined {
  const s = imageCatalogSettings(config, logger);
  return s && new ImageCatalogService(s, new RegistryClient(() => undefined));
}

/** The detail of one image (tab Image of a container-image entity), same settings. */
export function imageDetailFromConfig(config: RootConfigService, logger: LoggerService): ImageDetailService | undefined {
  const s = imageCatalogSettings(config, logger);
  return s && new ImageDetailService(s.harborUrl, s.projects, new RegistryClient(() => undefined));
}
