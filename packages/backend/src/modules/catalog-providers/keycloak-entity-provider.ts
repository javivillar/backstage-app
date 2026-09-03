import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { Entity } from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import {
  LoggerService,
  SchedulerServiceTaskRunner,
} from '@backstage/backend-plugin-api';
import { getAdminToken, kcAdminFetch } from '../actions/keycloak-actions';

interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
}

interface KcGroup {
  id: string;
  name: string;
  path: string;
}

// Backstage entity names must match ^[a-zA-Z0-9_.-]+$ (max 63 chars).
// Keycloak usernames/group names are usually already valid, but sanitize
// defensively (e.g. usernames that are email addresses).
function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 63);
}

/**
 * Syncs Keycloak realm users and groups into the Backstage catalog as
 * User/Group entities, so what the keycloak:create-* scaffolder actions
 * create is browsable/searchable in Backstage afterwards.
 *
 * Reuses the same 'backstage-admin-sa' service-account credentials
 * (config key `keycloakAdmin`) already used by those actions.
 */
export class KeycloakEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly config: Config,
    private readonly logger: LoggerService,
    private readonly taskRunner: SchedulerServiceTaskRunner,
  ) {}

  getProviderName(): string {
    return 'keycloak-identity-provider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.taskRunner.run({
      id: this.getProviderName(),
      fn: async () => {
        try {
          await this.run();
        } catch (error) {
          this.logger.error('Keycloak catalog sync failed', error as Error);
        }
      },
    });
  }

  private async fetchAllGroups(): Promise<KcGroup[]> {
    const roots = (await (
      await kcAdminFetch(this.config, '/groups?briefRepresentation=true')
    ).json()) as KcGroup[];

    const all: KcGroup[] = [];
    const walk = async (group: KcGroup) => {
      all.push(group);
      const childrenRes = await kcAdminFetch(
        this.config,
        `/groups/${group.id}/children?briefRepresentation=true`,
      );
      if (!childrenRes.ok) return;
      const children = (await childrenRes.json()) as KcGroup[];
      for (const child of children) {
        await walk(child);
      }
    };
    for (const root of roots) {
      await walk(root);
    }
    return all;
  }

  private async fetchAllUsers(): Promise<KcUser[]> {
    const pageSize = 100;
    const users: KcUser[] = [];
    for (let first = 0; ; first += pageSize) {
      const res = await kcAdminFetch(
        this.config,
        `/users?first=${first}&max=${pageSize}`,
      );
      if (!res.ok) {
        throw new Error(`Failed to list Keycloak users: ${res.status}`);
      }
      const page = (await res.json()) as KcUser[];
      users.push(...page);
      if (page.length < pageSize) break;
    }
    return users;
  }

  private async fetchGroupMembers(groupId: string): Promise<string[]> {
    const members: string[] = [];
    const pageSize = 100;
    for (let first = 0; ; first += pageSize) {
      const res = await kcAdminFetch(
        this.config,
        `/groups/${groupId}/members?first=${first}&max=${pageSize}`,
      );
      if (!res.ok) return members;
      const page = (await res.json()) as KcUser[];
      members.push(...page.map(u => u.username));
      if (page.length < pageSize) break;
    }
    return members;
  }

  private async run(): Promise<void> {
    if (!this.connection) {
      throw new Error('Keycloak entity provider not connected yet');
    }

    // Cheap way to confirm the admin credentials work before doing any real
    // work — surfaces a clear error in the task run instead of failing deep
    // inside pagination.
    await getAdminToken(this.config);

    this.logger.info('Syncing Keycloak users and groups into the catalog');

    const [groups, users] = await Promise.all([
      this.fetchAllGroups(),
      this.fetchAllUsers(),
    ]);

    const groupMembers = new Map<string, string[]>();
    const userGroups = new Map<string, string[]>();
    for (const group of groups) {
      const members = await this.fetchGroupMembers(group.id);
      groupMembers.set(group.id, members);
      const groupRef = `group:default/${sanitizeName(group.name)}`;
      for (const username of members) {
        const list = userGroups.get(username) ?? [];
        list.push(groupRef);
        userGroups.set(username, list);
      }
    }

    const groupByPath = new Map(groups.map(g => [g.path, g]));
    const parentPathOf = (path: string) => {
      const idx = path.lastIndexOf('/', path.length - 2);
      return idx <= 0 ? undefined : path.slice(0, idx);
    };
    const childrenOf = new Map<string, string[]>();
    for (const group of groups) {
      const parentPath = parentPathOf(group.path);
      if (!parentPath) continue;
      const parent = groupByPath.get(parentPath);
      if (!parent) continue;
      const list = childrenOf.get(parent.id) ?? [];
      list.push(`group:default/${sanitizeName(group.name)}`);
      childrenOf.set(parent.id, list);
    }

    const groupEntities: Entity[] = groups.map(group => {
      const parentPath = parentPathOf(group.path);
      const parent = parentPath ? groupByPath.get(parentPath) : undefined;
      return {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: {
          name: sanitizeName(group.name),
          title: group.name,
          annotations: { 'keycloak.org/id': group.id },
        },
        spec: {
          type: 'team',
          profile: { displayName: group.name },
          parent: parent ? `group:default/${sanitizeName(parent.name)}` : undefined,
          children: childrenOf.get(group.id) ?? [],
          members: (groupMembers.get(group.id) ?? []).map(
            u => `user:default/${sanitizeName(u)}`,
          ),
        },
      };
    });

    const userEntities: Entity[] = users.map(user => ({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'User',
      metadata: {
        name: sanitizeName(user.username),
        title: user.username,
        annotations: { 'keycloak.org/id': user.id },
      },
      spec: {
        profile: {
          displayName:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.username,
          email: user.email,
        },
        memberOf: userGroups.get(user.username) ?? [],
      },
    }));

    await this.connection.applyMutation({
      type: 'full',
      entities: [...groupEntities, ...userEntities].map(entity => ({
        entity,
        locationKey: this.getProviderName(),
      })),
    });

    this.logger.info(
      `Keycloak catalog sync complete: ${groupEntities.length} groups, ${userEntities.length} users`,
    );
  }
}
