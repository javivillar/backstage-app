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

/**
 * `DELETE /process-definition/key/{key}` only removes the LATEST version
 * (verified live, 2026-09-06) — a key with any history (i.e. ever redeployed
 * via camunda:update-process) is left with older versions still active and
 * visible after that call, silently defeating "delete this process". Delete
 * every version's own id individually instead.
 */
export async function deleteAllProcessDefinitionVersions(
  config: Config,
  processKey: string,
): Promise<void> {
  const listRes = await camundaFetch(config, `/process-definition?key=${encodeURIComponent(processKey)}`);
  if (!listRes.ok) {
    throw new Error(
      `Failed to list versions of Camunda process "${processKey}": ${listRes.status} ${await listRes.text()}`,
    );
  }
  const versions = (await listRes.json()) as { id: string }[];
  for (const { id } of versions) {
    const delRes = await camundaFetch(config, `/process-definition/${encodeURIComponent(id)}?cascade=true`, {
      method: 'DELETE',
    });
    if (!delRes.ok && delRes.status !== 204) {
      throw new Error(
        `Failed to delete Camunda process "${processKey}" version ${id}: ${delRes.status} ${await delRes.text()}`,
      );
    }
  }
}
