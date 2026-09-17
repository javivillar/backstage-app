# @internal/backstage-plugin-alfresco-backend

Backend half of Backstage's Alfresco self-service resource management: any
signed-in Backstage user can create their own Alfresco (`alfrescodms-oneke`)
**Sites**, and manage that site's members/roles — no Alfresco global-admin
rights (`GROUP_ALFRESCO_ADMINISTRATORS`) required, matching Alfresco's own
native default (any authenticated user can create a site and becomes its
`SiteManager`).

For the full security model (why authorization here is a *live* check
against Alfresco's own native role instead of a stored ownership table, the
two-user isolation test, the `backstage-alfresco-sa` account) see the
**Backstage↔Alfresco section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` — this README covers the code, that doc covers the
auth/authz story end to end.

Following the same extraction convention already used for
`plugins/keycloak-backend`/`plugins/superset-backend`/`plugins/camunda-backend`/
`plugins/seaweedfs-backend`.

## What's in here

- **`alfrescoClient.ts`** — HTTP Basic Auth against Alfresco's Public REST
  API as a technical account (`alfrescoAdmin.username`/`.password`).
  Verified live: Keycloak Bearer JWTs are rejected outright by this API, and
  a ticket cannot be used as a Basic-Auth username either — Basic Auth is
  simplest and has no session/expiry to manage.
- **`alfrescoAuthz.ts`** — `requireSiteManagerOrAdmin` does a **live**
  `GET /sites/{id}/members/{username}` check against Alfresco itself, rather
  than a Backstage-side ownership table (contrast with
  `seaweedfs-backend/ownership.ts`'s bolted-on table for groups/policies):
  Alfresco already exposes a rich, authoritative native per-site role
  (`SiteManager`/`SiteCollaborator`/`SiteContributor`/`SiteConsumer`), so a
  promotion/demotion done directly in Share is honored immediately with no
  risk of drift. The portal-wide `backstage-admin` group remains the
  cross-cutting override, same as every other manager plugin — independent
  from Alfresco's own `alfrescodms-admin` group, which this plugin never
  touches.
- **Identity gotcha, load-bearing**: Alfresco's `Person.id` is keyed by
  **username** (`preferred_username`), NOT email — confirmed live
  2026-09-17 while building this plugin, which also surfaced a real,
  already-fixed production bug: `sync-site-groups.py` (the
  `site-group-sync` CronJob) was still resolving person ids by email, a
  stale convention from before the 2026-09-14 Share↔repo identity-mismatch
  fix. That left it silently granting access to an orphaned Person nobody
  actually authenticates as. This plugin resolves everything by username
  from the start.
- **`alfresco-actions.ts`** — `alfresco:create-site` / `alfresco:delete-site`
  scaffolder actions. Creating a site: (1) pre-provisions the caller's
  Alfresco Person via `POST /people` if it doesn't exist yet — verified live
  to work with **no prior Share login required**, unlike `site-group-sync`'s
  JIT-only limitation (TODO.md case 3); (2) `POST /sites` as the technical
  account (which lands as its `SiteManager` by default); (3) explicitly adds
  the real caller as `SiteManager`; (4) removes the technical account's own
  membership so ownership is unambiguous (it retains repo-wide access via
  `GROUP_ALFRESCO_ADMINISTRATORS` regardless of site membership).
- **`managerPlugin.ts`** — routes backing the `/alfresco-manager` frontend
  page: `GET/DELETE /sites`, `GET/POST /sites/:id/members`,
  `DELETE /sites/:id/members/:personId`. Every mutating route re-checks
  `requireSiteManagerOrAdmin` server-side — the frontend hiding a button is
  never the real access control.

## Config

```yaml
alfrescoAdmin:
  baseUrl: ${ALFRESCO_ADMIN_BASE_URL}     # in-cluster Service DNS, e.g.
                                            # http://alfrescodms-oneke-alfresco-repository.alfrescodms-oneke.svc.cluster.local
  username: ${ALFRESCO_ADMIN_USERNAME}    # a dedicated backstage-alfresco-sa account in
                                            # GROUP_ALFRESCO_ADMINISTRATORS -- NOT admin/admin
                                            # (INTEGRATION.md explicitly warns against reusing
                                            # that for automated integrations)
  password: ${ALFRESCO_ADMIN_PASSWORD}
alfrescoPublicUrl: ${ALFRESCO_PUBLIC_URL}  # optional; falls back to alfrescoAdmin.baseUrl
```

Wired from `refresquito-services`' `charts/cnoe-oneke/templates/backstage-config.yaml`
+ `backstage-secret.yaml`, same pattern as `supersetAdmin`/`camundaAdmin`/`seaweedfsAdmin`.
