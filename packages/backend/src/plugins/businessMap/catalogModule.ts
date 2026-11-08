import { createBackendModule } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { BusinessMapProcessor } from './kinds';

/** The catalog knows the kinds of the business map: validation and relations (kinds.ts). */
export const businessMapCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'business-map',
  register(reg) {
    reg.registerInit({
      deps: { catalog: catalogProcessingExtensionPoint },
      async init({ catalog }) {
        catalog.addProcessor(new BusinessMapProcessor());
      },
    });
  },
});
