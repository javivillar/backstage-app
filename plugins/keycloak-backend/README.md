# @internal/backstage-plugin-keycloak-backend

Backend half of Backstage's Keycloak self-service identity management: any
signed-in Backstage user can create/update/delete their own Keycloak users,
groups and OIDC clients on the `RefresquitoTime` realm, with per-creator
ownership enforcement (a `backstage-admin` member can override anyone's).

Extracted 2026-09-03 from `packages/backend/src/plugins/{auth,keycloak-manager}.ts`
and `packages/backend/src/modules/{actions/keycloak-actions,catalog-keycloak-module,
catalog-providers/keycloak-entity-provider}.ts` — pure move, no behavior change.
Isolating it here (instead of inline in `packages/backend`) means a future upstream
CNOE fork bump doesn't have to merge around this logic, only around the few
`backend.add(...)` lines in `packages/backend/src/index.ts` that wire it in.

## What's in here

- **`actions.ts`** — the 9 `keycloak:create-/update-/delete-{user,group,client}`
  scaffolder actions, plus the shared Keycloak Admin API helpers
  (`getAdminToken`, `kcAdminFetch`) and ownership helpers (`ownerFromAttributes`,
  `ownerFromClientAttributes`, `requireOwnerOrAdmin`). Every object these actions
  create is stamped with a `backstage_owner` attribute (the creator's entity ref);
  update/delete actions check it. Registered via **`scaffolderModule.ts`**
  (`keycloakScaffolderModule`, `pluginId: 'scaffolder'`).
- **`managerPlugin.ts`** — `keycloakManagerPlugin` (`pluginId: 'keycloak-manager'`),
  three read-only `GET /users|groups|clients` endpoints, owner-filtered, backing
  the `/keycloak-manager` page in `@internal/plugin-keycloak`.
- **`authModule.ts`** — `authModuleKeycloakOIDCProvider`, the `keycloak-oidc` auth
  provider + a custom `signInResolver` (uses `preferred_username`, not the `name`
  claim, to avoid a space in the Backstage entity name).
- **`entityProvider.ts`** + **`catalogModule.ts`** — `KeycloakEntityProvider` /
  `catalogKeycloakModule`, syncs realm users/groups into the catalog. **Disabled by
  default** (`KEYCLOAK_CATALOG_SYNC=true` to opt in) — it took down the `catalog`
  plugin (503 on `/catalog` and `/create`) on first deploy and the root cause was
  never confirmed for lack of log access at the time. Don't flip it on without
  either real logs or a canary rollout.

## Wiring

Everything here is added from `packages/backend/src/index.ts`, behind the same
env-var gates as before the extraction:

```ts
backend.add(keycloakScaffolderModule);                     // always on
backend.add(keycloakManagerPlugin);                         // always on
if (process.env.KEYCLOAK_URL) backend.add(authModuleKeycloakOIDCProvider);
if (process.env.KEYCLOAK_CATALOG_SYNC === 'true') backend.add(catalogKeycloakModule);
```

Requires `keycloakAdmin` config (`baseUrl`, `realm`, `clientId`, `clientSecret` —
the `backstage-admin-sa` service account) in `app-config.yaml` for the scaffolder
actions, manager plugin and entity provider; `KEYCLOAK_URL` (plus the standard
`auth.providers.keycloak-oidc` OIDC config) for the auth module.
