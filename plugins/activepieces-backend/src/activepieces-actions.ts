import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { UserInfoService } from '@backstage/backend-plugin-api';
import { apFetch, apJson, flowUrl, projectUrl } from './activepiecesClient';
import {
  PERM_WRITE_PROJECT,
  PERM_WRITE_PROJECT_MEMBER,
  callerInfo,
  listMembers,
  requireProjectPermission,
} from './activepiecesAuthz';
import { addOrSetMember, createManagedProject, removeMember } from './activepiecesProjects';
import {
  PERM_WRITE_FLOW,
  createFlow,
  deleteFlow,
  renameFlow,
  requireFlowInProject,
} from './activepiecesFlows';
import { ensureAccessGroup, getKeycloakPerson } from './keycloakLookup';

interface ActionOptions {
  config: Config;
  userInfo: UserInfoService;
}

interface CreateProjectInput {
  name: string;
}

export function createActivepiecesProjectAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<CreateProjectInput>({
    id: 'activepieces:create-project',
    schema: {
      input: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      output: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const project = await createManagedProject(config, caller, ctx.input.name.trim());
      ctx.output('id', project.id);
      ctx.output('name', project.displayName);
      ctx.output('url', projectUrl(config, project.id));
    },
  });
}

interface UpdateProjectInput {
  id: string;
  name: string;
}

export function updateActivepiecesProjectAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<UpdateProjectInput>({
    id: 'activepieces:update-project',
    schema: {
      input: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireProjectPermission(config, caller, ctx.input.id, PERM_WRITE_PROJECT);
      await apJson(config, `/v1/projects/${encodeURIComponent(ctx.input.id)}`, {
        method: 'POST',
        body: JSON.stringify({ displayName: ctx.input.name.trim() }),
      });
    },
  });
}

interface DeleteProjectInput {
  id: string;
}

export function deleteActivepiecesProjectAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<DeleteProjectInput>({
    id: 'activepieces:delete-project',
    schema: { input: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireProjectPermission(config, caller, ctx.input.id, PERM_WRITE_PROJECT);
      const res = await apFetch(config, `/v1/projects/${encodeURIComponent(ctx.input.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Failed to delete Activepieces project "${ctx.input.id}": ${res.status} ${await res.text()}`);
      }
    },
  });
}

interface SetMemberInput {
  projectId: string;
  username: string;
  role: string;
}

export function setActivepiecesMemberAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<SetMemberInput>({
    id: 'activepieces:set-member',
    schema: {
      input: {
        type: 'object',
        required: ['projectId', 'username', 'role'],
        properties: {
          projectId: { type: 'string' },
          username: { type: 'string' },
          role: { type: 'string' },
        },
      },
      output: { type: 'object', properties: { status: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireProjectPermission(config, caller, ctx.input.projectId, PERM_WRITE_PROJECT_MEMBER);
      const person = await getKeycloakPerson(config, ctx.input.username.trim());
      await ensureAccessGroup(config, person);
      const result = await addOrSetMember(config, ctx.input.projectId, person.email, ctx.input.role);
      ctx.output('status', result.status);
    },
  });
}

interface RemoveMemberInput {
  projectId: string;
  username: string;
}

export function removeActivepiecesMemberAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<RemoveMemberInput>({
    id: 'activepieces:remove-member',
    schema: {
      input: {
        type: 'object',
        required: ['projectId', 'username'],
        properties: { projectId: { type: 'string' }, username: { type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireProjectPermission(config, caller, ctx.input.projectId, PERM_WRITE_PROJECT_MEMBER);
      const person = await getKeycloakPerson(config, ctx.input.username.trim());
      const members = await listMembers(config, ctx.input.projectId);
      const target = members.find(m => m.user.email.toLowerCase() === person.email.toLowerCase());
      if (!target) throw new Error(`${ctx.input.username} is not a member of this project`);
      await removeMember(config, ctx.input.projectId, target.id);
    },
  });
}

interface CreateFlowInput {
  projectId: string;
  name: string;
  folder?: string;
}

export function createActivepiecesFlowAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<CreateFlowInput>({
    id: 'activepieces:create-flow',
    schema: {
      input: {
        type: 'object',
        required: ['projectId', 'name'],
        properties: { projectId: { type: 'string' }, name: { type: 'string' }, folder: { type: 'string' } },
      },
      output: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireProjectPermission(config, caller, ctx.input.projectId, PERM_WRITE_FLOW);
      const name = ctx.input.name.trim();
      if (!name) throw new Error('The flow name is required');
      const flow = await createFlow(config, ctx.input.projectId, name, ctx.input.folder?.trim() || undefined);
      ctx.output('id', flow.id);
      ctx.output('name', name);
      ctx.output('url', flowUrl(config, ctx.input.projectId, flow.id));
    },
  });
}

interface RenameFlowInput {
  projectId: string;
  flowId: string;
  name: string;
}

export function renameActivepiecesFlowAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<RenameFlowInput>({
    id: 'activepieces:rename-flow',
    schema: {
      input: {
        type: 'object',
        required: ['projectId', 'flowId', 'name'],
        properties: { projectId: { type: 'string' }, flowId: { type: 'string' }, name: { type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireFlowInProject(config, caller, ctx.input.projectId, ctx.input.flowId, PERM_WRITE_FLOW);
      await renameFlow(config, ctx.input.projectId, ctx.input.flowId, ctx.input.name.trim());
    },
  });
}

interface DeleteFlowInput {
  projectId: string;
  flowId: string;
}

export function deleteActivepiecesFlowAction({ config, userInfo }: ActionOptions) {
  return createTemplateAction<DeleteFlowInput>({
    id: 'activepieces:delete-flow',
    schema: {
      input: {
        type: 'object',
        required: ['projectId', 'flowId'],
        properties: { projectId: { type: 'string' }, flowId: { type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireFlowInProject(config, caller, ctx.input.projectId, ctx.input.flowId, PERM_WRITE_FLOW);
      await deleteFlow(config, ctx.input.projectId, ctx.input.flowId);
    },
  });
}
