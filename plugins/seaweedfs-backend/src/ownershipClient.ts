import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';
import { OwnedResourceKind } from './ownership';

export interface OwnershipClientDeps {
  auth: AuthService;
  discovery: DiscoveryService;
}

// The seaweedfs:create-/delete-group/policy actions run inside the
// 'scaffolder' plugin module (a hard requirement of
// scaffolderActionsExtensionPoint), so their coreServices.database resolves
// to backstage_plugin_scaffolder — a different database than the one
// seaweedfs-manager's own routes read ownership from
// (backstage_plugin_seaweedfs-manager). Reaching across that boundary with a
// second raw DB connection would defeat the point of per-plugin database
// isolation, so instead this calls seaweedfs-manager's own
// service-to-service-only /internal/ownership endpoints — there's only ever
// one writer, one database, one set of rows.
async function callInternal(
  deps: OwnershipClientDeps,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const baseUrl = await deps.discovery.getBaseUrl('seaweedfs-manager');
  const { token } = await deps.auth.getPluginRequestToken({
    onBehalfOf: await deps.auth.getOwnServiceCredentials(),
    targetPluginId: 'seaweedfs-manager',
  });
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function recordOwnershipRemote(
  deps: OwnershipClientDeps,
  kind: OwnedResourceKind,
  name: string,
  owner: string,
): Promise<void> {
  const res = await callInternal(deps, 'POST', '/internal/ownership', { kind, name, owner });
  if (!res.ok) {
    throw new Error(`Failed to record ownership for ${kind} "${name}": ${res.status} ${await res.text()}`);
  }
}

export async function ownerOfRemote(
  deps: OwnershipClientDeps,
  kind: OwnedResourceKind,
  name: string,
): Promise<string | undefined> {
  const res = await callInternal(deps, 'GET', `/internal/ownership/${kind}/${encodeURIComponent(name)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`Failed to look up ownership for ${kind} "${name}": ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { owner: string };
  return body.owner;
}

export async function forgetOwnershipRemote(
  deps: OwnershipClientDeps,
  kind: OwnedResourceKind,
  name: string,
): Promise<void> {
  const res = await callInternal(deps, 'DELETE', `/internal/ownership/${kind}/${encodeURIComponent(name)}`);
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to forget ownership for ${kind} "${name}": ${res.status} ${await res.text()}`);
  }
}
