import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createSupersetConnectionAction,
  createSupersetUpdateConnectionAction,
  createSupersetDatasetAction,
  createSupersetUpdateDatasetAction,
  createSupersetProvisionChartAction,
  createSupersetProvisionDashboardAction,
} from './superset-actions';

export const supersetScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'superset-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        userInfo: coreServices.userInfo,
      },
      async init({ scaffolder, config, userInfo }) {
        scaffolder.addActions(
          createSupersetConnectionAction({ config, userInfo }),
          createSupersetUpdateConnectionAction({ config, userInfo }),
          createSupersetDatasetAction({ config, userInfo }),
          createSupersetUpdateDatasetAction({ config, userInfo }),
          createSupersetProvisionChartAction({ config, userInfo }),
          createSupersetProvisionDashboardAction({ config, userInfo }),
        );
      },
    });
  },
});
