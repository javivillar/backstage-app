import { DatahubError, DatahubSettings } from './datahubClient';
import { PlannedType, Proposal } from './plan';
import { rest } from './datahubRest';

export { getAspect } from './datahubRest';

// The ONLY module that writes to DataHub (F2). REST OpenAPI v3, authenticated
// with the plugin's service-account token; what that token may touch is decided
// by DataHub's own policy (assets of the four types, NO vocabulary/platform
// privileges -- verified live 2026-09-21). Payload shapes are documented next
// to each call and verified live by the F2 end-to-end check.

type Writer = Pick<DatahubSettings, 'baseUrl' | 'token'>;

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
