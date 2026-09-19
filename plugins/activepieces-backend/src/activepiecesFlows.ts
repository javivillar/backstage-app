import { Config } from '@backstage/config';
import { apJson, apListAll } from './activepiecesClient';
import { ApProject, CallerInfo, requireProjectPermission } from './activepiecesAuthz';

// Activepieces permission names carried by each project role. Like the
// project permissions, they are read live from the caller's role, never
// copied per role here.
export const PERM_READ_FLOW = 'READ_FLOW';
export const PERM_WRITE_FLOW = 'WRITE_FLOW';

export interface ApFlow {
  id: string;
  projectId: string;
  folderId?: string | null;
  status: string;
  created: string;
  updated: string;
  version?: { displayName?: string };
}

interface ApFolder {
  id: string;
  displayName: string;
}

export function flowName(flow: Pick<ApFlow, 'version'>): string {
  return flow.version?.displayName ?? '(unnamed)';
}

export async function listFlows(config: Config, projectId: string): Promise<ApFlow[]> {
  return apListAll<ApFlow>(config, `/v1/flows?projectId=${encodeURIComponent(projectId)}`);
}

/** folderId -> display name, so the page can show the folder of each flow. */
export async function folderNames(config: Config, projectId: string): Promise<Map<string, string>> {
  const folders = await apListAll<ApFolder>(config, `/v1/folders?projectId=${encodeURIComponent(projectId)}`);
  return new Map(folders.map(f => [f.id, f.displayName]));
}

/**
 * Creates an EMPTY flow (it is left disabled: the user models and publishes it
 * in Activepieces). `folderName` is created on the fly by Activepieces when it
 * does not exist yet.
 */
export async function createFlow(
  config: Config,
  projectId: string,
  displayName: string,
  folderName?: string,
): Promise<ApFlow> {
  return apJson<ApFlow>(config, '/v1/flows', {
    method: 'POST',
    body: JSON.stringify({ displayName, projectId, ...(folderName ? { folderName } : {}) }),
  });
}

export async function renameFlow(config: Config, projectId: string, flowId: string, displayName: string): Promise<void> {
  await apJson(config, `/v1/flows/${encodeURIComponent(flowId)}?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify({ type: 'CHANGE_NAME', request: { displayName } }),
  });
}

export async function deleteFlow(config: Config, projectId: string, flowId: string): Promise<void> {
  await apJson(config, `/v1/flows/${encodeURIComponent(flowId)}?projectId=${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}

/**
 * Gate for everything that touches ONE flow. Two checks, both mandatory:
 *
 *  1. the caller holds `permission` in `projectId` (requireProjectPermission,
 *     deny by default, admin override);
 *  2. the flow really belongs to `projectId`.
 *
 * (2) is what stops cross-project access: the platform API key is not scoped
 * to a project -- verified live, `GET /v1/flows/:id?projectId=<any other>`
 * still answers 200 -- so without it a member of project A could act on a
 * flow of project B just by passing A as the project. A flow that does not
 * exist and a flow of another project produce the SAME error, so the response
 * does not reveal whether some flow id exists elsewhere.
 */
export async function requireFlowInProject(
  config: Config,
  caller: CallerInfo,
  projectId: string,
  flowId: string,
  permission: string,
): Promise<{ project: ApProject; flow: ApFlow }> {
  const project = await requireProjectPermission(config, caller, projectId, permission);
  const denied = new Error(`Forbidden: flow "${flowId}" is not in this project`);
  let flow: ApFlow;
  try {
    flow = await apJson<ApFlow>(config, `/v1/flows/${encodeURIComponent(flowId)}`);
  } catch (e) {
    if (/ failed: 40[04] /.test((e as Error).message)) throw denied;
    throw e;
  }
  if (flow.projectId !== projectId) throw denied;
  return { project, flow };
}
