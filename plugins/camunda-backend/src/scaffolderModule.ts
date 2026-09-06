import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createCamundaDeleteProcessAction,
  createCamundaProvisionProcessAction,
  createCamundaUpdateProcessAction,
} from './camunda-actions';

export const camundaScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'camunda-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        userInfo: coreServices.userInfo,
      },
      async init({ scaffolder, config, userInfo }) {
        scaffolder.addActions(
          createCamundaProvisionProcessAction({ config, userInfo }),
          createCamundaUpdateProcessAction({ config, userInfo }),
          createCamundaDeleteProcessAction({ config, userInfo }),
        );
      },
    });
  },
});
