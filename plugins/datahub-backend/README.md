# datahub-backend (phase 1 — READ ONLY)

Backend of the DataHub integration (`pluginId: datahub-manager`). Design:
`BACKSTAGE-DATAHUB-DESIGN.md` in `refresquito-services`.

Serves the entity card / *Data governance* tab / `/datahub` catalog page of
`plugins/datahub`. There is **no write path**: the GraphQL client refuses
anything that is not a `query`, and the service-account token only has the
DataHub *Reader* role.

## Routes (all gated)

| Route | Returns |
|---|---|
| `GET /assets/summary?urn=` | normalized asset (owners, domain, tags, terms, classification, retention, …) + completeness score |
| `GET /assets/score?urn=` | score + per-check breakdown only |
| `GET /search?query=&type=&gaps=&start=&count=` | assets with their score; `gaps=true` keeps the ungoverned ones of the page |
| `GET /vocabulary` | existing domains, glossary terms, tags and structured-property allowed values |

The URN goes in the query string, not the path: URNs contain `/`, `(` and `,`.

## Authorization

DataHub sees one platform-wide service account, so the per-user rule is here
(`datahubAuthz.ts`): the caller must be in a Keycloak group listed in
`datahub.accessGroups` (default `datahub-admin`, `datahub-editor`,
`datahub-viewer` — the same requirement DataHub's own Keycloak login enforces)
or in `group:default/backstage-admin`. Deny by default. Each call is logged
with the Backstage user (DataHub's logs only show the service account).

## Config

```yaml
datahub:
  baseUrl: ${DATAHUB_BASE_URL}     # GMS, e.g. http://datahub-oneke-gms.datahub-oneke.svc.cluster.local:8080
  token: ${DATAHUB_TOKEN}          # SERVICE_ACCOUNT token (Reader role); from ESO / --set, never in git
  publicUrl: ${DATAHUB_PUBLIC_URL} # links shown to the user
  governedThreshold: 80            # optional; score >= this counts as "governed"
  accessGroups: [datahub-admin, datahub-editor, datahub-viewer]   # optional
```

Without `baseUrl`/`token` every route answers `503` (the rest of Backstage is unaffected).
GMS only admits Backstage if the chart's `networkPolicy.backstage.enabled` is on.

## Catalog annotations

`datahub.io/dataset`, `datahub.io/data-product`, `datahub.io/flow` (a URN each)
make the card and tab appear on the entity.
