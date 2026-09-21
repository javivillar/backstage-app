import { DatahubError, DatahubSettings } from './datahubClient';
import { PlannedType, Proposal } from './plan';

// The ONLY module that writes to DataHub (F2). REST OpenAPI v3, authenticated
// with the plugin's service-account token; what that token may touch is decided
// by DataHub's own policy (assets of the four types, NO vocabulary/platform
// privileges -- verified live 2026-09-21). Payload shapes are documented next
// to each call and verified live by the F2 end-to-end check.

type Writer = Pick<DatahubSettings, 'baseUrl' | 'token'>;

async function rest(s: Writer, method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(`${s.baseUrl}/openapi/v3${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new DatahubError(`DataHub is not reachable: ${(e as Error).message}`, 502);
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

/** Removes an entity (undo of a run that failed half way). A missing entity counts as removed. */
export async function deleteEntity(s: Writer, type: PlannedType, urn: string): Promise<void> {
  const r = await rest(s, 'DELETE', `/entity/${type}/${encodeURIComponent(urn)}`);
  if (r.status !== 404 && (r.status < 200 || r.status >= 300)) {
    throw new DatahubError(`Could not remove ${urn}: ${r.status} ${r.text.slice(0, 200)}`, 502);
  }
}

/** The current `value` of one aspect, or undefined if the entity/aspect does not exist. */
export async function getAspect<T>(s: Writer, type: PlannedType, urn: string, aspect: string): Promise<T | undefined> {
  const r = await rest(s, 'GET', `/entity/${type}/${encodeURIComponent(urn)}?aspects=${aspect}`);
  if (r.status === 404) return undefined;
  if (r.status < 200 || r.status >= 300) throw new DatahubError(`Could not read ${aspect} of ${urn}: ${r.status}`, 502);
  return (JSON.parse(r.text)?.[aspect]?.value as T | undefined) ?? undefined;
}
