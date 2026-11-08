# @internal/backstage-plugin-camunda-backend

Backend half of Backstage's business-process self-service resource
management, running against **Operaton** (`operaton-oneke`), the open-source
fork of Camunda 7. Any signed-in Backstage user can provision their own
Operaton process definition, pre-wired with per-developer isolation, and
only they (or a `backstage-admin` member) can redeploy or delete it
afterwards.

The package name, the `camunda-manager` plugin id, the `camunda:*` scaffolder
action ids and the `camundaAdmin.*`/`camundaPublicUrl` config keys keep their
historical names (the plugin was written for Camunda 7 / `bpm-oneke`, now
retired): renaming them would break routes, templates and config. Everything
users see says Operaton.

Operaton 2.x exposes the Camunda 7.23 REST API unchanged at `/engine-rest`
(same authorization resource type ids, same payloads) and runs BPMN with the
`camunda:` extension namespace unchanged. Two differences matter here:

- its webapps live under `/operaton/app/...` (Cockpit:
  `/operaton/app/cockpit/default/#/...`); the Camunda paths `/camunda/app/...`
  answer 404. Deep links are built by `cockpitProcessDefinitionUrl` in
  `camundaClient.ts`.
- Java classes referenced from BPMN scripts are `org.operaton.bpm.*`, not
  `org.camunda.bpm.*` (the generated BPMN uses the Operaton ones).

For the security model (why ownership is enforced via the engine's own
native authorization table instead of a bolted-on attribute, the service
account trade-off, how to test cross-user isolation) see the **Backstage
section of [`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
and the `operaton-oneke` chart in `refresquito-services` — this README
covers the code, those cover the auth/authz story end to end.

Added 2026-09-06 (for Camunda 7), following the same extraction convention
already used for `plugins/keycloak-backend` and `plugins/superset-backend`;
repointed to Operaton 2026-11-08.

## What's in here

- **`camundaClient.ts`** — auth against `engine-rest` as the
  `operaton-admin-sa` service account (Keycloak group `operaton-admin`).
  Operaton's REST API auth is delegated straight to its Keycloak identity
  plugin, so a plain HTTP Basic header with a real Keycloak
  username/password is enough — no token to cache or refresh, unlike
  Superset's bearer-token-plus-CSRF dance. Also builds the Cockpit deep links.
- **`ownership.ts`** — unlike Keycloak (no ownership concept at all) or
  Superset's `Database` (no native owner relation, needs a bolted-on
  `extra.backstage_owner` attribute), the engine has a real, native,
  fail-closed per-resource authorization table
  (`ACT_RU_AUTHORIZATION`: `resourceType`/`resourceId`/`userId`/
  `permissions[]`). This plugin reuses it directly instead of inventing a
  parallel attribute: at provision time, the backend grants the creator a
  `PROCESS_DEFINITION` (resource type 6) authorization scoped to
  `resourceId = <processKey>` with permission `DELETE` — a permission the
  `operaton-editor` group's own shared grant (`READ` + `CREATE_INSTANCE`,
  resourceId `*`, see `grants` in the operaton-oneke chart) does **not**
  include, so holding it on one resourceId is an unambiguous "this is mine"
  marker. `findOwner`/`ownerMap` read it back, `requireOwnerOrAdmin`
  enforces it.

  **Trade-off, documented rather than hidden**: granting/reading
  authorizations and deploying BPMN are admin-only operations in the
  engine's model — `operaton-editor` has no permission on `AUTHORIZATION`
  or `DEPLOYMENT` resources. So the service account must be a member of the
  `operaton-admin` Keycloak group; there is no narrower role to scope it
  down to (the Keycloak identity plugin only checks
  `administratorGroupName` group membership, never client roles). It's still
  a *separate* Keycloak user from interactive admin accounts, same
  rotation/revocation principle as every other service account in this
  stack.
- **`camunda-actions.ts`** — 3 scaffolder actions. They predate "manage
  through git" and write directly to the engine:
  - `camunda:provision-process` — renders a canonical BPMN (start event →
    one user task → end event) carrying the same per-instance isolation
    `executionListener` + `assignee` pattern as `authz-test-process` (in
    the operaton-oneke chart), so every self-service process gets
    instance/task isolation for free; deploys it under
    `<caller-username>-<slug>`; grants the caller definition-level
    ownership; returns the Operaton Cockpit link and the BPMN so the
    developer can keep modeling it in a BPMN modeler.
  - `camunda:update-process` — owner-gated redeploy under the same key.
    Rejects the input if the pasted BPMN's `<bpmn:process id>` doesn't match
    the target key — the ownership grant is scoped to that resourceId, so a
    renamed process id would silently redeploy as an unowned definition.
  - `camunda:delete-process` — owner-gated delete of every version
    (`DELETE .../process-definition/{id}?cascade=true` per version).
- **`managerPlugin.ts`** — one GET/DELETE pair backing the `/camunda-manager`
  frontend page ("Operaton Manager"): lists process definitions filtered to
  the caller's own (everything, with an Owner column, for `backstage-admin`),
  and deletes one after the same ownership check. Same shape as
  `keycloak-manager`/`superset-manager`.

## Config

```yaml
camundaAdmin:
  baseUrl: ${CAMUNDA_ADMIN_BASE_URL}   # in-cluster Operaton base, e.g. http://operaton-oneke-operaton.<nsPrefix>operaton-oneke.svc.cluster.local:8080
  username: ${CAMUNDA_ADMIN_USERNAME}  # operaton-admin-sa
  password: ${CAMUNDA_ADMIN_PASSWORD}  # store key `operaton`, property ADMIN_SA_PASSWORD
camundaPublicUrl: ${CAMUNDA_PUBLIC_URL} # browser-facing https://operaton.<domain>, for Cockpit deep links
```

Wired from `refresquito-services`' `charts/cnoe-oneke/templates/backstage-config.yaml`
+ `backstage-secret.yaml`, same pattern as `supersetAdmin`/`keycloakAdmin`.
