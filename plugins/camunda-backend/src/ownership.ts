import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { camundaFetch } from './camundaClient';

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';

interface MinimalActionContext {
  getInitiatorCredentials(): Promise<BackstageCredentials>;
}

export interface CallerInfo {
  entityRef: string;
  username: string;
  isAdmin: boolean;
}

// Backstage entity refs here are 'user:default/<username>', and that
// username is exactly the Camunda/Keycloak username — same convention
// already verified for Superset/Keycloak in this stack.
function usernameFromEntityRef(entityRef: string): string {
  return entityRef.split('/').pop() ?? entityRef;
}

export async function callerInfo(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
): Promise<CallerInfo> {
  const credentials = await ctx.getInitiatorCredentials();
  const info = await userInfo.getUserInfo(credentials);
  return {
    entityRef: info.userEntityRef,
    username: usernameFromEntityRef(info.userEntityRef),
    isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
  };
}

// Camunda's PROCESS_DEFINITION resource type id (stable numeric enum from
// org.camunda.bpm.engine.authorization.Resources — verified live against a
// real engine-rest response, GET /authorization?resourceType=6).
const PROCESS_DEFINITION_RESOURCE_TYPE = 6;
// AUTH_TYPE_GRANT.
const AUTH_TYPE_GRANT = 1;
// DELETE is deliberately NOT part of the camunda-editor group's shared grant
// (READ + CREATE_INSTANCE, resourceId=*, see AUTHZ.md § bpm-oneke §5), so
// holding it on one specific resourceId is an unambiguous per-user ownership
// marker — nobody gets it except whoever this backend explicitly grants it
// to at provision time. See AUTHZ.md § bpm-oneke §9 for the full rationale
// (native-authorization-as-ownership, instead of a bolted-on attribute like
// Keycloak/Superset use).
const OWNERSHIP_PERMISSION = 'DELETE';

interface CamundaAuthorization {
  id: string;
  userId?: string;
  resourceId: string;
  permissions: string[];
}

/**
 * Grants `ownerUsername` a PROCESS_DEFINITION DELETE authorization scoped to
 * this one resourceId (the process definition *key*, stable across
 * redeploys/versions). This single row IS the ownership record — both for
 * the Backstage-level checks below, and, for free, as a second independent
 * enforcement layer: even a request that bypassed Backstage entirely and hit
 * engine-rest directly with another editor's own credentials would get a
 * native Camunda 403 on delete/redeploy.
 */
export async function grantOwnership(
  config: Config,
  processKey: string,
  ownerUsername: string,
): Promise<void> {
  const res = await camundaFetch(config, '/authorization/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: AUTH_TYPE_GRANT,
      userId: ownerUsername,
      resourceType: PROCESS_DEFINITION_RESOURCE_TYPE,
      resourceId: processKey,
      permissions: [OWNERSHIP_PERMISSION],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to grant ownership of process "${processKey}" to ${ownerUsername}: ${res.status} ${await res.text()}`,
    );
  }
}

/** The one userId holding the ownership-marker grant on this resourceId, if any. */
export async function findOwner(config: Config, processKey: string): Promise<string | undefined> {
  const res = await camundaFetch(
    config,
    `/authorization?resourceType=${PROCESS_DEFINITION_RESOURCE_TYPE}` +
      `&resourceId=${encodeURIComponent(processKey)}&permission=${OWNERSHIP_PERMISSION}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to look up owner of process "${processKey}": ${res.status} ${await res.text()}`);
  }
  const items = (await res.json()) as CamundaAuthorization[];
  return items.find(a => a.userId)?.userId;
}

/** Every provisioned process definition's owner, in one round-trip — backs the manager list. */
export async function ownerMap(config: Config): Promise<Record<string, string>> {
  const res = await camundaFetch(
    config,
    `/authorization?resourceType=${PROCESS_DEFINITION_RESOURCE_TYPE}&permission=${OWNERSHIP_PERMISSION}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to list Camunda process-definition ownership grants: ${res.status} ${await res.text()}`);
  }
  const items = (await res.json()) as CamundaAuthorization[];
  const map: Record<string, string> = {};
  for (const item of items) {
    if (item.userId) map[item.resourceId] = item.userId;
  }
  return map;
}

export async function requireOwnerOrAdmin(
  config: Config,
  caller: CallerInfo,
  processKey: string,
): Promise<void> {
  if (caller.isAdmin) return;
  const owner = await findOwner(config, processKey);
  if (owner === caller.username) return;
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify process "${processKey}" ` +
      `(owner: ${owner ?? 'none'}). Only the owner or a member of ${ADMIN_GROUP_REF} can edit or delete it.`,
  );
}
