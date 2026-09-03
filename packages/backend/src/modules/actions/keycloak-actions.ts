import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { LoggerService } from '@backstage/backend-plugin-api';

const ADMIN_GROUP_REF = 'group:default/backstage-admin';

interface MinimalActionContext {
  logger: LoggerService;
  getInitiatorCredentials(): Promise<BackstageCredentials>;
}

async function requireAdminGroup(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
): Promise<void> {
  const credentials = await ctx.getInitiatorCredentials();
  const info = await userInfo.getUserInfo(credentials);
  if (!info.ownershipEntityRefs.includes(ADMIN_GROUP_REF)) {
    throw new Error(
      `Forbidden: ${info.userEntityRef} is not a member of ${ADMIN_GROUP_REF} — ` +
        'Keycloak identity-management actions are restricted to backstage-admin.',
    );
  }
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
      'Creates a user in the Keycloak realm (RefresquitoTime) and optionally joins it to groups. Restricted to backstage-admin.',
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
      await requireAdminGroup(ctx, userInfo);

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
          attributes: { Nationality: [nationality] },
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
      'Creates a group (optionally as a subgroup) in the Keycloak realm (RefresquitoTime). Restricted to backstage-admin.',
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
      await requireAdminGroup(ctx, userInfo);

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
        body: JSON.stringify({ name }),
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
      'Creates an OIDC client in the Keycloak realm (RefresquitoTime). Restricted to backstage-admin. ' +
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
      await requireAdminGroup(ctx, userInfo);

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
