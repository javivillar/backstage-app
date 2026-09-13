# @internal/backstage-plugin-seaweedfs-backend

Backend half of Backstage's SeaweedFS self-service resource management: any
signed-in Backstage user can provision their own SeaweedFS (`seaweedfs-oneke`)
buckets, S3 Table Buckets, IAM Groups, and IAM Policies, and only they (or a
`backstage-admin` member) can see or manage them afterwards.

For the full security model (why ownership is native for buckets/table
buckets but bolted-on for groups/policies, the `seaweedfsAdmin` service
account trade-off, test accounts, how to test cross-user isolation) see the
**Backstage↔SeaweedFS section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` — this README covers the code, that doc covers the
auth/authz story end to end.

Following the same extraction convention already used for
`plugins/keycloak-backend`/`plugins/superset-backend`/`plugins/camunda-backend`
— new functionality lives isolated in its own plugin from day one instead of
inline in `packages/backend`.

## What's in here

- **`seaweedfsClient.ts`** — auth against the SeaweedFS Admin UI's own JSON
  REST API (`/api/...`) as a static account (`seaweedfsAdmin.username`/
  `.password`). Unlike Camunda's HTTP-Basic SA or Superset's DB-login SA,
  this isn't a dedicated Keycloak-backed identity — SeaweedFS's native form
  login (`/login`) genuinely has no multi-user concept, it's a single shared
  static admin account (same one a human admin would use). Logs in once
  (scrapes the `csrf_token` off the login page, POSTs the form, caches the
  resulting `admin-session` cookie), then scrapes the CSRF meta tag off an
  authenticated page for the `X-CSRF-Token` header sent on every mutating
  call. Per-user attribution for isolation comes entirely from the
  `owner`/ownership-ledger fields this plugin sets on objects it creates, not
  from SeaweedFS's own session identity.
- **`ownership.ts`** — two shapes, chosen per resource type, same idea as
  Superset's native-vs-bolted-on split:
  - Buckets & Table Buckets have a real, native `owner` field SeaweedFS
    itself persists (`weed/admin/dash/bucket_management.go`'s
    `owner`/`UpdateBucketOwner`, `s3tables_management.go`'s
    `SetTableBucketOwner`) — simple string comparison, `requireOwnerOrAdmin`.
  - IAM Groups and Policies have **no** owner/extra field at all
    (`iam_pb.Group` is just `{Name, Members, PolicyNames, Disabled}`; a
    policy is a flat `map[string]PolicyDocument`) — no bolt-on point exists
    on the object itself, unlike Superset's Database `extra` JSON column.
    Ownership is tracked in Backstage's own database instead, a small
    `seaweedfs_ownership` table (`ensureOwnershipTable` — a plain "create if
    missing" check, not Backstage's usual migrations-file convention; a
    deliberate simplification for this one small table). **Only
    `managerPlugin.ts` touches this table directly** — see the
    `ownershipClient.ts` entry below for why.
- **`ownershipClient.ts`** — HTTP client the scaffolder actions use to reach
  `managerPlugin.ts`'s ownership table, instead of calling `ownership.ts`'s
  Knex helpers directly. **Real bug this fixes** (found live 2026-09-13,
  see AUTHZ.md §16b): `seaweedfs:create-/delete-group/policy` are
  registered via `createBackendModule({ pluginId: 'scaffolder', ... })` — a
  hard requirement of `scaffolderActionsExtensionPoint`, can't target any
  other pluginId — so `coreServices.database` there resolves to
  `backstage_plugin_scaffolder`. `managerPlugin.ts` is its own
  `createBackendPlugin({ pluginId: 'seaweedfs-manager' })`, whose
  `coreServices.database` resolves to `backstage_plugin_seaweedfs-manager`
  — a totally different Postgres database. Writing ownership from the
  actions side used to land in the wrong database, silently, forever
  (groups/policies created fine in SeaweedFS but never showed up in
  `/seaweedfs-manager`, not even to their own creator). Fixed by giving
  `managerPlugin.ts` 3 internal, service-to-service-only routes
  (`POST`/`GET`/`DELETE /internal/ownership*`, gated with
  `httpAuth.credentials(req, { allow: ['service'] })` so a real end-user
  token is rejected outright) and having `ownershipClient.ts` call those
  via `coreServices.discovery.getBaseUrl('seaweedfs-manager')` +
  `coreServices.auth.getPluginRequestToken({ onBehalfOf:
  getOwnServiceCredentials(), targetPluginId: 'seaweedfs-manager' })` —
  one writer, one database, one set of rows. This is the general shape any
  future Backstage plugin pair here should follow whenever a scaffolder
  action and a sibling manager plugin need to share state neither side can
  derive from the target system's own API.
- **`seaweedfs-actions.ts`** — 8 scaffolder actions (create/delete × bucket,
  table bucket, group, policy). Creating a bucket does more than set
  `owner`: SeaweedFS's own File Browser is deny-by-default for non-admins
  (`bucket_authz.go`'s `CanAccessPath`), so the action also creates a
  bucket-scoped policy (`S3Bucket-<name>-OwnerPolicy`), ensures the caller
  has a SeaweedFS Identity (native OIDC login already JIT-provisions one —
  this call tolerates "already exists"), and attaches the policy to that
  Identity — otherwise the bucket's creator couldn't actually open it in the
  real File Browser afterward. Table buckets don't need this (they live
  under a filer path `CanAccessPath` doesn't cover at all). The group/policy
  actions take `auth`+`discovery` (for `ownershipClient.ts`), not
  `database` — see above.
- **`managerPlugin.ts`** — list/delete routes backing the
  `/seaweedfs-manager` frontend page for all four resource types, plus
  `POST`/`DELETE /groups/:name/policies(/:policy)` for the group-edit policy
  picker — re-checks ownership of **both** the group and the policy being
  attached server-side (the frontend already only offers the caller's own
  policies, but that's never the real access control on its own). Also
  owns the internal `/internal/ownership*` routes described above.

**Known scope limit, stated explicitly, not hidden**: SeaweedFS's own
Admin UI has no per-object visibility restriction on Groups/Policies — their
list/get routes aren't role-gated, only the mutating ones are (`role=="admin"`
required to create/edit/delete any of the four resource types at all, via
`wrapWrite`). So isolation for Groups/Policies is enforced **only** by this
plugin's manager layer; an admin browsing SeaweedFS's own UI directly always
sees everything, same as Camunda's group-wide READ being "by design".

## Config

```yaml
seaweedfsAdmin:
  baseUrl: ${SEAWEEDFS_ADMIN_BASE_URL}   # the PUBLIC admin-seaweedfs.<domain> hostname, not
                                          # an in-cluster Service address -- the Service's
                                          # NetworkPolicy restricts its port to the Ingress
                                          # controller namespace / oauth2-proxy pods, and this
                                          # plugin's pod is in neither. Going through the same
                                          # public Ingress path every browser uses sidesteps
                                          # that with zero NetworkPolicy changes.
  username: ${SEAWEEDFS_ADMIN_USERNAME}  # reuses seaweedfs-oneke's existing admin.adminUser
  password: ${SEAWEEDFS_ADMIN_PASSWORD}  # reuses seaweedfs-oneke's existing admin.adminPassword
seaweedfsPublicUrl: ${SEAWEEDFS_PUBLIC_URL} # optional; falls back to seaweedfsAdmin.baseUrl
```

Wired from `refresquito-services`' `charts/cnoe-oneke/templates/backstage-config.yaml`
+ `backstage-secret.yaml`, same pattern as `supersetAdmin`/`camundaAdmin`.
