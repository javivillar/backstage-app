import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { catalogKeycloakModule } from './catalogModule';

describe('catalogKeycloakModule', () => {
  // The bug that kept this module off: an extension point imported from '/alpha' was undefined, and the backend could
  // not start the catalog. Starting the module for real catches it.
  it('registers its entity provider on the catalog', async () => {
    const addEntityProvider = jest.fn();
    await startTestBackend({
      extensionPoints: [[catalogProcessingExtensionPoint, { addEntityProvider } as any]],
      features: [
        catalogKeycloakModule,
        mockServices.rootConfig.factory({
          data: { keycloakAdmin: { baseUrl: 'http://kc.invalid', realm: 'R', clientId: 'sa', clientSecret: 's' } },
        }),
      ],
    });
    expect(addEntityProvider).toHaveBeenCalledTimes(1);
    expect(addEntityProvider.mock.calls[0][0].getProviderName()).toBe('keycloak-identity-provider');
  });

  it('does nothing without keycloakAdmin', async () => {
    const addEntityProvider = jest.fn();
    await startTestBackend({
      extensionPoints: [[catalogProcessingExtensionPoint, { addEntityProvider } as any]],
      features: [catalogKeycloakModule, mockServices.rootConfig.factory({ data: {} })],
    });
    expect(addEntityProvider).not.toHaveBeenCalled();
  });
});
