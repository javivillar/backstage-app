import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { LoggerService } from '@backstage/backend-plugin-api';

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';

// Set on every user/group/client this module creates, so update/delete
// actions can tell whether the caller is the original creator. Values are
// Backstage entity refs (e.g. 'user:default/jvillar').
const OWNER_ATTR = 'backstage_owner';

interface MinimalActionContext {
  logger: LoggerService;
  getInitiatorCredentials(): Promise<BackstageCredentials>;
}

interface CallerInfo {
  entityRef: string;
  isAdmin: boolean;
}

async function getCallerInfo(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
): Promise<CallerInfo> {
  const credentials = await ctx.getInitiatorCredentials();
  const info = await userInfo.getUserInfo(credentials);
  return {
    entityRef: info.userEntityRef,
    isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
  };
}

// Returns the caller's own entity ref so create actions can stamp it as the
// new object's owner (OWNER_ATTR).
//
// Any signed-in user may create — Keycloak identity self-service isn't
// admin-gated (that's the whole point of owner-scoped CRUD: user A creates
// their own users/groups/clients, user B can't touch them, see
// requireOwnerOrAdmin below). Getting the caller info still matters even
// with no restriction: it's what supplies OWNER_ATTR, and it fails closed
// if credentials can't be resolved at all (e.g. an unauthenticated caller
// somehow reaching the backend directly).
async function requireAuthenticated(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
): Promise<string> {
  const caller = await getCallerInfo(ctx, userInfo);
  return caller.entityRef;
}

// Restricts an update/delete action to the object's recorded creator (via
// OWNER_ATTR) or a backstage-admin member. Objects created before ownership
// tracking existed (ownerRef undefined) are admin-only.
async function requireOwnerOrAdmin(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
  ownerRef: string | undefined,
): Promise<void> {
  const caller = await getCallerInfo(ctx, userInfo);
  if (caller.isAdmin) return;
  if (ownerRef && caller.entityRef === ownerRef) return;
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify this Keycloak object ` +
      `(recorded owner: ${
        ownerRef ?? 'none — created before ownership tracking, admin-only'
      }). Only the creator or a member of ${ADMIN_GROUP_REF} can edit or delete it.`,
  );
}

let cachedToken: { value: string; expiresAt: number } | undefined;

export async function getAdminToken(config: Config): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5000) {
    return cachedToken.value;
  }

  const kc = config.getConfig('keycloakAdmin');
  const baseUrl = kc.getString('baseUrl');
  const realm = kc.getString('realm');
  const clientId = kc.getString('clientId');
  const clientSecret = kc.getString('clientSecret');

  const res = await fetch(
    `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to obtain Keycloak admin token: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return body.access_token;
}

export async function kcAdminFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const kc = config.getConfig('keycloakAdmin');
  const baseUrl = kc.getString('baseUrl');
  const realm = kc.getString('realm');
  const token = await getAdminToken(config);

  return fetch(`${baseUrl}/admin/realms/${realm}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

async function findGroupByName(
  config: Config,
  name: string,
): Promise<{ id: string; name: string } | undefined> {
  const res = await kcAdminFetch(
    config,
    `/groups?search=${encodeURIComponent(name)}&exact=true`,
  );
  if (!res.ok) {
    throw new Error(`Failed to search Keycloak groups: ${res.status} ${await res.text()}`);
  }
  const found = (await res.json()) as Array<{ id: string; name: string }>;
  return found.find(g => g.name === name);
}

// User/group attributes are string ARRAYS; client attributes are plain
// strings — two accessors so neither reads the other's shape by mistake.
export function ownerFromAttributes(attributes?: Record<string, string[]>): string | undefined {
  return attributes?.[OWNER_ATTR]?.[0];
}

export function ownerFromClientAttributes(attributes?: Record<string, string>): string | undefined {
  return attributes?.[OWNER_ATTR];
}

async function findUserByUsername(
  config: Config,
  username: string,
): Promise<{ id: string; username: string } | undefined> {
  const res = await kcAdminFetch(
    config,
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  if (!res.ok) {
    throw new Error(`Failed to search Keycloak users: ${res.status} ${await res.text()}`);
  }
  const found = (await res.json()) as Array<{ id: string; username: string }>;
  return found.find(u => u.username === username);
}

async function getUserFull(config: Config, id: string): Promise<Record<string, unknown>> {
  const res = await kcAdminFetch(config, `/users/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load Keycloak user ${id}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function getGroupFull(config: Config, id: string): Promise<Record<string, unknown>> {
  const res = await kcAdminFetch(config, `/groups/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load Keycloak group ${id}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function findClientByClientId(
  config: Config,
  clientId: string,
): Promise<{ id: string; clientId: string } | undefined> {
  const res = await kcAdminFetch(
    config,
    `/clients?clientId=${encodeURIComponent(clientId)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to search Keycloak clients: ${res.status} ${await res.text()}`);
  }
  const found = (await res.json()) as Array<{ id: string; clientId: string }>;
  return found.find(c => c.clientId === clientId);
}

async function getClientFull(config: Config, id: string): Promise<Record<string, unknown>> {
  const res = await kcAdminFetch(config, `/clients/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load Keycloak client ${id}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function createKeycloakUserAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    temporaryPassword: string;
    groups?: string[];
    nationality?: string;
  }>({
    id: 'keycloak:create-user',
    description:
      'Creates a user in the Keycloak realm (RefresquitoTime) and optionally joins it to groups. ' +
      'Open to any signed-in user; you become the owner and only you (or backstage-admin) can edit/delete it later.',
    schema: {
      input: {
        type: 'object',
        required: ['username', 'email', 'temporaryPassword'],
        properties: {
          username: { title: 'Username', type: 'string' },
          email: { title: 'Email', type: 'string' },
          firstName: { title: 'First name', type: 'string' },
          lastName: { title: 'Last name', type: 'string' },
          temporaryPassword: {
            title: 'Temporary password',
            description: 'The user must change this on first login.',
            type: 'string',
          },
          groups: {
            title: 'Groups',
            description: 'Existing Keycloak group names to join the user to.',
            type: 'array',
            items: { type: 'string' },
          },
          nationality: {
            title: 'Nationality',
            description: "Realm requires this attribute on create. Defaults to 'ES'.",
            type: 'string',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          username: { type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const ownerRef = await requireAuthenticated(ctx, userInfo);

      const {
        username,
        email,
        firstName,
        lastName,
        temporaryPassword,
        groups = [],
        nationality = 'ES',
      } = ctx.input;

      const createRes = await kcAdminFetch(config, '/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          email,
          firstName,
          lastName,
          enabled: true,
          emailVerified: true,
          attributes: { Nationality: [nationality], [OWNER_ATTR]: [ownerRef] },
        }),
      });
      if (createRes.status !== 201) {
        throw new Error(
          `Failed to create Keycloak user: ${createRes.status} ${await createRes.text()}`,
        );
      }
      const location = createRes.headers.get('location');
      const userId = location?.split('/').pop();
      if (!userId) {
        throw new Error('Keycloak did not return a Location header for the created user');
      }

      const pwRes = await kcAdminFetch(config, `/users/${userId}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ type: 'password', value: temporaryPassword, temporary: true }),
      });
      if (!pwRes.ok) {
        throw new Error(
          `User was created but setting the temporary password failed: ${pwRes.status} ${await pwRes.text()}`,
        );
      }

      for (const groupName of groups) {
        const group = await findGroupByName(config, groupName);
        if (!group) {
          ctx.logger.warn(`Group "${groupName}" not found in Keycloak — skipping group join`);
          continue;
        }
        const joinRes = await kcAdminFetch(config, `/users/${userId}/groups/${group.id}`, {
          method: 'PUT',
        });
        if (!joinRes.ok) {
          ctx.logger.warn(
            `Failed to join user to group "${groupName}": ${joinRes.status} ${await joinRes.text()}`,
          );
        }
      }

      ctx.logger.info(`Created Keycloak user ${username} (${userId})`);
      ctx.output('userId', userId);
      ctx.output('username', username);
    },
  });
}

export function createKeycloakGroupAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{
    name: string;
    parentGroupName?: string;
  }>({
    id: 'keycloak:create-group',
    description:
      'Creates a group (optionally as a subgroup) in the Keycloak realm (RefresquitoTime). ' +
      'Open to any signed-in user; you become the owner and only you (or backstage-admin) can edit/delete it later.',
    schema: {
      input: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { title: 'Group name', type: 'string' },
          parentGroupName: {
            title: 'Parent group name',
            description: 'Leave empty to create a top-level group.',
            type: 'string',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          groupId: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const ownerRef = await requireAuthenticated(ctx, userInfo);

      const { name, parentGroupName } = ctx.input;

      let path = '/groups';
      if (parentGroupName) {
        const parent = await findGroupByName(config, parentGroupName);
        if (!parent) {
          throw new Error(`Parent group "${parentGroupName}" not found in Keycloak`);
        }
        path = `/groups/${parent.id}/children`;
      }

      const createRes = await kcAdminFetch(config, path, {
        method: 'POST',
        body: JSON.stringify({ name, attributes: { [OWNER_ATTR]: [ownerRef] } }),
      });
      if (createRes.status !== 201) {
        throw new Error(
          `Failed to create Keycloak group: ${createRes.status} ${await createRes.text()}`,
        );
      }
      const location = createRes.headers.get('location');
      const groupId = location?.split('/').pop() ?? '';

      ctx.logger.info(`Created Keycloak group ${name} (${groupId})`);
      ctx.output('groupId', groupId);
      ctx.output('name', name);
    },
  });
}

export function createKeycloakClientAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{
    clientId: string;
    name?: string;
    description?: string;
    publicClient: boolean;
    redirectUris?: string[];
    webOrigins?: string[];
    serviceAccountsEnabled?: boolean;
  }>({
    id: 'keycloak:create-client',
    description:
      'Creates an OIDC client in the Keycloak realm (RefresquitoTime). ' +
      'Open to any signed-in user; you become the owner and only you (or backstage-admin) can edit/delete it later. ' +
      'For confidential clients, the generated secret is returned in the task output — treat it as sensitive.',
    schema: {
      input: {
        type: 'object',
        required: ['clientId', 'publicClient'],
        properties: {
          clientId: { title: 'Client ID', type: 'string' },
          name: { title: 'Display name', type: 'string' },
          description: { title: 'Description', type: 'string' },
          publicClient: {
            title: 'Public client',
            description: 'true = no client secret (SPA/mobile); false = confidential.',
            type: 'boolean',
          },
          redirectUris: {
            title: 'Redirect URIs',
            type: 'array',
            items: { type: 'string' },
          },
          webOrigins: {
            title: 'Web origins',
            type: 'array',
            items: { type: 'string' },
          },
          serviceAccountsEnabled: {
            title: 'Enable service account (client credentials grant)',
            type: 'boolean',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          clientId: { type: 'string' },
          internalId: { type: 'string' },
          clientSecret: {
            type: 'string',
            description: 'Only set for confidential clients. Sensitive — visible in this task log.',
          },
        },
      },
    },
    async handler(ctx) {
      const ownerRef = await requireAuthenticated(ctx, userInfo);

      const {
        clientId,
        name,
        description,
        publicClient,
        redirectUris = [],
        webOrigins = [],
        serviceAccountsEnabled = false,
      } = ctx.input;

      const createRes = await kcAdminFetch(config, '/clients', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          name,
          description,
          protocol: 'openid-connect',
          publicClient,
          standardFlowEnabled: true,
          serviceAccountsEnabled,
          redirectUris,
          webOrigins,
          enabled: true,
          // Client attributes are single strings, not arrays (unlike user/group).
          attributes: { [OWNER_ATTR]: ownerRef },
        }),
      });
      if (createRes.status !== 201) {
        throw new Error(
          `Failed to create Keycloak client: ${createRes.status} ${await createRes.text()}`,
        );
      }
      const location = createRes.headers.get('location');
      const internalId = location?.split('/').pop();
      if (!internalId) {
        throw new Error('Keycloak did not return a Location header for the created client');
      }

      ctx.output('clientId', clientId);
      ctx.output('internalId', internalId);

      if (!publicClient) {
        const secretRes = await kcAdminFetch(config, `/clients/${internalId}/client-secret`);
        if (secretRes.ok) {
          const body = (await secretRes.json()) as { value: string };
          ctx.output('clientSecret', body.value);
        } else {
          ctx.logger.warn(`Could not retrieve client secret: ${secretRes.status}`);
        }
      }

      ctx.logger.info(`Created Keycloak client ${clientId} (${internalId})`);
    },
  });
}

// ---------------------------------------------------------------------------
// Update/delete actions (Phase 3: owner-scoped CRUD). Restricted to the
// object's recorded creator (OWNER_ATTR, stamped by the create-* actions
// above) or a backstage-admin member — see requireOwnerOrAdmin.
// ---------------------------------------------------------------------------

export function createKeycloakUpdateUserAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    groups?: string[];
  }>({
    id: 'keycloak:update-user',
    description:
      'Updates an existing Keycloak user (email/name/group membership). Only the ' +
      'user that created it, or backstage-admin, may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { title: 'Username', description: 'Identifies the user to update.', type: 'string' },
          email: { title: 'Email', type: 'string' },
          firstName: { title: 'First name', type: 'string' },
          lastName: { title: 'Last name', type: 'string' },
          groups: {
            title: 'Groups',
            description: 'Replaces the user\'s group membership with exactly this list.',
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
    async handler(ctx) {
      const { username, email, firstName, lastName, groups } = ctx.input;

      const found = await findUserByUsername(config, username);
      if (!found) {
        throw new Error(`Keycloak user "${username}" not found`);
      }
      const current = await getUserFull(config, found.id);
      const ownerRef = ownerFromAttributes(
        current.attributes as Record<string, string[]> | undefined,
      );
      await requireOwnerOrAdmin(ctx, userInfo, ownerRef);

      const updateRes = await kcAdminFetch(config, `/users/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...current,
          email: email ?? current.email,
          firstName: firstName ?? current.firstName,
          lastName: lastName ?? current.lastName,
        }),
      });
      if (!updateRes.ok) {
        throw new Error(
          `Failed to update Keycloak user: ${updateRes.status} ${await updateRes.text()}`,
        );
      }

      if (groups) {
        const currentGroupsRes = await kcAdminFetch(config, `/users/${found.id}/groups`);
        const currentGroups = currentGroupsRes.ok
          ? ((await currentGroupsRes.json()) as Array<{ id: string; name: string }>)
          : [];
        const currentNames = new Set(currentGroups.map(g => g.name));
        const desiredNames = new Set(groups);

        for (const groupName of groups) {
          if (currentNames.has(groupName)) continue;
          const group = await findGroupByName(config, groupName);
          if (!group) {
            ctx.logger.warn(`Group "${groupName}" not found in Keycloak — skipping`);
            continue;
          }
          await kcAdminFetch(config, `/users/${found.id}/groups/${group.id}`, { method: 'PUT' });
        }
        for (const group of currentGroups) {
          if (desiredNames.has(group.name)) continue;
          await kcAdminFetch(config, `/users/${found.id}/groups/${group.id}`, {
            method: 'DELETE',
          });
        }
      }

      ctx.logger.info(`Updated Keycloak user ${username}`);
    },
  });
}

export function createKeycloakDeleteUserAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{ username: string }>({
    id: 'keycloak:delete-user',
    description:
      'Deletes a Keycloak user. Only the user that created it, or backstage-admin, may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { title: 'Username', type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const { username } = ctx.input;

      const found = await findUserByUsername(config, username);
      if (!found) {
        throw new Error(`Keycloak user "${username}" not found`);
      }
      const current = await getUserFull(config, found.id);
      const ownerRef = ownerFromAttributes(
        current.attributes as Record<string, string[]> | undefined,
      );
      await requireOwnerOrAdmin(ctx, userInfo, ownerRef);

      const deleteRes = await kcAdminFetch(config, `/users/${found.id}`, { method: 'DELETE' });
      if (!deleteRes.ok) {
        throw new Error(
          `Failed to delete Keycloak user: ${deleteRes.status} ${await deleteRes.text()}`,
        );
      }

      ctx.logger.info(`Deleted Keycloak user ${username}`);
    },
  });
}

export function createKeycloakUpdateGroupAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{ name: string; newName?: string }>({
    id: 'keycloak:update-group',
    description:
      'Renames a Keycloak group. Only the user that created it, or backstage-admin, may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { title: 'Group name', description: 'Identifies the group to update.', type: 'string' },
          newName: { title: 'New name', type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const { name, newName } = ctx.input;

      const found = await findGroupByName(config, name);
      if (!found) {
        throw new Error(`Keycloak group "${name}" not found`);
      }
      const current = await getGroupFull(config, found.id);
      const ownerRef = ownerFromAttributes(
        current.attributes as Record<string, string[]> | undefined,
      );
      await requireOwnerOrAdmin(ctx, userInfo, ownerRef);

      const updateRes = await kcAdminFetch(config, `/groups/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...current, name: newName ?? current.name }),
      });
      if (!updateRes.ok) {
        throw new Error(
          `Failed to update Keycloak group: ${updateRes.status} ${await updateRes.text()}`,
        );
      }

      ctx.logger.info(`Updated Keycloak group ${name}`);
    },
  });
}

export function createKeycloakDeleteGroupAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{ name: string }>({
    id: 'keycloak:delete-group',
    description:
      'Deletes a Keycloak group. Only the user that created it, or backstage-admin, may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { title: 'Group name', type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const { name } = ctx.input;

      const found = await findGroupByName(config, name);
      if (!found) {
        throw new Error(`Keycloak group "${name}" not found`);
      }
      const current = await getGroupFull(config, found.id);
      const ownerRef = ownerFromAttributes(
        current.attributes as Record<string, string[]> | undefined,
      );
      await requireOwnerOrAdmin(ctx, userInfo, ownerRef);

      const deleteRes = await kcAdminFetch(config, `/groups/${found.id}`, { method: 'DELETE' });
      if (!deleteRes.ok) {
        throw new Error(
          `Failed to delete Keycloak group: ${deleteRes.status} ${await deleteRes.text()}`,
        );
      }

      ctx.logger.info(`Deleted Keycloak group ${name}`);
    },
  });
}

export function createKeycloakUpdateClientAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{
    clientId: string;
    name?: string;
    description?: string;
    redirectUris?: string[];
    webOrigins?: string[];
    serviceAccountsEnabled?: boolean;
  }>({
    id: 'keycloak:update-client',
    description:
      'Updates an existing Keycloak OIDC client. Only the user that created it, or ' +
      'backstage-admin, may run this. clientId/publicClient cannot be changed here.',
    schema: {
      input: {
        type: 'object',
        required: ['clientId'],
        properties: {
          clientId: { title: 'Client ID', description: 'Identifies the client to update.', type: 'string' },
          name: { title: 'Display name', type: 'string' },
          description: { title: 'Description', type: 'string' },
          redirectUris: { title: 'Redirect URIs', type: 'array', items: { type: 'string' } },
          webOrigins: { title: 'Web origins', type: 'array', items: { type: 'string' } },
          serviceAccountsEnabled: {
            title: 'Enable service account (client credentials grant)',
            type: 'boolean',
          },
        },
      },
    },
    async handler(ctx) {
      const { clientId, name, description, redirectUris, webOrigins, serviceAccountsEnabled } =
        ctx.input;

      const found = await findClientByClientId(config, clientId);
      if (!found) {
        throw new Error(`Keycloak client "${clientId}" not found`);
      }
      const current = await getClientFull(config, found.id);
      const ownerRef = ownerFromClientAttributes(
        current.attributes as Record<string, string> | undefined,
      );
      await requireOwnerOrAdmin(ctx, userInfo, ownerRef);

      const updateRes = await kcAdminFetch(config, `/clients/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...current,
          name: name ?? current.name,
          description: description ?? current.description,
          redirectUris: redirectUris ?? current.redirectUris,
          webOrigins: webOrigins ?? current.webOrigins,
          serviceAccountsEnabled: serviceAccountsEnabled ?? current.serviceAccountsEnabled,
        }),
      });
      if (!updateRes.ok) {
        throw new Error(
          `Failed to update Keycloak client: ${updateRes.status} ${await updateRes.text()}`,
        );
      }

      ctx.logger.info(`Updated Keycloak client ${clientId}`);
    },
  });
}

export function createKeycloakDeleteClientAction(options: {
  config: Config;
  userInfo: UserInfoService;
}) {
  const { config, userInfo } = options;

  return createTemplateAction<{ clientId: string }>({
    id: 'keycloak:delete-client',
    description:
      'Deletes a Keycloak OIDC client. Only the user that created it, or backstage-admin, may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['clientId'],
        properties: {
          clientId: { title: 'Client ID', type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const { clientId } = ctx.input;

      const found = await findClientByClientId(config, clientId);
      if (!found) {
        throw new Error(`Keycloak client "${clientId}" not found`);
      }
      const current = await getClientFull(config, found.id);
      const ownerRef = ownerFromClientAttributes(
        current.attributes as Record<string, string> | undefined,
      );
      await requireOwnerOrAdmin(ctx, userInfo, ownerRef);

      const deleteRes = await kcAdminFetch(config, `/clients/${found.id}`, { method: 'DELETE' });
      if (!deleteRes.ok) {
        throw new Error(
          `Failed to delete Keycloak client: ${deleteRes.status} ${await deleteRes.text()}`,
        );
      }

      ctx.logger.info(`Deleted Keycloak client ${clientId}`);
    },
  });
}
