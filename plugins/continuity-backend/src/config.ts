import type { LoggerService, RootConfigService } from '@backstage/backend-plugin-api';
import type { ContinuitySettings } from './service';

/**
 * continuity (app-config, rendered by the chart cnoe-oneke):
 *   profilesDir: /continuity/profiles   # the ConfigMap continuity-profiles (one <service>.yaml per service)
 *   trustDir: /continuity/trust         # optional: platform-ca.pem (root + intermediate CA of the platform)
 * The realm keys of Keycloak are read with keycloakAdmin.{baseUrl, realm, clientId, clientSecret} when it is set.
 * No profilesDir: undefined, the plugin answers 503 (the page says the portal is not configured).
 */
export function continuitySettings(config: RootConfigService, logger: LoggerService): ContinuitySettings | undefined {
  const c = config.getOptionalConfig('continuity');
  const profilesDir = c?.getOptionalString('profilesDir');
  if (!profilesDir) {
    logger.info('continuity.profilesDir is not set: the Continuity portal is off');
    return undefined;
  }
  const kc = config.getOptionalConfig('keycloakAdmin');
  const keycloak =
    kc?.getOptionalString('baseUrl') && kc.getOptionalString('realm') && kc.getOptionalString('clientId') && kc.getOptionalString('clientSecret')
      ? { baseUrl: kc.getString('baseUrl'), realm: kc.getString('realm'), clientId: kc.getString('clientId'), clientSecret: kc.getString('clientSecret') }
      : undefined;
  return { profilesDir, trustDir: c?.getOptionalString('trustDir'), keycloak };
}
