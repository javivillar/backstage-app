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
- **`ownership.ts`** — `callerInfo`/`requireOwnerOrAdmin`, structurally the
  same shape as `keycloak-backend`'s `getCallerInfo`/`requireOwnerOrAdmin`,
  but checking Superset's own native `owners` field instead of a bolted-on
  attribute (Superset already has ownership — Keycloak doesn't). **Why this
  check exists at all despite Superset's native support**: Backstage talks
  to Superset through one shared service account, not per-user SSO
  impersonation, so Superset's own owner-based visibility never sees the
  real caller — enforcement has to happen in Backstage, same as Keycloak.
  Also has `listSupersetObjects`, which pushes the owner filter into
  Superset's own Rison `q` query (`related/owners` + `filters` params)
  instead of fetching everything and filtering in Node — Superset's REST API
  supports server-side filtering, Keycloak's Admin API mostly doesn't.
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
