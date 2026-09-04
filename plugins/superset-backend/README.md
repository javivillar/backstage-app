# @internal/backstage-plugin-superset-backend

Backend half of Backstage's Superset self-service resource management: any
signed-in Backstage user can create/update their own Superset database
connections and datasets, and provision (create, empty) their own charts and
dashboards, with per-creator ownership enforcement (a `backstage-admin`
member can override anyone's).

For the full security model (why ownership enforcement lives in Backstage
rather than relying on Superset's own native `owners` field, test accounts,
how to test cross-user isolation) see the **Backstage↔Superset section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` — this README covers the code, that doc covers the
auth/authz story end to end.

Added 2026-09-04, following the same extraction convention already used for
`plugins/keycloak-backend` (and terraform/apache-spark/argo-workflows before
it) — new functionality lives isolated in its own plugin from day one instead
of inline in `packages/backend`.

## What's in here

- **`supersetClient.ts`** — auth against Superset's REST API as the
  `backstage-superset-sa` service account. Superset's `AUTH_TYPE` is
  `AUTH_OAUTH` (human logins go through Keycloak SSO), but the DB-provider
  login endpoint (`POST /api/v1/security/login`) still works for a local
  account — that's what this service account uses. Mutating calls
  additionally need Superset's CSRF token *and* the session cookie it was
  issued with (`ensureCsrf`) — Flask-WTF validates the header against the
  cookie, not just the bearer token, which is a real gotcha if you've only
  ever scripted Keycloak's admin API (bearer-token-only, no CSRF).
- **`ownership.ts`** — TWO different mechanisms, because Superset itself
  isn't consistent here (verified live, not assumed):
  - Chart/Dataset/Dashboard genuinely have a native `owners` many-to-many
    relation. `requireOwnerOrAdmin` checks it — comparing by numeric
    Superset user id, since `owners[]` items are `{id, first_name,
    last_name}` with **no `username` field at all**. Backstage still has to
    enforce this itself despite it being native: Backstage talks to
    Superset through one shared service account, not per-user SSO, so
    Superset's own owner-based visibility never sees the real caller.
  - **Database (connection) has NO ownership concept in this Superset
    version at all** — verified via raw SQL, no owner join table exists for
    `dbs`. The REST API accepts an `owners` field on create/update without
    erroring, but silently drops it. `requireConnectionOwnerOrAdmin` instead
    checks a `backstage_owner` (Backstage username) key bolted onto
    Database's own `extra` JSON column — same philosophy as
    `keycloak-backend`'s `OWNER_ATTR`, applied to the one Superset resource
    that needs it. Gotcha: Database's single-object GET excludes `extra`
    (and `owners`) from its response entirely, but the LIST endpoint
    includes `extra` — the opposite of chart/dataset/dashboard, where the
    single GET has `owners` and the LIST doesn't. `connectionOwnerFromExtra`
    reads it from there.
  - `listSupersetObjects` pushes the owner filter into Superset's own Rison
    `q` query for chart/dataset/dashboard (server-side). For `database`,
    that same filter shape 400s (`Filter column: owners not allowed to
    filter` — yet another Database-specific inconsistency, unrelated to the
    missing relation), so it fetches the plain list and filters in Node by
    parsing each item's `extra`.
- **`superset-actions.ts`** — 6 scaffolder actions:
  `superset:create-connection` / `update-connection`,
  `superset:create-dataset` / `update-dataset` (full CRUD — these are
  genuinely form-shaped in Superset itself), and
  `superset:provision-chart` / `provision-dashboard` (create-only — chart
  and dashboard configuration in Superset is an interactive visual editor,
  not a linear form, so Backstage creates the empty, correctly-owned object
  and returns a deep link into Superset's own Explore/dashboard editor for
  the actual work). No update/delete actions for chart/dashboard.
- **`managerPlugin.ts`** — `supersetManagerPlugin`
  (`pluginId: 'superset-manager'`), `GET /connections|datasets|charts|dashboards`
  (owner-filtered) plus `DELETE /connections/:id` and `/datasets/:id`
  (ownership-checked) backing the `/superset-manager` page in
  `@internal/plugin-superset`. Charts/dashboards have no delete route here —
  deleted natively in Superset, matching the provision-only philosophy.
- **`scaffolderModule.ts`** — `supersetScaffolderModule`, registers the 6
  actions above (`pluginId: 'scaffolder'`, `moduleId: 'superset-actions'`).

## Wiring

```ts
backend.add(supersetScaffolderModule);
backend.add(supersetManagerPlugin);
```

Requires a `supersetAdmin` config block (`baseUrl`, `username`, `password` —
the `backstage-superset-sa` service account) in `app-config.yaml`, plus an
optional `supersetPublicUrl` (falls back to `supersetAdmin.baseUrl` if unset)
used to build the deep links returned by the two provision-* actions and
shown on the manager page's chart/dashboard rows. `baseUrl` should be the
**in-cluster** Superset URL (Backstage's backend calls it directly, no need
to round-trip through the ingress); `supersetPublicUrl` should be the
**browser-facing** ingress host, since that's what the developer's browser
opens.
