import { Config } from '@backstage/config';

// Activepieces REST API auth: a long-lived platform API key ("service"
// principal), sent as `Authorization: Bearer sk-...`. Created once by a
// platform admin (Activepieces UI or POST /v1/api-keys) and injected as
// `activepiecesAdmin.apiKey` -- see README.md.
//
// IMPORTANT: this key is PLATFORM-WIDE. Activepieces itself will happily
// let it read/modify every project, so per-user isolation is NOT provided
// by Activepieces for calls made with it -- it is enforced by this plugin
// (activepiecesAuthz.ts). Every route/action that acts on a project must go
// through requireProjectPermission() first.

function apConfig(config: Config) {
  return config.getConfig('activepiecesAdmin');
}

export async function apFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const ac = apConfig(config);
  const baseUrl = ac.getString('baseUrl').replace(/\/$/, '');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ac.getString('apiKey')}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${baseUrl}/api${path}`, { ...init, headers });
}

/** Like apFetch but parses JSON and throws a descriptive Error on non-2xx. */
export async function apJson<T>(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await apFetch(config, path, init);
  if (!res.ok) {
    throw new Error(`Activepieces ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface SeekPage<T> {
  data: T[];
  next: string | null;
}

/** Follows the `next` cursor of a SeekPage endpoint and returns every row. */
export async function apListAll<T>(config: Config, path: string): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  const sep = path.includes('?') ? '&' : '?';
  do {
    const page: SeekPage<T> = await apJson<SeekPage<T>>(
      config,
      `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    rows.push(...page.data);
    cursor = page.next;
  } while (cursor);
  return rows;
}

export function activepiecesPublicUrl(config: Config): string {
  return (
    config.getOptionalString('activepiecesPublicUrl') ??
    apConfig(config).getOptionalString('baseUrl') ??
    ''
  ).replace(/\/$/, '');
}

export function projectUrl(config: Config, projectId: string): string {
  return `${activepiecesPublicUrl(config)}/projects/${projectId}/flows`;
}

export function flowUrl(config: Config, projectId: string, flowId: string): string {
  return `${activepiecesPublicUrl(config)}/projects/${projectId}/flows/${flowId}`;
}
