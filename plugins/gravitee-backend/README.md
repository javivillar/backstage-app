# @internal/backstage-plugin-gravitee-backend

Self-service for **Gravitee APIM gateways** from the Backstage developer portal.
A "gateway" here is a Gravitee **v4 HTTP proxy API** on the shared gateway
(`<gravitee>/gateway/<path>/` → a backend URL). Backstage only does the *soft*
creation; plans, policies, documentation, publication and deployment stay in the
Gravitee Console.

## What it provides

| Piece | What |
|---|---|
| Manager plugin (`pluginId: gravitee-manager`) | `GET /api/gravitee-manager/apis` — the caller's gateways + their team's (read-only) + all of them for admins. `POST /api/gravitee-manager/apis` — create one. Backs the `/gravitee-manager` page (`managerPlugin.ts`) |

A new gateway is created **PRIVATE, STOPPED, unpublished and without plans**, so
it takes no traffic and is invisible in the Portal until its owner finishes it in
the Console.

**Deliberately no scaffolder actions.** Scaffolder task parameters are readable
by every Backstage user while the permission policy is allow-all
(refresquito-services#40), and nothing is registered in the Backstage catalog.

## Configuration

```yaml
graviteeAdmin:
  baseUrl: http://gravitee-oneke-apim-api.gravitee-oneke.svc.cluster.local:83/management
  username: ${GRAVITEE_ADMIN_USERNAME}     # gravitee-backstage-sa
  password: ${GRAVITEE_ADMIN_PASSWORD}
  # Keycloak password grant for the service account. Reuses Backstage's own
  # `backstage` client -- Gravitee accepts any token of the realm.
  tokenUrl: http://iam.<domain>/realms/RefresquitoTime/protocol/openid-connect/token
  clientId: backstage
  clientSecret: ${KEYCLOAK_CLIENT_SECRET}
  identityProvider: keycloak     # optional, Gravitee IdP id (default keycloak)
  gatewayPathPrefix: /gateway    # optional, the gateway Ingress path (no stripping)
graviteePublicUrl: http://gravitee.<domain>   # Console / gateway links only
keycloakAdmin: { ... }                        # already present (keycloak-backend)
```

Without `graviteeAdmin.baseUrl` + `graviteeAdmin.password` every route answers 503
and nothing else changes.

* **Service account** — `gravitee-backstage-sa`, a real Keycloak user in the
  `gravitee-admin` group (→ Gravitee `ORGANIZATION:ADMIN` + `ENVIRONMENT:ADMIN`).
  It logs in the way a browser does: Keycloak token →
  `POST /organizations/DEFAULT/auth/oauth2/keycloak/exchange` → Gravitee JWT
  (cached, renewed on 401). Password in the ESO store entry `backstage`.
* **Keycloak** — reuses the existing `keycloakAdmin` service account to resolve a
  Backstage username to its Keycloak id/email (Gravitee's `sourceId`) and to read
  the caller's **current** groups on every request.

## Authorization model (read this before changing anything)

The service account can see and modify **every** API, so inside Backstage the
isolation between users is enforced here, in one place: `graviteeAuthz.ts`.
It is deny-by-default. An API is returned only if the caller is

| Access | Rule | Can |
|---|---|---|
| `owner` | the API's Gravitee `PRIMARY_OWNER` is the caller's own Gravitee user | see, (F2) edit/delete, open in Console |
| `admin` | `group:default/backstage-admin`, or Keycloak group `gravitee-admin` | same, on every API |
| `team` | the API's metadata `backstage-team` is one of the caller's current `gravitee-team-*` groups | see, read-only |

Ownership is **Gravitee's own**, nothing is stored in Backstage: the service
account creates the API, tags it with the team, hands it over with
`_transfer-ownership` and removes its own membership, so the creator is the only
member. That gives a second, independent layer — in the Console, and through the
Management API with the user's own token, another user gets 403 (verified with
real logins, AUTHZ.md § gravitee-oneke §8). The `team` view exists **only in
Backstage**: a teammate opening the API in the Console still gets 403, which is
why their rows carry no Console link.

A user who has never logged into Gravitee is pre-registered (`source=keycloak`,
`sourceId=<Keycloak id>`) before becoming owner; their first SSO login binds to
that same user.

Creating requires being in at least one `gravitee-team-*` group, and the API can
only be tagged with one of the caller's own teams.
