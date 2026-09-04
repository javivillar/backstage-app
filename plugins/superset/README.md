# @internal/plugin-superset

Frontend half of Backstage's Superset self-service resource management — see
`@internal/backstage-plugin-superset-backend` (`plugins/superset-backend`)
for the backend actions/endpoints this talks to and the full feature
description.

Added 2026-09-04, same shape as `plugins/keycloak`.

## What's in here

- **`SupersetManagerPage.tsx`** — the `/superset-manager` page: a tabbed
  Connections/Datasets/Charts/Dashboards table (owner-filtered, or
  everything + an Owner column for `backstage-admin`).
  - Connections and datasets are fully editable from here: "New"/"Edit" go
    to the matching `superset-create-/update-*` scaffolder templates
    (`javivillar/backstage-templates`); "Delete" calls the manager
    backend's `DELETE` route directly (there's no delete *template* for
    these two, unlike Keycloak's objects — deleting doesn't need a form).
  - Charts and dashboards are provision-only: "New" goes to the
    `superset-provision-*` template, and each row's only action is
    "Open in Superset" — a deep link into Superset's own Explore/dashboard
    editor, since that's where chart/dashboard configuration actually
    happens (an interactive visual tool, not a form Backstage could
    usefully replicate).
  - Ownership enforcement lives entirely in the backend — this page never
    mutates anything for connections/datasets except the delete call, and
    even that just proxies to a backend route that re-checks ownership.

## Wiring

`packages/app/src/App.tsx` mounts `<Route path="/superset-manager"
element={<SupersetManagerPage />} />`. The sidebar link
(`packages/app/src/components/Root/Root.tsx`) is just a route string + a
generic MUI icon, so it doesn't import anything from this package.
