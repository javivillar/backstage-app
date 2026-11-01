
import { Navigate, Route } from 'react-router-dom';
import { apiDocsPlugin } from '@backstage/plugin-api-docs';
import {
  CatalogEntityPage,
  CatalogIndexPage,
  catalogPlugin,
} from '@backstage/plugin-catalog';
import {
  CatalogImportPage,
  catalogImportPlugin,
} from '@backstage/plugin-catalog-import';
import { ScaffolderPage, scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { CustomScaffolderPage } from './components/scaffolder/CustomScaffolderPage';
import { orgPlugin } from '@backstage/plugin-org';
import { SearchPage } from '@backstage/plugin-search';
import { TechRadarPage } from '@backstage-community/plugin-tech-radar';
import {
  TechDocsIndexPage,
  techdocsPlugin,
  TechDocsReaderPage,
} from '@backstage/plugin-techdocs';
import { TechDocsAddons } from '@backstage/plugin-techdocs-react';
import { ReportIssue } from '@backstage/plugin-techdocs-module-addons-contrib';
import { UserSettingsPage } from '@backstage/plugin-user-settings';
import { apis } from './apis';
import { consoleEntityPage, entityPage } from './components/catalog/EntityPage';
import { searchPage } from './components/search/SearchPage';
import { Root } from './components/Root';
import {
  AlertDisplay,
  OAuthRequestDialog,
  SignInPage,
} from '@backstage/core-components';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import { keycloakOIDCAuthApiRef, KeycloakManagerPage } from '@internal/plugin-keycloak';
import { SupersetManagerPage } from '@internal/plugin-superset';
import { CamundaManagerPage } from '@internal/plugin-camunda';
import { SeaweedfsManagerPage } from '@internal/plugin-seaweedfs';
import { AlfrescoManagerPage } from '@internal/plugin-alfresco';
import { ActivepiecesManagerPage } from '@internal/plugin-activepieces';
import { DatahubCatalogPage } from '@internal/plugin-datahub';
import { GraviteeManagerPage } from '@internal/plugin-gravitee';
import { createApp } from '@backstage/app-defaults';
import { AppRouter, FlatRoutes } from '@backstage/core-app-api';
import { CatalogGraphPage } from '@backstage/plugin-catalog-graph';
import { RequirePermission } from '@backstage/plugin-permission-react';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { cnoeVibrantLightAppTheme, cnoeVibrantDarkAppTheme } from './theme';
import { Homepage } from './components/home/Homepage';
import { LogoInHeader } from './components/signin/LogoInHeader';
import { VisitListener } from '@backstage/plugin-home';
import { CustomApiExplorerPage } from './components/api/ApiExplorerPage';
import { TopologyPage } from './components/topology/TopologyPage';
import { NodesCompliancePage } from './components/compliance/NodesCompliancePage';
import { ImagesPage } from './components/images/ImagesPage';
import { CostsPage } from './components/cost/CostsPage';
import { OpsAssistantPage } from './components/opsassistant/OpsAssistantPage';
import { SecAssistantPage } from './components/opsassistant/SecAssistantPage';
import { FunctionalAssistantPage } from './components/opsassistant/FunctionalAssistantPage';
import { ArchitectAssistantPage } from './components/opsassistant/ArchitectAssistantPage';
import { DeveloperAssistantPage } from './components/opsassistant/DeveloperAssistantPage';
import { AssistantPage } from './components/opsassistant/AssistantPage';
import { CONSOLE_ASSISTANTS } from './components/opsassistant/consoleAssistants';
import { ConsoleAssistantsTeam } from './components/opsassistant/ConsoleAssistantsTeam';
import { TechInsightsScorecardPage } from '@backstage-community/plugin-tech-insights';
import { EntityKindPicker } from '@backstage/plugin-catalog-react';
import { ConsolePage, type ConsoleClassicPage } from '@internal/plugin-console';

const app = createApp({
  apis,
  themes: [cnoeVibrantLightAppTheme, cnoeVibrantDarkAppTheme],
  components: {
    SignInPage: props => {
      const configApi = useApi(configApiRef);
      if (configApi.getString('auth.environment') === 'local') {
        return (
          <LogoInHeader>
            <SignInPage {...props} auto providers={['guest']} />
          </LogoInHeader>
        );
      }
      return (
        <LogoInHeader>
          <SignInPage
            {...props}
            provider={{
              id: 'keycloak-oidc',
              title: 'Keycloak',
              message: 'Sign in using Keycloak',
              apiRef: keycloakOIDCAuthApiRef,
            }}
          />
        </LogoInHeader>
      );
    },
  },
  bindRoutes({ bind }) {
    bind(catalogPlugin.externalRoutes, {
      createComponent: scaffolderPlugin.routes.root,
      viewTechDoc: techdocsPlugin.routes.docRoot,
      createFromTemplate: scaffolderPlugin.routes.selectedTemplate,
    });
    bind(apiDocsPlugin.externalRoutes, {
      registerApi: catalogImportPlugin.routes.importPage,
    });
    bind(scaffolderPlugin.externalRoutes, {
      registerComponent: catalogImportPlugin.routes.importPage,
      viewTechDoc: techdocsPlugin.routes.docRoot,
    });
    bind(orgPlugin.externalRoutes, {
      catalogIndex: catalogPlugin.routes.catalogIndex,
    });
  },
});

// Pages mounted both in the classic routes and in the console (/console/<id>): the same element, nothing duplicated.
const scaffolderPage = (
  <ScaffolderPage
    components={{
      EXPERIMENTAL_TemplateListPageComponent: CustomScaffolderPage,
    }}
  />
);
const docsIndexPage = <TechDocsIndexPage initialFilter="all" />;
const apiExplorerPage = <CustomApiExplorerPage />;
const catalogGraphPage = <CatalogGraphPage />;
const techInsightsPage = <TechInsightsScorecardPage />;
const costsPage = <CostsPage />;
const topologyPage = <TopologyPage />;
const cisNodesPage = <NodesCompliancePage />;
const imagesPage = <ImagesPage />;

/** An assistant inside the console: its workspace, with the conversations of the whole team beside it. */
const ConsoleAssistant = ({ id }: { id: string }) => {
  const me = CONSOLE_ASSISTANTS.find(a => a.id === id)!;
  return (
    <AssistantPage
      profile={me.profile}
      variant="console"
      others={CONSOLE_ASSISTANTS.map(({ id: x, name, colour, Icon, profile }) => ({
        title: name,
        to: `/console/${x}`,
        current: x === id,
        colour,
        icon: <Icon sx={{ fontSize: 'inherit' }} />,
        path: profile.path,
      }))}
    />
  );
};

const consolePages: ConsoleClassicPage[] = [
  { id: 'create', title: 'Create', layer: 'portal', classicPath: '/create', nested: true, element: scaffolderPage },
  { id: 'apis', title: 'APIs', layer: 'portal', classicPath: '/api-docs', element: apiExplorerPage },
  { id: 'dependencies', title: 'Dependencies', layer: 'portal', classicPath: '/catalog-graph', element: catalogGraphPage },
  { id: 'docs', title: 'Docs', layer: 'portal', classicPath: '/docs', element: docsIndexPage },
  { id: 'quality', title: 'Quality', layer: 'portal', classicPath: '/tech-insights', element: techInsightsPage },
  { id: 'costs', title: 'Costs', layer: 'portal', classicPath: '/costs', element: costsPage },
  { id: 'cis-nodes', title: 'CIS Kubernetes nodes', layer: 'cluster', classicPath: '/cis-nodes', element: cisNodesPage },
  { id: 'images', title: 'Images', layer: 'cluster', classicPath: '/images', element: imagesPage },
  { id: 'assistants', title: 'The team', product: 'The assistants: who does what, and how they hand over', layer: 'assistants', classicPath: '/ops-assistant', consoleOnly: true, element: <ConsoleAssistantsTeam /> },
  { id: 'ops-assistant', title: 'Operations', product: 'Operations assistant: what happens in the cluster and why', layer: 'assistants', classicPath: '/ops-assistant', element: <ConsoleAssistant id="ops-assistant" /> },
  { id: 'sec-assistant', title: 'Security', product: 'Security assistant: vulnerabilities, exposure and risk', layer: 'assistants', classicPath: '/sec-assistant', element: <ConsoleAssistant id="sec-assistant" /> },
  { id: 'functional-assistant', title: 'Functional', product: 'Functional assistant: specifications of a system', layer: 'assistants', classicPath: '/functional-assistant', element: <ConsoleAssistant id="functional-assistant" /> },
  { id: 'architect-assistant', title: 'Architect', product: 'Architect assistant: architecture, installation and DR of a system', layer: 'assistants', classicPath: '/architect-assistant', element: <ConsoleAssistant id="architect-assistant" /> },
  { id: 'developer-assistant', title: 'Developer', product: 'Developer assistant: from a change to draft pull requests', layer: 'assistants', classicPath: '/developer-assistant', element: <ConsoleAssistant id="developer-assistant" /> },
  { id: 'keycloak', title: 'IAM', product: 'Keycloak', layer: 'managers', classicPath: '/keycloak-manager', element: <KeycloakManagerPage /> },
  { id: 'gravitee', title: 'API management', product: 'Gravitee', layer: 'managers', classicPath: '/gravitee-manager', element: <GraviteeManagerPage /> },
  { id: 'datahub', title: 'Data management', product: 'DataHub', layer: 'managers', classicPath: '/datahub', element: <DatahubCatalogPage /> },
  { id: 'superset', title: 'Business intelligence', product: 'Superset', layer: 'managers', classicPath: '/superset-manager', element: <SupersetManagerPage /> },
  { id: 'camunda', title: 'Business process', product: 'Camunda', layer: 'managers', classicPath: '/camunda-manager', element: <CamundaManagerPage /> },
  { id: 'seaweedfs', title: 'S3 buckets', product: 'SeaweedFS', layer: 'managers', classicPath: '/seaweedfs-manager', element: <SeaweedfsManagerPage /> },
  { id: 'alfresco', title: 'Document management system', product: 'Alfresco', layer: 'managers', classicPath: '/alfresco-manager', element: <AlfrescoManagerPage /> },
  { id: 'activepieces', title: 'Workflow integration', product: 'Activepieces', layer: 'managers', classicPath: '/activepieces-manager', element: <ActivepiecesManagerPage /> },
];

const routes = (
  <FlatRoutes>
    <Route path="/" element={<Navigate to="home" />} />
    <Route path="/home" element={<Homepage />} />
    <Route path="/catalog" element={<CatalogIndexPage filters={<EntityKindPicker initialFilter="component" hidden />} />} />
    <Route
      path="/catalog/:namespace/:kind/:name"
      element={<CatalogEntityPage />}
    >
      {entityPage}
    </Route>
    {/* every documentation of the catalog, not only what the user owns (the default of the plugin is "owned") */}
    <Route path="/docs" element={docsIndexPage} />
    <Route
      path="/docs/:namespace/:kind/:name/*"
      element={<TechDocsReaderPage />}
    >
      <TechDocsAddons>
        <ReportIssue />
      </TechDocsAddons>
    </Route>
    <Route
      path="/create"
      element={scaffolderPage}
    />
    <Route path="/api-docs" element={apiExplorerPage} />
    <Route path="/topology" element={topologyPage} />
    <Route path="/cis-nodes" element={cisNodesPage} />
    <Route path="/images" element={imagesPage} />
    <Route path="/costs" element={costsPage} />
    <Route path="/ops-assistant" element={<OpsAssistantPage />} />
    <Route path="/sec-assistant" element={<SecAssistantPage />} />
    <Route path="/functional-assistant" element={<FunctionalAssistantPage />} />
    <Route path="/architect-assistant" element={<ArchitectAssistantPage />} />
    <Route path="/developer-assistant" element={<DeveloperAssistantPage />} />
    <Route path="/tech-insights" element={techInsightsPage} />
    <Route path="/keycloak-manager" element={<KeycloakManagerPage />} />
    <Route path="/superset-manager" element={<SupersetManagerPage />} />
    <Route path="/camunda-manager" element={<CamundaManagerPage />} />
    <Route path="/seaweedfs-manager" element={<SeaweedfsManagerPage />} />
    <Route path="/alfresco-manager" element={<AlfrescoManagerPage />} />
    <Route path="/activepieces-manager" element={<ActivepiecesManagerPage />} />
    <Route path="/gravitee-manager" element={<GraviteeManagerPage />} />
    <Route path="/datahub" element={<DatahubCatalogPage />} />
    <Route
      path="/tech-radar"
      element={<TechRadarPage width={1500} height={800} />}
    />
    <Route
      path="/catalog-import"
      element={
        <RequirePermission permission={catalogEntityCreatePermission}>
          <CatalogImportPage />
        </RequirePermission>
      }
    />
    <Route path="/search" element={<SearchPage />}>
      {searchPage}
    </Route>
    <Route path="/settings" element={<UserSettingsPage />} />
    <Route path="/catalog-graph" element={catalogGraphPage} />
    {/* the cloud-style console: off unless console.enabled (plugins/console); the classic pages above do not change */}
    <Route path="/console/*" element={<ConsolePage entityContent={consoleEntityPage} pages={consolePages} />} />
  </FlatRoutes>
);

export default app.createRoot(
  <>
    <AlertDisplay />
    <OAuthRequestDialog />
    <AppRouter>
      <VisitListener />
      <Root>{routes}</Root>
    </AppRouter>
  </>,
);
// ci: trigger build after enabling Actions on the fork
// ci: retry trigger 1788358504
