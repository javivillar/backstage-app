import { createBackendModule, coreServices } from '@backstage/backend-plugin-api';
// Not from '/alpha': plugin-catalog-node 2.x exports it only from its main entry, and the alpha import is undefined
// (the backend then cannot start the catalog: the 503 on /catalog seen when this module was turned on).
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { KeycloakEntityProvider } from './entityProvider';

/**
 * Catalog module that syncs Keycloak realm users/groups into the catalog,
 * so what the keycloak:create-* scaffolder actions provision is browsable
 * (Phase 2 of the Keycloak identity-management work — Phase 1 was the
 * create-only scaffolder templates/actions).
 */
export const catalogKeycloakModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'keycloak-identity-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        if (!config.has('keycloakAdmin')) {
          logger.info(
            'keycloakAdmin config not set — skipping Keycloak catalog sync',
          );
          return;
        }

        const taskRunner = scheduler.createScheduledTaskRunner({
          frequency: { minutes: 30 },
          timeout: { minutes: 3 },
        });

        catalog.addEntityProvider(
          new KeycloakEntityProvider(config, logger, taskRunner),
        );

        logger.info('Keycloak identity EntityProvider registered');
      },
    });
  },
});
