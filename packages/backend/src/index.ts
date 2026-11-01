import { createBackend } from '@backstage/backend-defaults';
import { cnoeScaffolderActions } from './modules/scaffolder';
import {
  authModuleKeycloakOIDCProvider,
  catalogKeycloakModule,
  keycloakManagerPlugin,
  keycloakScaffolderModule,
} from '@internal/backstage-plugin-keycloak-backend';
import {
  supersetManagerPlugin,
  supersetScaffolderModule,
} from '@internal/backstage-plugin-superset-backend';
import {
  camundaManagerPlugin,
  camundaScaffolderModule,
} from '@internal/backstage-plugin-camunda-backend';
import {
  seaweedfsManagerPlugin,
  seaweedfsScaffolderModule,
} from '@internal/backstage-plugin-seaweedfs-backend';
import {
  activepiecesManagerPlugin,
  activepiecesScaffolderModule,
} from '@internal/backstage-plugin-activepieces-backend';
import { datahubManagerPlugin, datahubScaffolderModule } from '@internal/backstage-plugin-datahub-backend';
import { catalogModuleImageCatalog, sbomPlugin, techInsightsModuleSupplyChain } from '@internal/backstage-plugin-sbom-backend';
import {
  alfrescoManagerPlugin,
  alfrescoScaffolderModule,
} from '@internal/backstage-plugin-alfresco-backend';
import { graviteeManagerPlugin } from '@internal/backstage-plugin-gravitee-backend';
import { opsAssistantPlugin } from '@internal/backstage-plugin-ops-assistant-backend';

const backend = createBackend();

// Detect if running inside a Kubernetes cluster
const isInCluster = require('fs').existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token');

const k8sEnabled = process.env.K8S_CLUSTER_URL || isInCluster;

// Core plugins
backend.add(import('@backstage/plugin-app-backend'));
if (process.env.MOCK_MODE === 'true') {
  backend.add(import('./plugins/mock-proxy'));
} else {
  backend.add(import('@backstage/plugin-proxy-backend'));
}
backend.add(import('@backstage/plugin-techdocs-backend'));
// settings of each user (its home layout, starred entities, recent visits) in the database of Backstage
backend.add(import('@backstage/plugin-user-settings-backend'));
// the live topology of the platform, published by the OpenNebula host (page Topology)
backend.add(import('./plugins/topology'));
// the deployments of each namespace (new image versions), charged in its cost (page Costs)
backend.add(import('./plugins/costs'));
// the overview of this cluster (nodes, Argo CD applications, volumes) for the console (page /console/cluster)
backend.add(import('./plugins/cluster'));

// Scaffolder
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

// Scaffolder modules that require external services — skip if not configured
if (process.env.GITHUB_TOKEN) {
  backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
}
backend.add(import('@backstage/plugin-scaffolder-backend-module-gitlab'));

// CNOE custom scaffolder actions (gitea publish, argocd, k8s-apply, sanitize, verify)
backend.add(cnoeScaffolderActions);

// Keycloak self-service scaffolder actions (create/update/delete users,
// groups, clients) — see plugins/keycloak-backend.
backend.add(keycloakScaffolderModule);

// Superset self-service scaffolder actions (connection/dataset CRUD, chart/
// dashboard provisioning) — see plugins/superset-backend.
backend.add(supersetScaffolderModule);

// Camunda self-service scaffolder actions (provision/update/delete a
// process definition, pre-wired with per-developer isolation) — see
// plugins/camunda-backend.
backend.add(camundaScaffolderModule);

// SeaweedFS self-service scaffolder actions (bucket/table-bucket/group/
// policy CRUD, pre-wired with per-developer isolation) — see
// plugins/seaweedfs-backend.
backend.add(seaweedfsScaffolderModule);

// Alfresco self-service scaffolder actions (Site create/delete, pre-wired
// so the caller lands as the site's native SiteManager) — see
// plugins/alfresco-backend.
backend.add(alfrescoScaffolderModule);

// Activepieces self-service scaffolder actions (project create/rename/delete
// + member/role management) — see plugins/activepieces-backend.
backend.add(activepiecesScaffolderModule);

// Roadie scaffolder modules
backend.add(import('@roadiehq/scaffolder-backend-module-utils'));
backend.add(import('@roadiehq/scaffolder-backend-module-http-request'));
if (k8sEnabled) {
  backend.add(import('@roadiehq/scaffolder-backend-argocd'));
}

// Auth
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));

// Catalog
backend.add(import('@backstage/plugin-catalog-backend'));

// Discover catalog-info.yaml files in the repositories of a GitHub owner. Does nothing until
// app-config declares catalog.providers.github (owner, filters, schedule).
backend.add(import('@backstage/plugin-catalog-backend-module-github'));

// Add GitLab integration for catalog processing
if (process.env.GIT_HOSTNAME) {
  backend.add(import('@backstage/plugin-catalog-backend-module-gitlab'));
}

// Sync Keycloak users/groups into the catalog: every user and group of the realm becomes a User / Group entity with
// its members, so a group page lists its people, "My Groups" shows the groups of who is logged in, and a person links
// to what they own. Turned on by cnoe-oneke (backstage.keycloakCatalogSync, env KEYCLOAK_CATALOG_SYNC=true): off by
// setting it false, without a new image. It was off from 2026-09-03 to 2026-10-24 after a 503 on /catalog when it was
// turned on (not diagnosed then: no logs). On 2026-10-24 catalogModule.ts was found importing its extension point
// from '@backstage/plugin-catalog-node/alpha', which plugin-catalog-node 2.x no longer exports (undefined: the catalog
// plugin cannot start); fixed, with tests (catalogModule.test.ts, entityProvider.test.ts).
if (process.env.KEYCLOAK_CATALOG_SYNC === 'true') {
  backend.add(catalogKeycloakModule);
}

// Permission
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(
  import('@backstage/plugin-permission-backend-module-allow-all-policy'),
);

// Search
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs/alpha'));

// Kubernetes
if (process.env.MOCK_MODE === 'true') {
  backend.add(import('./plugins/mock-kubernetes'));
} else if (k8sEnabled) {
  backend.add(import('@backstage/plugin-kubernetes-backend'));
  backend.add(import('@terasky/backstage-plugin-kubernetes-ingestor'));
  backend.add(import('@terasky/backstage-plugin-kro-resources-backend'));
}

// Argo CD: the API behind the Argo CD card of the entity page (/api/argocd/...). It was a
// dependency of this package but never registered, so the card answered "Cannot get argo
// location(s) for service" (404). Mock mode has its own stub (./plugins/mock-argocd, below).
if (process.env.MOCK_MODE !== 'true' && k8sEnabled) {
  backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));
}

// Keycloak OIDC auth
if (process.env.KEYCLOAK_URL) {
  backend.add(authModuleKeycloakOIDCProvider);
}

// Keycloak manager — read-only list endpoints backing the /keycloak-manager
// frontend page (owner-scoped browse of what the keycloak:create-*
// scaffolder actions provisioned). Plain httpRouter plugin, no catalog
// processing involved.
backend.add(keycloakManagerPlugin);

// Superset manager — list/delete endpoints backing the /superset-manager
// frontend page (owner-scoped browse of connections/datasets/charts/
// dashboards). Same shape as keycloak-manager.
backend.add(supersetManagerPlugin);

// Camunda manager — list/delete endpoints backing the /camunda-manager
// frontend page (owner-scoped browse of provisioned process definitions).
// Same shape as keycloak-manager/superset-manager.
backend.add(camundaManagerPlugin);

// SeaweedFS manager — list/delete endpoints backing the /seaweedfs-manager
// frontend page (owner-scoped browse of buckets/table buckets/groups/
// policies), plus the group-edit policy-attach/detach routes. Same shape as
// the other managers.
backend.add(seaweedfsManagerPlugin);

// Alfresco manager — list/delete endpoints backing the /alfresco-manager
// frontend page (Sites the caller manages), plus the per-site
// members/roles routes. Authorization is checked live against Alfresco's
// own native SiteManager role instead of a stored ownership table — see
// plugins/alfresco-backend/src/alfrescoAuthz.ts.
backend.add(alfrescoManagerPlugin);

// Activepieces manager — list/rename/delete/members endpoints backing the
// /activepieces-manager frontend page. Every route is authorized live
// against the caller's own Activepieces project role (deny by default;
// the API key used underneath is platform-wide) — see
// plugins/activepieces-backend/src/activepiecesAuthz.ts.
backend.add(activepiecesManagerPlugin);

// DataHub manager (phase 1, READ ONLY) — entity card, governance tab and the
// /datahub catalog page. Talks to DataHub with a Reader service-account token;
// per-user access is enforced in the plugin (datahub-* Keycloak group gate)
// — see plugins/datahub-backend/src/datahubAuthz.ts and
// BACKSTAGE-DATAHUB-DESIGN.md.
backend.add(datahubManagerPlugin);
// DataHub write path (scaffolder actions, F2) — inert unless datahub.writes.enabled: true.
backend.add(datahubScaffolderModule);

// SBOM tab -- the CycloneDX SBOM the CI attached to each image a component runs (annotation
// refresquito.io/sbom-images), read from the registry (sbom.allowedImages, sbom.dockerConfig). Read only.
backend.add(sbomPlugin);
// Image catalog (page /images): the images of Harbor a system may use, as Resource entities of type container-image
// (plugins/sbom-backend/src/imageCatalogEntities.ts); inert unless sbom.imageCatalog.harborUrl is set.
backend.add(catalogModuleImageCatalog);

// Operations assistant (page /ops-assistant): a model with the READ-ONLY tools of the MCP server opsassistant-oneke
// (Kubernetes, Argo CD, logs, metrics, docs). The model is pluggable (plugins/ops-assistant-backend/src/model/:
// Anthropic today, a local model tomorrow); inert unless opsAssistant is configured; only opsAssistant.allowedGroups.
backend.add(opsAssistantPlugin);

// Scorecard "Quality & Security" (Tech Insights): facts of the catalog (owner, description, TechDocs) and of what each
// application runs (SBOM, Wazuh image scan, line of the Python Framework: plugins/sbom-backend/src/techInsights.ts),
// checked by the rules of techInsights.factChecker.checks (app-config, chart cnoe-oneke).
backend.add(import('@backstage-community/plugin-tech-insights-backend'));
backend.add(import('@backstage-community/plugin-tech-insights-backend-module-jsonfc'));
backend.add(techInsightsModuleSupplyChain);

// Gravitee manager -- list/create endpoints backing the /gravitee-manager page
// ("soft" self-service of Gravitee gateways = v4 HTTP proxy APIs). The caller
// becomes the API's native Gravitee PRIMARY_OWNER; teammates (same
// gravitee-team-* Keycloak group) get a read-only view here. Deliberately NO
// scaffolder module: task parameters are visible to every user while the
// permission policy is allow-all. Answers 503 unless graviteeAdmin.* is
// configured -- see plugins/gravitee-backend/README.md.
backend.add(graviteeManagerPlugin);

// Terraform backend
if (process.env.MOCK_MODE !== 'true') {
  backend.add(import('@internal/backstage-plugin-terraform-backend'));
} else {
  backend.add(import('./plugins/mock-terraform'));
  backend.add(import('./plugins/mock-argocd'));
}

backend.start();
