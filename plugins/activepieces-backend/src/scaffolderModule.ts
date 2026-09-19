import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createActivepiecesFlowAction,
  createActivepiecesProjectAction,
  deleteActivepiecesFlowAction,
  deleteActivepiecesProjectAction,
  removeActivepiecesMemberAction,
  renameActivepiecesFlowAction,
  setActivepiecesMemberAction,
  updateActivepiecesProjectAction,
} from './activepieces-actions';

export const activepiecesScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'activepieces-actions',
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
          createActivepiecesProjectAction(options),
          updateActivepiecesProjectAction(options),
          deleteActivepiecesProjectAction(options),
          setActivepiecesMemberAction(options),
          removeActivepiecesMemberAction(options),
          createActivepiecesFlowAction(options),
          renameActivepiecesFlowAction(options),
          deleteActivepiecesFlowAction(options),
        );
      },
    });
  },
});
