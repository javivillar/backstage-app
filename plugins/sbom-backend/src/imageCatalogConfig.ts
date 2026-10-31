import { LoggerService, RootConfigService } from '@backstage/backend-plugin-api';
import { DEFAULT_PROJECTS, ImageCatalogService } from './imageCatalog';
import { RegistryClient } from './registry';

/**
 * sbom.imageCatalog (app-config):
 *   harborUrl: https://harbor.iaas.refresquito.io     # Harbor of the zone: API, UI and the published catalog
 *   projects: [common, framework-python, framework-spring]   # optional (this is the default)
 * Harbor is read anonymously (the projects are public); its certificate must be trusted (NODE_EXTRA_CA_CERTS).
 */
export function imageCatalogFromConfig(config: RootConfigService, logger: LoggerService): ImageCatalogService | undefined {
  const c = config.getOptionalConfig('sbom.imageCatalog');
  const harborUrl = c?.getOptionalString('harborUrl');
  if (!harborUrl) return undefined;
  try {
    new URL(harborUrl);
  } catch {
    logger.warn(`sbom.imageCatalog.harborUrl is not a URL: ${harborUrl}`);
    return undefined;
  }
  const projects = c?.getOptionalStringArray('projects') ?? DEFAULT_PROJECTS;
  return new ImageCatalogService({ harborUrl, projects }, new RegistryClient(() => undefined));
}
