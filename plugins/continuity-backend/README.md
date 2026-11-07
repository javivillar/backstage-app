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

## What is common and what is per zone

The platform is installed in many zones and programmes from the same git repository, so a profile in git holds
only what is common to every zone: the records and how they are exported (`method`, `format`, `schedule`,
`workflow`), the trust anchors (`id`, `title`, `kind`, `probe`, `notes`), the exit plan and the platform-wide policy
approval (`status`, `approvedBy`, `approvedAt`, by pull request). Facts of one zone never live in git, or they would
show in every zone and leak between them:

| Fact of the zone | Today (L1) | Later |
| --- | --- | --- |
| The export of a record runs | `exportActive: false` (`isExportActive`) | L2: a CronWorkflow of this zone runs `export.workflow` |
| Ceremony of a trust anchor (key generated, offline copy, custodians) | `ceremony: 'unrecorded'` (`ceremonyOf`) | L3: recorded from the portal in this zone's Backstage database |
| What is installed | the Components of this cluster's catalog | |

Profiles of continuity-oneke 0.1.0 still render: `trustAnchors[].offlineCopy`, `custodians`, `lastCeremony` and
`records[].export.status` are ignored, with one warning per file.

**Only what is installed counts.** A profile is installed when this cluster's catalog has a Component with
`metadata.name` equal to its `service` (one per deployed application, plus cnoe-oneke; read with the plugin's own
service credentials); `lifecycle: external` is always present (`external: true`). If the catalog cannot be read,
everything counts as installed and a warning says so. The KPIs, the attention list and the trust anchors take only
the installed profiles and the externals; the others are listed in `notInstalled` without state.

## API (signed-in users)

- `GET /api/continuity/summary`: `{profiles, notInstalled, trustAnchors, attention, counts, warnings}`.
  - `profiles[]` (installed + externals): each profile as written plus `file`, `installed`, `external`,
    `records[].exportActive`, `recordsTotal` (records of kind `record`), `recordsWithoutActiveExport`, `state`
    (`ok` | `warning` | `critical`), `stateReason` and `reasons[]` (`{level, key, title, detail, vars}`; the page
    translates `key`; `title` and `detail` are English).
  - `notInstalled[]`: `{service, title, tier}`.
  - `trustAnchors[]`: the anchors of the installed profiles, each with `service`, `ceremony` and `live`
    (`{notAfter, notBefore, subject, daysLeft}`) or `liveError`.
  - `attention[]`: the critical items per service, then one aggregated item each (empty `service`) for `drafts`
    (`vars {n, services}`), `ceremonies-unrecorded` (`vars {n}`) and, when more than 5 services have them,
    `exports-missing` (`vars {n, services}`), then the other warnings per service.
- `GET /api/continuity/profiles/:service`: one profile (installed or not) with its computed fields; its
  `trustAnchors` carry `ceremony` and `live`. 404 when there is none.

## State rules (`src/status.ts`, pure)

| Level | Key | When |
| --- | --- | --- |
| critical | `external-no-export` | lifecycle `external` and a record without an active export in this zone (knowledge and evidence only outside the zone) |
| warning | `record-no-export` | a record without an active export in this zone (every record, in L1) |
| warning | `deprecated` / `deprecated-replaced` | lifecycle `deprecated` (with `replacedBy`) |
| warning | `draft` | status `draft` (not yet approved by the group `continuity-officer`) |
| warning | `cert-expiring` | a live certificate with less than 90 days left |

The unrecorded ceremonies are not a reason of a profile; they show only as the aggregated attention item.

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
sample profiles, two of them in the 0.1.0 format, a test root + intermediate CA, a Keycloak-style key certificate).
