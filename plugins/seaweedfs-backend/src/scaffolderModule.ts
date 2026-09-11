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
        database: coreServices.database,
      },
      async init({ scaffolder, config, userInfo, database }) {
        scaffolder.addActions(
          createSeaweedfsBucketAction({ config, userInfo, database }),
          createSeaweedfsDeleteBucketAction({ config, userInfo, database }),
          createSeaweedfsTableBucketAction({ config, userInfo, database }),
          createSeaweedfsDeleteTableBucketAction({ config, userInfo, database }),
          createSeaweedfsGroupAction({ config, userInfo, database }),
          createSeaweedfsDeleteGroupAction({ config, userInfo, database }),
          createSeaweedfsPolicyAction({ config, userInfo, database }),
          createSeaweedfsDeletePolicyAction({ config, userInfo, database }),
        );
      },
    });
  },
});
