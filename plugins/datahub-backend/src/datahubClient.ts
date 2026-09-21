import { Config } from '@backstage/config';

// DataHub GMS GraphQL client, authenticated with the plugin's own
// SERVICE_ACCOUNT token (`datahub.token`, from ESO/--set, never in git).
//
// PHASE 1 IS READ-ONLY. Two independent layers enforce it:
//   1. the token belongs to a service account that only has the Reader role
//      (verified live: every manage*/create* platform privilege is false);
//   2. this client refuses to send anything that is not a `query`.
// Phase 2 (templates) will add a separate, explicit write path with its own
// custom policy -- see BACKSTAGE-DATAHUB-DESIGN.md §7.1.

export class DatahubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface DatahubSettings {
  baseUrl: string;
  token: string;
  publicUrl: string;
  governedThreshold: number;
  accessGroups: string[];
  /** F2: the write path (scaffolder actions). OFF unless `datahub.writes.enabled: true`. */
  writesEnabled: boolean;
  /** Keycloak groups whose members may register/edit data products they own. */
  writeGroups: string[];
  /** Keycloak groups treated as data stewards (may act on any managed asset) -- open decision §12.3. */
  stewardGroups: string[];
  /** Steward owner URN set when a brief does not name one (only needed from Confidential up). */
  defaultSteward: string;
}

export const DEFAULT_ACCESS_GROUPS = ['datahub-admin', 'datahub-editor', 'datahub-viewer'];
export const DEFAULT_WRITE_GROUPS = ['datahub-admin', 'datahub-editor'];
export const DEFAULT_STEWARD_GROUPS = ['datahub-admin'];

/** undefined => the integration is not configured (no token/baseUrl): routes answer 503. */
export function datahubSettings(config: Config): DatahubSettings | undefined {
  const dh = config.getOptionalConfig('datahub');
  const baseUrl = dh?.getOptionalString('baseUrl')?.replace(/\/$/, '');
  const token = dh?.getOptionalString('token');
  if (!dh || !baseUrl || !token) return undefined;
  return {
    baseUrl,
    token,
    publicUrl: (dh.getOptionalString('publicUrl') ?? baseUrl).replace(/\/$/, ''),
    governedThreshold: dh.getOptionalNumber('governedThreshold') ?? 80,
    accessGroups: dh.getOptionalStringArray('accessGroups') ?? DEFAULT_ACCESS_GROUPS,
    writesEnabled: dh.getOptionalBoolean('writes.enabled') ?? false,
    writeGroups: dh.getOptionalStringArray('writes.groups') ?? DEFAULT_WRITE_GROUPS,
    stewardGroups: dh.getOptionalStringArray('writes.stewardGroups') ?? DEFAULT_STEWARD_GROUPS,
    defaultSteward: dh.getOptionalString('writes.defaultSteward') ?? 'urn:li:corpGroup:datahub-admin',
  };
}

const MUTATION = /(^|[^A-Za-z0-9_])(mutation|subscription)\b/i;

export async function datahubQuery<T>(
  settings: Pick<DatahubSettings, 'baseUrl' | 'token'>,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (MUTATION.test(query)) {
    throw new Error('datahub plugin phase 1 is read-only: refusing to send a non-query GraphQL operation');
  }
  let res: Response;
  try {
    res = await fetch(`${settings.baseUrl}/api/graphql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new DatahubError(`DataHub is not reachable: ${(e as Error).message}`, 502);
  }
  if (res.status === 401 || res.status === 403) {
    throw new DatahubError(`DataHub rejected the plugin's token (${res.status}); it may have expired or been revoked`, 502);
  }
  if (!res.ok) throw new DatahubError(`DataHub answered ${res.status}`, 502);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length && !body.data) {
    throw new DatahubError(`DataHub GraphQL error: ${body.errors[0].message}`, 502);
  }
  return body.data as T;
}
