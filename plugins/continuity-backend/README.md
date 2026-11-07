# continuity-backend

The backend of the **Continuity** portal (page `/continuity`, console `/console/continuity`): the digital continuity
of the platform, read only. Whether what each platform service keeps can be found, opened, understood and held
valid for decades. This is different from disaster recovery: DR brings a service back; continuity keeps its records
readable and provable long after the service, the vendor or the key that signed them are gone.

The profiles are files of the chart `continuity-oneke` in refresquito-services
(`charts/continuity-oneke/files/profiles/<service>.yaml`, schema `continuity.schema.json` v1), published as the
ConfigMap `continuity-profiles` and mounted in the Backstage pod by the chart `cnoe-oneke`. Changes go by pull
request to that repository; this plugin never writes.

## Config

```yaml
continuity:
  profilesDir: /continuity/profiles   # required: the ConfigMap continuity-profiles, one <service>.yaml per service
  trustDir: /continuity/trust         # optional: platform-ca.pem = the root + intermediate CA of the platform (PEM)
keycloakAdmin:                        # optional (the Keycloak manager's service account): realm keys, GET /keys
  baseUrl: ...
  realm: ...
  clientId: ...
  clientSecret: ...
```

Without `continuity.profilesDir`, or with a directory that cannot be read, every endpoint answers **503** and the
page shows a warning. A file that is not a profile (no `service`) or a value outside the schema is reported in
`warnings`, not as an error. Hidden entries of the ConfigMap volume (`..data`) are skipped.

## API (signed-in users)

- `GET /api/continuity/summary`: `{profiles, trustAnchors, attention, counts, warnings}`.
  - `profiles[]`: each profile as written plus `file`, `recordsTotal` (records of kind `record`),
    `recordsWithoutActiveExport` (kind `record` with no export or export status other than `active`), `state`
    (`ok` | `warning` | `critical`), `stateReason` (the key of its most severe reason) and `reasons[]`
    (`{level, key, title, detail, vars}`; the page translates `key`, `title` and `detail` are English).
  - `trustAnchors[]`: the anchors of every profile, each with `service` and `live` (`{notAfter, notBefore, subject,
    daysLeft}`) or `liveError`.
  - `attention[]`: one entry per cause of a warning or critical state, critical first; the drafts are ONE entry
    (`key: drafts`, empty `service`, `vars: {n, services}`) right after the critical ones, not one per service
    (the `draft` reason stays on each profile).
- `GET /api/continuity/profiles/:service`: one profile with its computed fields; its `trustAnchors` carry `live`.
  404 when there is none.

## State rules (`src/status.ts`, pure)

| Level | Key | When |
| --- | --- | --- |
| critical | `external-no-export` | lifecycle `external` and a record without an active export (knowledge only outside the zone) |
| critical | `anchor-no-offline` | a trust anchor with `offlineCopy: no` |
| warning | `record-no-export` | a record without an active export |
| warning | `deprecated` / `deprecated-replaced` | lifecycle `deprecated` (with `replacedBy`) |
| warning | `draft` | status `draft` (not yet approved by the group `continuity-officer`) |
| warning | `anchor-offline-unknown` | a trust anchor with `offlineCopy: unknown` |
| warning | `cert-expiring` | a live certificate with less than 90 days left |

## Live trust anchors

- kind `ca`: matched to a certificate of `trustDir/platform-ca.pem`. An anchor whose probe, id or title says
  `intermediate` takes the certificate that is not self-signed; any other takes the self-signed one (the root).
- probe `keycloak:realm-keys` (or kind `realm-keys` without probe): `GET /admin/realms/<realm>/keys` with a
  client_credentials token of `keycloakAdmin`; the active RS256 signing key with the highest priority. A 403
  (the service account lacks `view-realm`) is a warning. Kept 5 minutes.
- other kinds (`signing-key`, `passphrase`): not probed.

Certificates are parsed with Node's `crypto.X509Certificate`; YAML with `yaml`.

## Tests

`yarn workspace @internal/backstage-plugin-continuity-backend test --watchAll=false` (fixtures in `src/__fixtures__`:
sample profiles, a test root + intermediate CA, a Keycloak-style key certificate).
