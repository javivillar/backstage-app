# Custom Plugins

This directory contains custom CNOE plugins migrated from the original backstage-app,
plus refresquito-specific plugins added on top of that base. Isolating custom code here
(instead of inline in `packages/app`/`packages/backend`) keeps `packages/*` close to
upstream, so pulling a newer CNOE/Backstage fork mostly touches the thin wiring in
`packages/backend/src/index.ts` and `packages/app/src/App.tsx`/`apis.ts` rather than
conflicting inside plugin logic.

| Plugin | Role | What it is |
| --- | --- | --- |
| `apache-spark` | frontend | CNOE's Apache Spark application overview tab |
| `argo-workflows` | frontend | CNOE's Argo Workflows overview tab |
| `cnoe-ui` | frontend | CNOE's shared theme (`cnoeDarkTheme`/`cnoeLightTheme`), logo components, and `CNOEHomepage` |
| `keycloak` | frontend | `KeycloakManagerPage` (`/keycloak-manager`) + the `keycloak-oidc` sign-in API factory. Pairs with `keycloak-backend`. |
| `keycloak-backend` | backend | Keycloak self-service: the 9 `keycloak:create-/update-/delete-*` scaffolder actions, the `keycloak-manager` list-endpoints plugin, the OIDC auth module (custom `signInResolver`), and the catalog `EntityProvider` (disabled by default, see the module's own comments). Refresquito-specific, not from upstream CNOE. |
| `scaffolder-backend-module-gitlab` | backend | GitLab scaffolder actions (roadie-derived) |
| `terraform` | frontend | Terraform state/plan viewer tab |
| `terraform-backend` | backend | Terraform backend (S3 state, plan/apply) powering the `terraform` frontend plugin |

`keycloak`/`keycloak-backend` were extracted from `packages/app`/`packages/backend` on
2026-09-03 (pure move, no behavior change) — see each package's own README for details.
