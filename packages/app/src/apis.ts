import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  ScmAuth,
} from '@backstage/integration-react';
import {
  AnyApiFactory,
  configApiRef,
  createApiFactory,
  discoveryApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import {
  kubernetesApiRef,
  kubernetesAuthProvidersApiRef,
  KubernetesBackendClient,
  KubernetesAuthProviders,
} from '@backstage/plugin-kubernetes-react';
import {
  argoCDApiRef,
  ArgoCDApiClient,
} from '@roadiehq/backstage-plugin-argo-cd';
import { keycloakApis } from '@internal/plugin-keycloak';

export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: scmIntegrationsApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => ScmIntegrationsApi.fromConfig(configApi),
  }),
  ScmAuth.createDefaultApiFactory(),
  createApiFactory({
    api: kubernetesAuthProvidersApiRef,
    deps: {},
    factory: () => new KubernetesAuthProviders({
      microsoftAuthApi: undefined as any,
      googleAuthApi: undefined as any,
    }),
  }),
  createApiFactory({
    api: kubernetesApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      fetchApi: { id: 'core.fetch', T: {} as any },
      kubernetesAuthProvidersApi: kubernetesAuthProvidersApiRef,
    } as any,
    factory: ({ discoveryApi, fetchApi, kubernetesAuthProvidersApi }: any) =>
      new KubernetesBackendClient({ discoveryApi, fetchApi, kubernetesAuthProvidersApi }),
  }),
  createApiFactory({
    api: argoCDApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      identityApi: identityApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, identityApi, configApi }) =>
      new ArgoCDApiClient({
        discoveryApi,
        identityApi,
        backendBaseUrl: configApi.getString('backend.baseUrl'),
        searchInstances: true,
        useNamespacedApps: false,
      }),
  }),
  ...keycloakApis,
];
