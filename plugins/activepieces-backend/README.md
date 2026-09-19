# @internal/backstage-plugin-activepieces-backend

Self-service for **Activepieces projects** from the Backstage developer portal.
Backstage only *initializes and profiles* high-level objects (a project, its
members and their roles); users then model connections, variables and flows
directly inside Activepieces.

## What it provides

| Piece | What |
|---|---|
| Scaffolder actions | `activepieces:create-project`, `update-project`, `delete-project`, `set-member`, `remove-member` (`scaffolderModule.ts`) |
| Manager plugin (`pluginId: activepieces-manager`) | `/api/activepieces-manager/*` — list / rename / delete projects and manage members; backs the `/activepieces-manager` page (`managerPlugin.ts`) |

Not handled on purpose: connections and variables (secrets / per-app OAuth
shapes — created by the user in Activepieces), flow logic (visual editor),
MCP servers (Activepieces only exposes those to real users, not service keys).

## Configuration

```yaml
activepiecesAdmin:
  baseUrl: http://activepieces-oneke-activepieces.activepieces-oneke.svc.cluster.local
  apiKey: ${ACTIVEPIECES_ADMIN_API_KEY}      # platform API key "backstage-sa"
activepiecesPublicUrl: http://activepieces.<domain>   # deep links only
keycloakAdmin: { ... }                       # already present (keycloak-backend)
```

* **API key** — create once in Activepieces (`POST /v1/api-keys` as platform
  admin, or the UI). It is a *service principal*: platform-wide.
* **Keycloak** — reuses the existing `keycloakAdmin` service account to (1) resolve
  a Backstage username to the email Activepieces knows the user by, and (2) put
  the user in the `activepieces-user` group, the Activepieces SSO access gate.

## Authorization model (read this before changing anything)

The API key can read and modify *every* project and Activepieces will not stop
it, so **isolation between users is enforced here**, in one place:
`requireProjectPermission()` in `activepiecesAuthz.ts`. It is deny-by-default and
passes only for a `group:default/backstage-admin` member or a member whose
*current* Activepieces role includes the needed permission (`WRITE_PROJECT` to
rename/delete, `WRITE_PROJECT_MEMBER` to manage members). The permission array
is read live from Activepieces, so a promotion made directly in Activepieces is
honoured immediately — there is no ownership table to drift.

Ownership itself: a service-key `POST /v1/projects` makes the *platform owner*
the project's `ownerId`, so the creator is recorded as
`externalId = backstage:<username>/<slug>` **and**, authoritatively, as the
project's Admin member. Only projects with that prefix (type `TEAM`) are ever
listed or touched — personal projects and hand-made ones like "Shared Flows"
are invisible to the plugin.

Guards worth knowing: `externalId` is unique per platform and a duplicate would
be a raw 500 upstream, so it is checked first; a failed creation rolls the
project back; the last member able to manage members cannot be removed or
demoted.

## Creator with no Activepieces account yet (owner-pending)

A creator's Admin membership only materialises at their first Activepieces
login, so right after creating a project there is no member row to read a role
from. `isPendingOwner()` recognises the project's recorded creator
(`externalId`) as its owner **only while that person has no Activepieces
account at all**; once the account exists the live member row is again the only
authority, so someone removed on purpose does not regain rights this way.

## Identity gotcha: users with no Activepieces account yet

Activepieces sign-up is invitation-only. For a member with no account the
invitation comes back `PENDING` with a link; the plugin accepts it with its own
token so the user's first Keycloak login is let through, and the membership
materialises **at that first login** — until then the manager page shows them
as "invited". A user that already has an account is added immediately.
