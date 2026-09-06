import { Config } from '@backstage/config';

function camundaConfig(config: Config) {
  return config.getConfig('camundaAdmin');
}

/**
 * `engine-rest` auth against Camunda, as the `camunda-backstage-sa` service
 * account. Unlike Superset (bearer token + CSRF dance) or Keycloak
 * (client-credentials grant), engine-rest's auth is delegated straight to
 * the Keycloak identity plugin (`camunda.bpm.run.auth.enabled: true` — see
 * AUTHZ.md § bpm-oneke §4): a plain HTTP Basic header carrying a real
 * Keycloak username/password is enough, no token to cache or refresh.
 */
export async function camundaFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cc = camundaConfig(config);
  const baseUrl = cc.getString('baseUrl');
  const username = cc.getString('username');
  const password = cc.getString('password');
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  return fetch(`${baseUrl}/engine-rest${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${basic}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function camundaPublicUrl(config: Config): string {
  return (
    config.getOptionalString('camundaPublicUrl') ??
    camundaConfig(config).getOptionalString('baseUrl') ??
    ''
  );
}
