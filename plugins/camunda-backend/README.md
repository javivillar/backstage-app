# @internal/backstage-plugin-camunda-backend

Backend half of Backstage's Camunda self-service resource management: any
signed-in Backstage user can provision their own Camunda (`bpm-oneke`)
process definition, pre-wired with per-developer isolation, and only they
(or a `backstage-admin` member) can redeploy or delete it afterwards.

For the full security model (why ownership is enforced via Camunda's own
native authorization table instead of a bolted-on attribute, the
`camunda-backstage-sa` service account trade-off, test accounts, how to test
cross-user isolation) see the **Backstage↔Camunda section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` — this README covers the code, that doc covers the
auth/authz story end to end.

Added 2026-09-06, following the same extraction convention already used for
`plugins/keycloak-backend` and `plugins/superset-backend` — new functionality
lives isolated in its own plugin from day one instead of inline in
`packages/backend`.

## What's in here

- **`camundaClient.ts`** — auth against `engine-rest` as the
  `camunda-backstage-sa` service account. Camunda's REST API auth is
  delegated straight to the Keycloak identity plugin
  (`camunda.bpm.run.auth.enabled: true`), so a plain HTTP Basic header with
  a real Keycloak username/password is enough — no token to cache or
  refresh, unlike Superset's bearer-token-plus-CSRF dance.
- **`ownership.ts`** — unlike Keycloak (no ownership concept at all) or
  Superset's `Database` (no native owner relation, needs a bolted-on
  `extra.backstage_owner` attribute), Camunda has a real, native, fail-closed
  per-resource authorization table
  (`ACT_RU_AUTHORIZATION`: `resourceType`/`resourceId`/`userId`/
  `permissions[]`). This plugin reuses it directly instead of inventing a
  parallel attribute: at provision time, the backend grants the creator a
  `PROCESS_DEFINITION` authorization scoped to `resourceId = <processKey>`
  with permission `DELETE` — a permission the `camunda-editor` group's own
  shared grant (`READ` + `CREATE_INSTANCE`, resourceId `*`, see AUTHZ.md
  § bpm-oneke §5) does **not** include, so holding it on one resourceId is
  an unambiguous "this is mine" marker. `findOwner`/`ownerMap` read it back,
  `requireOwnerOrAdmin` enforces it.

  **Trade-off, documented rather than hidden**: granting/reading
  authorizations and deploying BPMN are admin-only operations in Camunda's
  model — `camunda-editor` has no permission on `AUTHORIZATION` or
  `DEPLOYMENT` resources. So `camunda-backstage-sa` must be a member of the
  `camunda-admin` Keycloak group; there is no narrower role to scope it down
  to (the Camunda Keycloak plugin only ever checks `administratorGroupName`
  group membership, never client roles). It's still a *separate* Keycloak
  user from the interactive `camunda-admin` account, same rotation/
  revocation principle as every other service account in this stack — it
  just can't be narrower the way `backstage-admin-sa`/`backstage-superset-sa`
  are.
- **`camunda-actions.ts`** — 3 scaffolder actions:
  - `camunda:provision-process` — renders a canonical BPMN (start event →
    one user task → end event) carrying the exact same per-instance
    isolation `executionListener` + `assignee` pattern already proven for
    `authz-test-process` (AUTHZ.md § bpm-oneke §6), so every self-service
    process gets instance/task isolation for free; deploys it under
    `<caller-username>-<slug>`; grants the caller definition-level
    ownership; returns the Cockpit link and the BPMN so the developer can
    keep modeling it in the desktop Camunda Modeler.
  - `camunda:update-process` — owner-gated redeploy under the same key.
    Rejects the input if the pasted BPMN's `<bpmn:process id>` doesn't match
    the target key — the ownership grant is scoped to that resourceId, so a
    renamed process id would silently redeploy as an unowned definition.
  - `camunda:delete-process` — owner-gated `DELETE .../process-definition/key/{key}?cascade=true`.
- **`managerPlugin.ts`** — one GET/DELETE pair backing the `/camunda-manager`
  frontend page: lists process definitions filtered to the caller's own
  (everything, with an Owner column, for `backstage-admin`), and deletes one
  after the same ownership check. Same shape as `keycloak-manager`/
  `superset-manager`.

## Config

```yaml
camundaAdmin:
  baseUrl: ${CAMUNDA_ADMIN_BASE_URL}   # in-cluster engine-rest base, e.g. http://bpm-oneke-camunda.bpm.svc.cluster.local:8080
  username: ${CAMUNDA_ADMIN_USERNAME}  # camunda-backstage-sa
  password: ${CAMUNDA_ADMIN_PASSWORD}
camundaPublicUrl: ${CAMUNDA_PUBLIC_URL} # browser-facing, for Cockpit deep links
```

Wired from `refresquito-services`' `charts/cnoe-oneke/templates/backstage-config.yaml`
+ `backstage-secret.yaml`, same pattern as `supersetAdmin`/`keycloakAdmin`.
