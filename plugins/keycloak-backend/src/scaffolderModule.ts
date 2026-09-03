import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createKeycloakUserAction,
  createKeycloakGroupAction,
  createKeycloakClientAction,
  createKeycloakUpdateUserAction,
  createKeycloakDeleteUserAction,
  createKeycloakUpdateGroupAction,
  createKeycloakDeleteGroupAction,
  createKeycloakUpdateClientAction,
  createKeycloakDeleteClientAction,
} from './actions';

export const keycloakScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'keycloak-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        userInfo: coreServices.userInfo,
      },
      async init({ scaffolder, config, userInfo }) {
        scaffolder.addActions(
          createKeycloakUserAction({ config, userInfo }),
          createKeycloakGroupAction({ config, userInfo }),
          createKeycloakClientAction({ config, userInfo }),
          createKeycloakUpdateUserAction({ config, userInfo }),
          createKeycloakDeleteUserAction({ config, userInfo }),
          createKeycloakUpdateGroupAction({ config, userInfo }),
          createKeycloakDeleteGroupAction({ config, userInfo }),
          createKeycloakUpdateClientAction({ config, userInfo }),
          createKeycloakDeleteClientAction({ config, userInfo }),
        );
      },
    });
  },
});
