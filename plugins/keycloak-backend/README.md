# @internal/backstage-plugin-keycloak-backend

Backend half of Backstage's Keycloak self-service identity management: any
signed-in Backstage user can create/update/delete their own Keycloak users,
groups and OIDC clients on the `RefresquitoTime` realm, with per-creator
ownership enforcement (a `backstage-admin` member can override anyone's).

For the full security model (login gate, ownership authz, test accounts,
how to test cross-user isolation) see the **Backstage section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` — this README covers the code, that doc covers
the auth/authz story end to end.

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

## Access tab (security tags)

`GET /api/keycloak-manager/security?component=<name>[&stage=<stage>]` — the groups, SSO clients (with their client
roles) and realm roles whose Keycloak attribute `refresquito.component` is `<name>` (and, with a stage, whose
`refresquito.stage` includes it or is empty), with the groups that hold each role and the number of members of each
group (their usernames only for `backstage-admin`). The tab *Access* of a Component calls it: a service of the stack
by the name of its Component (`superset-oneke`), a stage of an application by `refresquito.io/application` and
`refresquito.io/stage` (or `refresquito.io/keycloak-component` to override). `GET .../security/unowned`
(backstage-admin): what has no `refresquito.component`, shown on the Keycloak Manager. Contract of the tags:
`identity/README.md` of refresquito-services.

`keycloak:create-group` asks for `belongsTo` (the Component the group governs), `grants` and `kind`, and writes the
tags (`refresquito.component`, `.stage`, `.kind`, `.grants`, and zone/program/classification copied from an object
already tagged for that component).

## Access administration

`/api/keycloak-manager/access/*` backs console › Portal › Manage › Access administration: the only place of the
portal that changes who is in a Keycloak group. People are never created there; existing users are added to and
removed from the groups of a product.

| Route | What |
| --- | --- |
| `GET /access/products` | the products the caller administers (every one for `backstage-admin`) |
| `GET /access/products/:component` | its groups with their members, and its last changes |
| `GET /access/people?search=` | existing people to add (2 characters or more) |
| `GET /access/people/:username` | what a person has in the products the caller administers |
| `PUT` / `DELETE /access/groups/:group/members/:username` | add / remove a person |

Rules (`src/accessModel.ts`, tested in `accessModel.test.ts`):

- A product is a component of the security tags (`refresquito.component`). The Grafana groups of a service
  (`grafana-<service>-viewers` / `-editors`) are shown with that service.
- Its administrators are the members of its administrator group: `<product>-admin`, the only group ending in
  `-admin`, or the one set in `ADMIN_GROUPS` (config `keycloakAdmin.access.admins.<component>: [groups]` replaces the
  whole table). They add other administrators too.
- The owner group of a business application (`spec.owner` of its Component) administers its groups.
- `backstage-admin` administers everything, and only it changes the groups of `PORTAL_ONLY` (config
  `keycloakAdmin.access.portalOnly`): `headlamp-admin`, `argocd-admin`, `s3-admins`, `backstage-admin`...
- A product is never left without an administrator.
- A person who signs in through the hub (an identity provider link) is refused: the spoke maps their groups from the
  hub at every sign-in (sync mode FORCE), so they are changed in the hub.

Every change is recorded in the table `access_changes` of this plugin's database (who, what, when) and logged;
without the database no change is made. A change applies the next time the person signs in. The service account
needs `manage-users`, `view-users` and `query-groups` of `realm-management` (the realm of iam-oneke gives them).

## Access requests

`/api/keycloak-manager/access/requests` (`src/accessRoutes.ts`, `src/accessRequests.ts`; console › Portal › Manage ›
Access requests). Anyone signed in asks to be put in a group of a product, with a reason; never a group only the
portal administrators change. An administrator of that product approves it, which adds the person with every check
of Access administration (a person who signs in through the hub is refused and the request keeps waiting), or rejects
it with a reason the person reads. The person withdraws it while it waits. Requests are kept in the table
`access_requests` of the database of this plugin and are never deleted.

| Call | Who | What |
|---|---|---|
| `GET /requests` | anyone | the groups they may ask for, their requests, and the ones they decide |
| `POST /requests` `{group, reason}` | anyone | asks; 409 when they are in the group or have asked already |
| `POST /requests/:id/approval` | an administrator of the product | adds the person to the group |
| `POST /requests/:id/rejection` `{reason}` | an administrator of the product | rejects it |
| `DELETE /requests/:id` | who asked | withdraws it |

Who administers a product is decided in one place for the whole portal: `administersProduct()` of
`plugins/portal-access-common`, which the Manage backends of each service use too.

## Permissions of the portal

`plugins/portal-access-common/src/permissions.ts` is the one table of permissions of the portal: for each area (catalogue, create
applications, business map, continuity, security, support, costs, assistants, manage, access administration...) who
sees it and who changes it. A role is one or more Keycloak groups (`backstage-viewer`, `backstage-editor`,
`business-architect`, `continuity-officer`, `security-team`, `supportlead` / `supportteam`, the administrators of a
product, `backstage-admin`), so people get it in Access administration.

- `GET /api/keycloak-manager/permissions` answers what the signed-in person may do. The console
  (`plugins/console/src/portalPermissions.tsx`) lists only the menu entries of the areas they can use, shows a
  "you cannot use this" page for a link opened directly, and draws the page Roles and permissions.
- The permission policy of the backend (`packages/backend/src/plugins/permissionPolicy.ts`) replaces allow-all:
  everything is allowed except reading scaffolder Templates from the catalog. Templates tagged `business-map` are for
  `business-architect`; every other template for `backstage-editor` and the administrators of a product;
  `backstage-admin` reads all. Someone without the role neither lists a template nor runs it.
- The checks each module already makes (`business-architect`, `continuity-officer`, the owner team in Manage,
  `console.actions.groups`...) agree with the table and stay where they are until they are moved to it.

After deploying: people who create applications must be in `backstage-editor` (Access administration › cnoe), or
they lose the templates and the Create pages.

