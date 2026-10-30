import { Config } from '@backstage/config';
import { kcAdminFetch } from './actions';

/**
 * The Security tab of a Component: the Keycloak groups, clients, client roles and realm roles that say they belong
 * to it, by their attributes refresquito.* (contract: identity/README.md of refresquito-services). A service is
 * found by the name of its Component (superset-oneke); an application by its name and its stage (animalshelter,
 * dev). Read only: changes go through the keycloak:* scaffolder actions.
 */

type Attributes = Record<string, string[] | string> | undefined;

interface KcGroup {
  id: string;
  name: string;
  attributes?: Record<string, string[]>;
  realmRoles?: string[];
  clientRoles?: Record<string, string[]>;
}

interface KcRole {
  id: string;
  name: string;
  description?: string;
  attributes?: Record<string, string[]>;
}

interface KcClient {
  id: string;
  clientId: string;
  publicClient?: boolean;
  attributes?: Record<string, string>;
}

export interface Tags {
  component?: string;
  kind?: string;
  grants?: string;
  stages: string[];
  zone?: string;
  program?: string;
  classification?: string;
}

export function tagsOf(attributes: Attributes): Tags {
  const all = (key: string): string[] => {
    const value = attributes?.[`refresquito.${key}`];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  };
  const one = (key: string) => all(key)[0];
  return {
    component: one('component'),
    kind: one('kind'),
    grants: one('grants'),
    stages: all('stage'),
    zone: one('zone'),
    program: one('program'),
    classification: one('classification'),
  };
}

/** Whether an object of `component` is shown for `stage`: one without stage belongs to every stage. */
export function belongs(
  tags: Tags,
  component: string,
  stage?: string,
): boolean {
  if (tags.component !== component) return false;
  return !stage || tags.stages.length === 0 || tags.stages.includes(stage);
}

async function get<T>(config: Config, path: string): Promise<T> {
  const res = await kcAdminFetch(config, path);
  if (!res.ok) throw new Error(`Keycloak GET ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Who holds each role: "<role>" for a realm role, "<clientId>:<role>" for a client role. */
function holders(groups: KcGroup[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (key: string, group: string) =>
    map.set(key, [...(map.get(key) ?? []), group]);
  for (const g of groups) {
    for (const r of g.realmRoles ?? []) add(r, g.name);
    for (const [client, roles] of Object.entries(g.clientRoles ?? {})) {
      for (const r of roles) add(`${client}:${r}`, g.name);
    }
  }
  return map;
}

export async function securityOf(
  config: Config,
  component: string,
  stage: string | undefined,
  withNames: boolean,
) {
  const [groups, realmRoles, clients] = await Promise.all([
    get<KcGroup[]>(config, '/groups?briefRepresentation=false&max=10000'),
    get<KcRole[]>(config, '/roles?briefRepresentation=false&max=10000'),
    get<KcClient[]>(config, '/clients?max=10000'),
  ]);
  const held = holders(groups);
  const ownerOf = new Map(
    groups.map(g => [g.name, tagsOf(g.attributes).component]),
  );
  const heldBy = (key: string) =>
    (held.get(key) ?? [])
      .map(name => ({ name, component: ownerOf.get(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

  const myGroups = await Promise.all(
    groups
      .filter(g => belongs(tagsOf(g.attributes), component, stage))
      .map(async g => {
        const members = await get<{ username: string }[]>(
          config,
          `/groups/${g.id}/members?briefRepresentation=true&max=10000`,
        );
        return {
          name: g.name,
          ...tagsOf(g.attributes),
          members: members.length,
          memberNames: withNames
            ? members.map(m => m.username).sort()
            : undefined,
          roles: [
            ...(g.realmRoles ?? []),
            ...Object.entries(g.clientRoles ?? {}).flatMap(([c, roles]) =>
              roles.map(r => `${c}:${r}`),
            ),
          ].sort(),
        };
      }),
  );

  const myClients = await Promise.all(
    clients
      .filter(c => belongs(tagsOf(c.attributes), component, stage))
      .map(async c => {
        const roles = await get<KcRole[]>(
          config,
          `/clients/${c.id}/roles?briefRepresentation=false`,
        );
        return {
          clientId: c.clientId,
          publicClient: c.publicClient ?? false,
          ...tagsOf(c.attributes),
          roles: roles
            .map(r => ({
              name: r.name,
              grants: tagsOf(r.attributes).grants ?? r.description,
              heldBy: heldBy(`${c.clientId}:${r.name}`),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        };
      }),
  );

  const myRealmRoles = realmRoles
    .filter(r => belongs(tagsOf(r.attributes), component, stage))
    .map(r => ({
      name: r.name,
      ...tagsOf(r.attributes),
      grants: tagsOf(r.attributes).grants ?? r.description,
      heldBy: heldBy(r.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    component,
    stage,
    groups: myGroups.sort((a, b) => a.name.localeCompare(b.name)),
    clients: myClients.sort((a, b) => a.clientId.localeCompare(b.clientId)),
    realmRoles: myRealmRoles,
  };
}

/** What says no component: leftovers to clean up, or something created without its tags. */
export async function unowned(config: Config) {
  const [groups, realmRoles, clients] = await Promise.all([
    get<KcGroup[]>(config, '/groups?briefRepresentation=false&max=10000'),
    get<KcRole[]>(config, '/roles?briefRepresentation=false&max=10000'),
    get<KcClient[]>(config, '/clients?max=10000'),
  ]);
  const none = (a: Attributes) => !tagsOf(a).component;
  return {
    groups: groups
      .filter(g => none(g.attributes))
      .map(g => g.name)
      .sort(),
    clients: clients
      .filter(c => none(c.attributes))
      .map(c => c.clientId)
      .sort(),
    realmRoles: realmRoles
      .filter(r => none(r.attributes))
      .map(r => r.name)
      .sort(),
  };
}
