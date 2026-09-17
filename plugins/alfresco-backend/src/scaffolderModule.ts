import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { createAlfrescoSiteAction, deleteAlfrescoSiteAction } from './alfresco-actions';

export const alfrescoScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'alfresco-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        userInfo: coreServices.userInfo,
        catalog: catalogServiceRef,
      },
      async init({ scaffolder, config, userInfo, catalog }) {
        scaffolder.addActions(
          createAlfrescoSiteAction({ config, userInfo, catalog }),
          deleteAlfrescoSiteAction({ config, userInfo, catalog }),
        );
      },
    });
  },
});
