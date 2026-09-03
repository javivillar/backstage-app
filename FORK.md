# This fork vs. upstream CNOE

This repo tracks [`cnoe-io/backstage-app`](https://github.com/cnoe-io/backstage-app).
This page is the single place that records **everything that diverges from
upstream on `main`**, and how to safely pull in a newer upstream version
without losing or fighting that divergence.

## Fork point

The last commit shared with upstream on this `main` branch is
**`6a5087c`** ("Apply PEEKS patch and fix homepage links (#58)",
2026-06-10, upstream maintainer Pankaj Walke). Every commit after that —
starting with `27ba859` ("fix: restore Keycloak sign-in") — is
refresquito-specific work. To see the exact, current diff yourself:

```bash
git diff 6a5087c..main --stat
```

## What's different, in full

As of `main` = `f9f3cd3`, the entire divergence is **one feature** (Keycloak
self-service identity management) plus the minimal wiring it needs — nothing
else has drifted from upstream. Concretely:

**New, self-contained (upstream never touches these — see their own READMEs
for what's inside):**
- `plugins/keycloak-backend` — [README](plugins/keycloak-backend/README.md)
- `plugins/keycloak` — [README](plugins/keycloak/README.md)

**Wiring touches — small and mechanical, the only files a merge from
upstream can realistically conflict on:**
- `packages/backend/src/index.ts` — 4 `backend.add(...)` lines importing
  from `@internal/backstage-plugin-keycloak-backend`.
- `packages/app/src/App.tsx` — real Keycloak `SignInPage` (upstream hardcodes
  guest-only login, no auth), `/create` now renders `ScaffolderPage` with
  `CustomScaffolderPage` plugged in as `EXPERIMENTAL_TemplateListPageComponent`
  (upstream mounts `CustomScaffolderPage` and `ScaffolderPage` as two separate
  competing routes — see commit `cff6c21`), and the `/keycloak-manager` route.
- `packages/app/src/apis.ts` — spreads `keycloakApis` from the plugin instead
  of defining the API factory inline.
- `packages/app/src/components/Root/Root.tsx` — one sidebar `SidebarItem`.
- `packages/app/src/components/scaffolder/CustomScaffolderPage.tsx` — accepts
  `TemplateListPageProps` so it can plug into `ScaffolderPage` (type-only
  change, no logic).
- `packages/app/package.json` / `packages/backend/package.json` — one
  `@internal/plugin-keycloak` / `@internal/backstage-plugin-keycloak-backend`
  dependency line each.

**Confirmed byte-identical to upstream (verified with `git diff`, not
assumed):** `Dockerfile`, `app-config.yaml`, `app-config.production.yaml`,
`.github/workflows/*`, and — since the 2026-09-03 extraction into
`plugins/keycloak-backend` — `packages/backend/src/modules/scaffolder.ts`
(it briefly carried the Keycloak scaffolder actions inline; extracting them
restored it to upstream's exact content).

Where the Keycloak self-service catalog templates (`javivillar/backstage-templates`)
and the real `catalog.locations`/`keycloakAdmin` config get wired in is
**outside this repo entirely** — see `charts/cnoe-oneke/templates/
backstage-config.yaml` in `javivillar/refresquito-services`, which renders
the actual `app-config` the pod runs with. `app-config.yaml`/
`app-config.production.yaml` in *this* repo are upstream defaults and are
not what production actually uses.

## Merging a newer upstream version

1. **Add upstream and see the real current diff first**, don't trust this
   doc alone (it can go stale):
   ```bash
   git remote add upstream https://github.com/cnoe-io/backstage-app.git
   git fetch upstream
   git diff 6a5087c..main --stat        # what we've built on top
   git log 6a5087c..upstream/main --oneline   # what upstream did since we forked
   ```
2. **Merge or rebase `main` onto the new upstream commit/tag.** Conflicts
   should only be possible in the "wiring touches" files listed above — if a
   conflict shows up anywhere under `plugins/keycloak-backend` or
   `plugins/keycloak`, upstream has started touching a path with the same
   name as our plugin packages, which is unexpected and worth investigating
   rather than blindly resolving.
3. **Watch specifically for**: upstream restructuring `packages/app/src/App.tsx`'s
   `SignInPage`/routes (that's exactly where our biggest wiring diff lives),
   or renaming/removing `EXPERIMENTAL_TemplateListPageComponent` (it's an
   `@backstage/plugin-scaffolder` alpha API, upstream could change or drop it
   across a Backstage version bump).
4. **Verify with the exact 3 CI gates** (`.github/workflows/pr.yaml`) before
   pushing anything:
   ```bash
   yarn install --frozen-lockfile
   yarn tsc          # root tsconfig has include:[] — this is a fast no-op by design, don't rely on it alone
   yarn lint:all      # backstage-cli repo lint — the real per-package typecheck+lint gate
   yarn build:backend  # backstage-cli package build — bundles app+backend, the closest thing to a real build
   ```
5. **Deploy and smoke-test against the live cluster** before trusting the
   merge — there's no local idpbuilder dev loop set up for this deployment.
   Minimum bar, from inside the `cnoe-oneke-backstage` pod:
   ```js
   fetch('http://localhost:7007/api/catalog/entity-facets') // expect 401, NOT 503
   fetch('http://localhost:7007/create')                    // expect 200
   fetch('http://localhost:7007/api/keycloak-manager/users') // expect 401, NOT 503
   ```
   A 503 on `/catalog` specifically is the known failure mode here — see
   `plugins/keycloak-backend/README.md`'s note on `KEYCLOAK_CATALOG_SYNC`
   (disabled by default; a merge should not silently flip it on).
6. **Don't skip the ownership CRUD test** if the merge touched
   `plugins/keycloak-backend/src/actions.ts` or anything auth-related: log in
   as two different non-admin users, have one create a Keycloak object, and
   confirm the other gets rejected editing/deleting it.
