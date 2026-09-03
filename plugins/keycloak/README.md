# @internal/plugin-keycloak

Frontend half of Backstage's Keycloak self-service identity management — see
`@internal/backstage-plugin-keycloak-backend` (`plugins/keycloak-backend`) for the
backend actions/endpoints this talks to and the full feature description.

Extracted 2026-09-03 from `packages/app/src/components/keycloak-manager/
KeycloakManagerPage.tsx` and part of `packages/app/src/apis.ts` — pure move, no
behavior change.

## What's in here

- **`KeycloakManagerPage.tsx`** — the `/keycloak-manager` page: a tabbed
  Users/Groups/Clients table (owner-filtered, or everything + an Owner column for
  `backstage-admin`), with "New"/"Edit"/"Delete" buttons that navigate to the
  matching `keycloak-create-/update-/delete-*` scaffolder templates
  (`javivillar/backstage-templates`) rather than mutating anything itself —
  ownership enforcement lives in exactly one place, the backend actions.
- **`apis.ts`** — `keycloakOIDCAuthApiRef` + its `OAuth2`-based API factory
  (`keycloakApis`), the `keycloak-oidc` sign-in provider's frontend half.

## Wiring

`packages/app/src/apis.ts` spreads `keycloakApis` into the app's `apis` array;
`packages/app/src/App.tsx` mounts `<Route path="/keycloak-manager"
element={<KeycloakManagerPage />} />` and uses `keycloakOIDCAuthApiRef` for the
Keycloak `SignInPage` provider. The sidebar link itself
(`packages/app/src/components/Root/Root.tsx`) is just a route string + a generic
MUI icon, so it doesn't import anything from this package.
