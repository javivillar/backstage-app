import { DatahubError, DatahubSettings } from './datahubClient';
import { PlannedType, Proposal } from './plan';

// The ONLY module that writes to DataHub (F2). REST OpenAPI v3, authenticated
// with the plugin's service-account token; what that token may touch is decided
// by DataHub's own policy (assets of the four types, NO vocabulary/platform
// privileges -- verified live 2026-09-21). Payload shapes are documented next
// to each call and verified live by the F2 end-to-end check.

type Writer = Pick<DatahubSettings, 'baseUrl' | 'token'>;

/**
 * Synchronous writes (`async=false`) wait for DataHub to persist and index every aspect, which can
 * take well over 30 s for an asset with many aspects (seen live 2026-09-21). On a timeout the write
 * MAY STILL HAVE BEEN APPLIED, so callers must treat that outcome as unknown (register.ts does).
 */
const WRITE_TIMEOUT_MS = 120_000;

async function rest(s: Writer, method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(`${s.baseUrl}/openapi/v3${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new DatahubError(`DataHub did not answer (${(e as Error).message}); the write may or may not have been applied`, 502);
  }
  return { status: res.status, text: await res.text() };
}

/** Upserts every aspect of a proposal in ONE call (synchronous, so a failure surfaces here, not later). */
export async function upsertProposal(s: Writer, p: Proposal): Promise<void> {
  const entity: Record<string, unknown> = { urn: p.urn };
  for (const [aspect, value] of Object.entries(p.aspects)) entity[aspect] = { value };
  const r = await rest(s, 'POST', `/entity/${p.entityType}?async=false`, [entity]);
  if (r.status < 200 || r.status >= 300) {
    throw new DatahubError(`DataHub refused the write of ${p.urn}: ${r.status} ${r.text.slice(0, 300)}`, r.status === 403 ? 403 : 502);
  }
}

/**
 * Undo of a run that failed half way: SOFT delete (`status.removed = true`), which hides the asset
 * from search and pages and is reversible. It deliberately does NOT use `DELETE`: the service
 * account has no DELETE_ENTITY privilege (verified live 2026-09-21: 403 "unauthorized to DELETE
 * entities") and granting it would let the token hard-delete ANY asset of the four types, including
 * ingested ones. Re-registering the same asset revives it (every proposal carries `status.removed=false`).
 */
export async function softDeleteEntity(s: Writer, type: PlannedType, urn: string): Promise<void> {
  await upsertProposal(s, { entityType: type, urn, aspects: { status: { removed: true } } });
}

/** The current `value` of one aspect, or undefined if the entity/aspect does not exist. */
export async function getAspect<T>(s: Writer, type: PlannedType, urn: string, aspect: string): Promise<T | undefined> {
  const r = await rest(s, 'GET', `/entity/${type}/${encodeURIComponent(urn)}?aspects=${aspect}`);
  if (r.status === 404) return undefined;
  if (r.status < 200 || r.status >= 300) throw new DatahubError(`Could not read ${aspect} of ${urn}: ${r.status}`, 502);
  return (JSON.parse(r.text)?.[aspect]?.value as T | undefined) ?? undefined;
}
