import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { BusinessMapProcessor } from './kinds';
import { BusinessMapEntityProvider, PROVIDER_NAME, providerConfig } from './provider';

/**
 * The catalog knows the kinds of the business map: validation and relations (kinds.ts), and the entity provider that
 * reads them from refresquito-services (provider.ts: one GraphQL query every businessMap.provider.frequency minutes,
 * 10 by default; businessMap.provider.enabled false turns it off). Provider entities are not checked by the catalog
 * rules of a Location (those apply to what a Location emits); the processor still validates them.
 */
export const businessMapCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'business-map',
  register(reg) {
    reg.registerInit({
      deps: { catalog: catalogProcessingExtensionPoint, config: coreServices.rootConfig, logger: coreServices.logger, scheduler: coreServices.scheduler },
      async init({ catalog, config, logger, scheduler }) {
        catalog.addProcessor(new BusinessMapProcessor());
        const c = providerConfig(config);
        if (!c.enabled) {
          logger.info(`${PROVIDER_NAME} provider: off (businessMap.provider.enabled false)`);
          return;
        }
        const runner = scheduler.createScheduledTaskRunner({ frequency: { minutes: c.frequency }, timeout: { minutes: 3 }, initialDelay: { seconds: 30 } });
        catalog.addEntityProvider(new BusinessMapEntityProvider({ repo: c.repo, branch: c.branch, token: c.token }, logger, runner));
      },
    });
  },
});
