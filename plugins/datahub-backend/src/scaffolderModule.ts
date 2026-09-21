import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  checkImpactAction,
  deprecateAssetAction,
  registerAssetAction,
  registerDataProductAction,
  requestVocabularyAction,
  writeCatalogInfoAction,
} from './datahub-actions';

/** The DataHub write path (F2). Inert unless `datahub.writes.enabled: true` (see datahubAuthz.assertWritesEnabled). */
export const datahubScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'datahub-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        userInfo: coreServices.userInfo,
      },
      async init({ scaffolder, config, userInfo }) {
        const options = { config, userInfo };
        scaffolder.addActions(
          registerDataProductAction(options),
          registerAssetAction(options),
          deprecateAssetAction(options),
          checkImpactAction(options),
          requestVocabularyAction(options),
          writeCatalogInfoAction(options),
        );
      },
    });
  },
});
