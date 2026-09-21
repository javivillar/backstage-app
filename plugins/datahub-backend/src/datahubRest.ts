import { DatahubError, DatahubSettings } from './datahubClient';
import { PlannedType } from './plan';

// Small REST (OpenAPI v3) helpers shared by the read path (is this asset soft-deleted?) and the
// write path (datahubWriter.ts). Nothing here writes on its own.

type Rest = Pick<DatahubSettings, 'baseUrl' | 'token'>;

/**
 * Synchronous writes (`async=false`) wait for DataHub to persist and index every aspect and can
 * take a long time (a 30 s timeout was hit once live). On a timeout the write MAY STILL HAVE BEEN
 * APPLIED, so callers must treat that outcome as unknown (register.ts does).
 */
export const WRITE_TIMEOUT_MS = 120_000;

export async function rest(
  s: Rest,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = WRITE_TIMEOUT_MS,
): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(`${s.baseUrl}/openapi/v3${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new DatahubError(`DataHub did not answer (${(e as Error).message}); the write may or may not have been applied`, 502);
  }
  return { status: res.status, text: await res.text() };
}

/** The current `value` of one aspect, or undefined if the entity/aspect does not exist. */
export async function getAspect<T>(s: Rest, type: PlannedType, urn: string, aspect: string): Promise<T | undefined> {
  const r = await rest(s, 'GET', `/entity/${type}/${encodeURIComponent(urn)}?aspects=${aspect}`, undefined, 20_000);
  if (r.status === 404) return undefined;
  if (r.status < 200 || r.status >= 300) throw new DatahubError(`Could not read ${aspect} of ${urn}: ${r.status}`, 502);
  return (JSON.parse(r.text)?.[aspect]?.value as T | undefined) ?? undefined;
}

/**
 * A soft-deleted asset (what the undo of a failed registration leaves behind) still answers
 * `exists: true` over GraphQL, and GraphQL's DataProduct has no `status` field, so the `status`
 * aspect is read over REST. Reads/searches must treat such an asset as missing.
 */
export async function isSoftDeleted(s: Rest, type: PlannedType, urn: string): Promise<boolean> {
  return (await getAspect<{ removed?: boolean }>(s, type, urn, 'status'))?.removed === true;
}
