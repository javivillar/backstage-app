import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createSeaweedfsBucketAction,
  createSeaweedfsDeleteBucketAction,
  createSeaweedfsTableBucketAction,
  createSeaweedfsDeleteTableBucketAction,
  createSeaweedfsGroupAction,
  createSeaweedfsDeleteGroupAction,
  createSeaweedfsPolicyAction,
  createSeaweedfsDeletePolicyAction,
} from './seaweedfs-actions';

export const seaweedfsScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'seaweedfs-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        userInfo: coreServices.userInfo,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
      },
      async init({ scaffolder, config, userInfo, auth, discovery }) {
        scaffolder.addActions(
          createSeaweedfsBucketAction({ config, userInfo, auth, discovery }),
          createSeaweedfsDeleteBucketAction({ config, userInfo, auth, discovery }),
          createSeaweedfsTableBucketAction({ config, userInfo, auth, discovery }),
          createSeaweedfsDeleteTableBucketAction({ config, userInfo, auth, discovery }),
          createSeaweedfsGroupAction({ config, userInfo, auth, discovery }),
          createSeaweedfsDeleteGroupAction({ config, userInfo, auth, discovery }),
          createSeaweedfsPolicyAction({ config, userInfo, auth, discovery }),
          createSeaweedfsDeletePolicyAction({ config, userInfo, auth, discovery }),
        );
      },
    });
  },
});
