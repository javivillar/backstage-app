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
import {
  alfrescoManagerPlugin,
  alfrescoScaffolderModule,
} from '@internal/backstage-plugin-alfresco-backend';

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

// Add GitLab integration for catalog processing
if (process.env.GIT_HOSTNAME) {
  backend.add(import('@backstage/plugin-catalog-backend-module-gitlab'));
}

// Sync Keycloak users/groups into the catalog (Phase 2 of Keycloak identity
// management — browse what the create-* scaffolder templates provisioned).
// DISABLED BY DEFAULT (2026-09-03): broke the catalog plugin in production
// (503 on /catalog and /create) in a way that couldn't be diagnosed live
// (RKE2 apiserver<->kubelet tunnel down on 3/6 nodes, no log access). Opt in
// only once the actual failure has been reproduced with logs.
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

// Terraform backend
if (process.env.MOCK_MODE !== 'true') {
  backend.add(import('@internal/backstage-plugin-terraform-backend'));
} else {
  backend.add(import('./plugins/mock-terraform'));
  backend.add(import('./plugins/mock-argocd'));
}

backend.start();
