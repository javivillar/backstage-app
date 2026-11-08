import { Config } from '@backstage/config';

function camundaConfig(config: Config) {
  return config.getConfig('camundaAdmin');
}

/**
 * `engine-rest` auth against Operaton (operaton-oneke, the open-source fork
 * of Camunda 7 with the same REST API), as the `operaton-admin-sa` service
 * account. The config keys keep their historical `camundaAdmin.*` names so
 * existing deployments keep working. Unlike Superset (bearer token + CSRF
 * dance) or Keycloak (client-credentials grant), engine-rest's auth is
 * delegated straight to Operaton's Keycloak identity plugin: a plain HTTP
 * Basic header carrying a real Keycloak username/password is enough, no
 * token to cache or refresh.
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

/** Browser-facing Operaton base URL (config key `camundaPublicUrl`, kept for compatibility). */
export function camundaPublicUrl(config: Config): string {
  const url =
    config.getOptionalString('camundaPublicUrl') ??
    camundaConfig(config).getOptionalString('baseUrl') ??
    '';
  return url.replace(/\/+$/, '');
}

/**
 * Operaton serves its webapps under `/operaton/app/...` (the Camunda 7
 * `/camunda/app/...` paths answer 404 on Operaton).
 */
export const OPERATON_WEBAPP_PATH = '/operaton/app';

/** Deep link into Operaton Cockpit for one process definition id. */
export function cockpitProcessDefinitionUrl(publicUrl: string, definitionId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${OPERATON_WEBAPP_PATH}/cockpit/default/#/process-definition/${definitionId}`;
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
      `Failed to list versions of Operaton process "${processKey}": ${listRes.status} ${await listRes.text()}`,
    );
  }
  const versions = (await listRes.json()) as { id: string }[];
  for (const { id } of versions) {
    const delRes = await camundaFetch(config, `/process-definition/${encodeURIComponent(id)}?cascade=true`, {
      method: 'DELETE',
    });
    if (!delRes.ok && delRes.status !== 204) {
      throw new Error(
        `Failed to delete Operaton process "${processKey}" version ${id}: ${delRes.status} ${await delRes.text()}`,
      );
    }
  }
}
