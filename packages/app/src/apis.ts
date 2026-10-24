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
  errorApiRef,
  fetchApiRef,
  identityApiRef,
  storageApiRef,
} from '@backstage/core-plugin-api';
import { UserSettingsStorage } from '@backstage/plugin-user-settings';
import { VisitsStorageApi, visitsApiRef } from '@backstage/plugin-home';
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
import { techRadarApiRef } from '@backstage-community/plugin-tech-radar';
import { ConfigTechRadarApi } from './techRadar';

export const apis: AnyApiFactory[] = [
  // the settings of each user live in the database (user-settings backend), not in the browser:
  // the layout of their home, their starred entities, follow them to any browser
  createApiFactory({
    api: storageApiRef,
    deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef, errorApi: errorApiRef, identityApi: identityApiRef },
    factory: deps => UserSettingsStorage.create(deps),
  }),
  // the pages each user visits, for the widgets "Recently visited" and "Top visited" of the home
  createApiFactory({
    api: visitsApiRef,
    deps: { storageApi: storageApiRef, identityApi: identityApiRef },
    factory: ({ storageApi, identityApi }) => VisitsStorageApi.create({ storageApi, identityApi }),
  }),
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
  createApiFactory({
    api: techRadarApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => new ConfigTechRadarApi(configApi),
  }),
  ...keycloakApis,
];
