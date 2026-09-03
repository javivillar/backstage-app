import {
  DEFAULT_NAMESPACE,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { JsonArray } from '@backstage/types';
import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
  OAuthAuthenticatorResult,
} from '@backstage/plugin-auth-node';
import {
  oidcAuthenticator,
  OidcAuthResult,
} from '@backstage/plugin-auth-backend-module-oidc-provider';

// Backstage entity names must match ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ (max 63
// chars) — sanitize defensively since neither a Keycloak username nor a
// group name is guaranteed to already satisfy that.
function toEntityName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 63);
}

export const authModuleKeycloakOIDCProvider = createBackendModule({
  pluginId: 'auth',
  moduleId: 'keycloak-oidc',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
      },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'keycloak-oidc',
          factory: createOAuthProviderFactory({
            authenticator: oidcAuthenticator,
            profileTransform: async (
              input: OAuthAuthenticatorResult<OidcAuthResult>,
            ) => ({
              profile: {
                email: input.fullProfile.userinfo.email,
                picture: input.fullProfile.userinfo.picture,
                displayName: input.fullProfile.userinfo.name,
              },
            }),
            async signInResolver(info, ctx) {
              const { profile } = info;
              // preferred_username (Keycloak's actual username) over the
              // `name` claim (firstName + ' ' + lastName by Keycloak's
              // default mapper) — `name` almost always contains a space,
              // which is not a valid Backstage entity name and made
              // stringifyEntityRef throw for every user with a normal
              // first+last name, surfacing to the user as a bare
              // "access denied" on login (found + fixed 2026-09-03).
              const preferredUsername = info.result.fullProfile.userinfo
                .preferred_username as string | undefined;
              const identifier = preferredUsername ?? profile.displayName;
              if (!identifier) {
                throw new Error(
                  'Login failed: OIDC profile has neither preferred_username nor a display name',
                );
              }
              const userRef = stringifyEntityRef({
                kind: 'User',
                name: toEntityName(identifier),
                namespace: DEFAULT_NAMESPACE,
              });

              const groups =
                (info.result.fullProfile.userinfo.groups as string[]) || [];
              // Propagate Keycloak groups as ownership entity refs so backend
              // code (scaffolder actions, permission policies) can check
              // group membership via the userInfo service — without this,
              // `groups` only exists as an opaque custom claim nobody reads.
              const groupRefs = groups.map(g =>
                stringifyEntityRef({
                  kind: 'Group',
                  name: toEntityName(g),
                  namespace: DEFAULT_NAMESPACE,
                }),
              );

              return ctx.issueToken({
                claims: {
                  sub: userRef,
                  ent: [userRef, ...groupRefs],
                  groups: groups as JsonArray,
                },
              });
            },
          }),
        });
      },
    });
  },
});
