import { isPortalAdmin } from '@internal/backstage-plugin-portal-access-common';
import type {
  BackstageCredentials,
  LoggerService,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { parseEntityRef } from '@backstage/catalog-model';
import { Request, Response, Router } from 'express';
import { kcAdminFetch, securityOwner } from './actions';
import {
  administers,
  DEFAULT_RULES,
  groupNames,
  lastAdministrator,
  mayChange,
  productsOf,
  type AccessGroup,
  type AccessRules,
  type Caller,
  type KcGroup,
  type Product,
} from './accessModel';
import {
  reasonOf,
  type AccessRequest,
  type AccessRequestStore,
} from './accessRequests';
import type { AccessStore } from './accessStore';

/**
 * /api/keycloak-manager/access: access administration (the rules are in accessModel.ts). The only place of the
 * portal that changes who is in a Keycloak group, with the service account of Backstage (manage-users): every check
 * of who may do what is here, and every change is recorded (accessStore.ts) and logged.
 *
 * People are never created here: only existing users are added to groups. A person who signs in through the hub of
 * the programme (an identity provider link) gets their groups from the hub at every sign-in, so they are changed
 * there, not here.
 *
 * /access/requests: anyone signed in asks to be put in a group of a product, with a reason (never a group only the
 * portal administrators change); an administrator of that product approves it, which adds the person exactly as
 * above, or rejects it with a reason; the person withdraws it while it waits (accessRequests.ts).
 */

type KcUser = {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled?: boolean;
};
type Person = { username: string; name: string; email?: string };

/** A refusal with its HTTP status. */
class Refusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const person = (u: KcUser): Person => ({
  username: u.username,
  name: [u.firstName, u.lastName].filter(Boolean).join(' '),
  email: u.email,
});

/** keycloakAdmin.access.admins / .portalOnly of the config replace the rules of accessModel.ts. */
export function rulesOf(config: Config): AccessRules {
  const access = config.getOptionalConfig('keycloakAdmin.access');
  const admins = access?.getOptionalConfig('admins');
  return {
    admins: admins
      ? Object.fromEntries(
          admins.keys().map(k => [k, admins.getStringArray(k)]),
        )
      : DEFAULT_RULES.admins,
    portalOnly:
      access?.getOptionalStringArray('portalOnly') ?? DEFAULT_RULES.portalOnly,
  };
}

export function accessRouter(options: {
  config: Config;
  logger: LoggerService;
  catalog: CatalogService;
  store?: AccessStore;
  requests?: AccessRequestStore;
  caller(
    req: Request,
  ): Promise<{
    credentials: BackstageCredentials;
    entityRef: string;
    ownershipEntityRefs: string[];
  }>;
}): Router {
  const { config, logger, catalog, store, requests } = options;
  const rules = rulesOf(config);
  const router = Router();

  async function kc<T>(path: string): Promise<T> {
    const res = await kcAdminFetch(config, path);
    if (!res.ok) throw new Error(`Keycloak GET ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  const membersOf = (groupId: string) =>
    kc<KcUser[]>(
      `/groups/${groupId}/members?briefRepresentation=true&max=10000`,
    );

  /** The group names that own each business application in the catalog (spec.owner of its Components). */
  async function applicationOwners(
    credentials: BackstageCredentials,
  ): Promise<Map<string, string[]>> {
    const owners = new Map<string, string[]>();
    try {
      const { items } = await catalog.getEntities(
        {
          filter: { kind: 'component' },
          fields: [
            'kind',
            'metadata.name',
            'metadata.annotations',
            'spec.owner',
          ],
        },
        { credentials },
      );
      for (const entity of items) {
        const owner = entity.spec?.owner;
        if (typeof owner !== 'string') continue;
        const ref = parseEntityRef(owner, {
          defaultKind: 'group',
          defaultNamespace: 'default',
        });
        if (ref.kind.toLowerCase() !== 'group') continue;
        const { component } = securityOwner(entity);
        owners.set(component, [
          ...new Set([...(owners.get(component) ?? []), ref.name]),
        ]);
      }
    } catch (e) {
      // without the catalog the owners of the applications are not known: their administrators still are
      logger.warn(
        `access administration: the owners of the applications could not be read: ${
          (e as Error).message
        }`,
      );
    }
    return owners;
  }

  /** Who asks, every product and the ones they administer. */
  async function context(req: Request) {
    const who = await options.caller(req);
    const caller: Caller = {
      ref: who.entityRef,
      groups: groupNames(who.ownershipEntityRefs),
      portalAdmin: isPortalAdmin(who.ownershipEntityRefs),
    };
    const groups = await kc<KcGroup[]>(
      '/groups?briefRepresentation=false&max=10000',
    );
    const products = productsOf(groups, rules);
    const owners = caller.portalAdmin
      ? new Map<string, string[]>()
      : await applicationOwners(who.credentials);
    const mine = products.filter(p =>
      administers(p, caller, owners.get(p.component)),
    );
    return {
      caller,
      products,
      mine,
      username: parseEntityRef(who.entityRef).name,
    };
  }

  function productOrRefuse(mine: Product[], component: string): Product {
    const product = mine.find(p => p.component === component);
    if (!product) throw new Refusal(403, `You do not administer ${component}.`);
    return product;
  }

  const view = (g: AccessGroup, caller: Caller) => ({
    name: g.name,
    kind: g.kind,
    grants: g.grants,
    classification: g.classification,
    stages: g.stages,
    admin: g.admin,
    portalOnly: g.portalOnly,
    from: g.from,
    canChange: mayChange(g, caller),
  });

  const handle =
    (what: string, fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof Refusal) {
          res.status(e.status).json({ error: e.message });
          return;
        }
        logger.error(`keycloak-manager /access ${what} failed`, e as Error);
        res.status(500).json({ error: (e as Error).message });
      }
    };

  // the products the caller administers (every one, for a portal administrator)
  router.get(
    '/products',
    handle('products', async (req, res) => {
      const { caller, mine } = await context(req);
      res.json({
        portalAdmin: caller.portalAdmin,
        products: mine.map(p => ({
          component: p.component,
          kind: p.kind,
          groups: p.groups.length,
          adminGroups: p.adminGroups,
        })),
      });
    }),
  );

  // one product: its groups with their members, and its last changes
  router.get(
    '/products/:component',
    handle('product', async (req, res) => {
      const { caller, mine } = await context(req);
      const product = productOrRefuse(mine, req.params.component);
      const groups = await Promise.all(
        product.groups.map(async g => ({
          ...view(g, caller),
          members: (await membersOf(g.id))
            .map(person)
            .sort((a, b) => a.username.localeCompare(b.username)),
        })),
      );
      res.json({
        component: product.component,
        kind: product.kind,
        adminGroups: product.adminGroups,
        groups,
        changes: store ? await store.list(product.component) : [],
        recorded: Boolean(store),
      });
    }),
  );

  // existing people to add: ?search= (at least 2 characters). Only for someone who administers a product.
  router.get(
    '/people',
    handle('people', async (req, res) => {
      const { mine } = await context(req);
      if (!mine.length) throw new Refusal(403, 'You administer no product.');
      const search = String(req.query.search ?? '').trim();
      if (search.length < 2) {
        res.json({ people: [] });
        return;
      }
      const users = await kc<KcUser[]>(
        `/users?search=${encodeURIComponent(
          search,
        )}&max=20&briefRepresentation=true`,
      );
      res.json({
        people: users
          .filter(
            u =>
              u.enabled !== false && !u.username.startsWith('service-account-'),
          )
          .map(person),
      });
    }),
  );

  // what one person has, in the products the caller administers
  router.get(
    '/people/:username',
    handle('person', async (req, res) => {
      const { caller, mine } = await context(req);
      if (!mine.length) throw new Refusal(403, 'You administer no product.');
      const user = await userOrRefuse(req.params.username);
      const theirs = new Set(
        (
          await kc<Array<{ name: string }>>(
            `/users/${user.id}/groups?max=10000`,
          )
        ).map(g => g.name),
      );
      res.json({
        person: person(user),
        hub: await signsInThroughHub(user.id),
        groups: mine.flatMap(p =>
          p.groups
            .filter(g => theirs.has(g.name))
            .map(g => ({ component: p.component, ...view(g, caller) })),
        ),
      });
    }),
  );

  async function userOrRefuse(username: string): Promise<KcUser> {
    const found = await kc<KcUser[]>(
      `/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    const user = found.find(u => u.username === username);
    if (!user)
      throw new Refusal(
        404,
        `There is no user ${username}. People are not created here: only existing users are added.`,
      );
    return user;
  }

  /** The identity provider the person signs in through (the hub of the programme), if any. */
  async function signsInThroughHub(
    userId: string,
  ): Promise<string | undefined> {
    const res = await kcAdminFetch(
      config,
      `/users/${userId}/federated-identity`,
    );
    if (!res.ok) return undefined;
    const links = (await res.json()) as Array<{ identityProvider: string }>;
    return links[0]?.identityProvider;
  }

  /** Adds or removes a person in a group of a product the caller administers: every check, the change, its record. */
  async function changeMembership(
    action: 'add' | 'remove',
    caller: Caller,
    mine: Product[],
    groupName: string,
    username: string,
  ): Promise<void> {
    const product = mine.find(p => p.groups.some(g => g.name === groupName));
    const group = product?.groups.find(g => g.name === groupName);
    if (!product || !group)
      throw new Refusal(
        403,
        `You do not administer the product of ${groupName}.`,
      );
    if (!mayChange(group, caller))
      throw new Refusal(
        403,
        `Only the administrators of the portal change ${groupName}.`,
      );
    if (!store)
      throw new Refusal(
        503,
        'Changes cannot be recorded (no database), so none is made.',
      );
    const user = await userOrRefuse(username);

    const hub = await signsInThroughHub(user.id);
    if (hub)
      throw new Refusal(
        409,
        `${username} signs in through ${hub}: their groups come from there at every sign-in. Change them in the portal of ${hub}.`,
      );

    if (action === 'remove') {
      const adminMembers: Record<string, string[]> = {};
      for (const g of product.groups.filter(x => x.admin))
        adminMembers[g.name] = (await membersOf(g.id)).map(m => m.username);
      const why = lastAdministrator(product, groupName, username, adminMembers);
      if (why) throw new Refusal(409, why);
    }

    const done = await kcAdminFetch(
      config,
      `/users/${user.id}/groups/${group.id}`,
      { method: action === 'add' ? 'PUT' : 'DELETE' },
    );
    if (!done.ok)
      throw new Error(
        `Keycloak answered ${done.status} to ${action} ${username} ${groupName}`,
      );
    logger.info(
      `access administration: ${caller.ref} ${action} ${username} ${groupName} (${product.component})`,
    );
    await store.record({
      actor: caller.ref,
      action,
      username,
      group: groupName,
      component: product.component,
    });
  }

  /** Adds (PUT) or removes (DELETE) a person in a group of a product the caller administers. */
  const change = (action: 'add' | 'remove') =>
    handle(action, async (req, res) => {
      const { caller, mine } = await context(req);
      await changeMembership(
        action,
        caller,
        mine,
        req.params.group,
        req.params.username,
      );
      res.json({ ok: true });
    });

  router.put('/groups/:group/members/:username', change('add'));
  router.delete('/groups/:group/members/:username', change('remove'));

  // --- requests of access ---------------------------------------------------------------------------------------

  const requestsOrRefuse = (): AccessRequestStore => {
    if (!requests)
      throw new Refusal(503, 'Requests cannot be kept (no database).');
    return requests;
  };

  /** A group of a product anyone may ask for: never one only the portal administrators change. */
  const askable = (products: Product[], groupName: string) => {
    for (const product of products) {
      const group = product.groups.find(
        g => g.name === groupName && !g.portalOnly,
      );
      if (group) return { product, group };
    }
    return undefined;
  };

  const pendingRequestOrRefuse = async (id: string): Promise<AccessRequest> => {
    const request = await requestsOrRefuse().get(Number(id));
    if (!request) throw new Refusal(404, `There is no request ${id}.`);
    if (request.state !== 'pending')
      throw new Refusal(409, `The request is ${request.state} already.`);
    return request;
  };

  // what a person may ask for, their own requests, and the ones they decide
  router.get(
    '/requests',
    handle('requests', async (req, res) => {
      const { caller, products, mine, username } = await context(req);
      const kept = requestsOrRefuse();
      const own = await kept.of(username);
      const waiting = new Set(
        own.filter(r => r.state === 'pending').map(r => r.group),
      );
      const { pending, decided } = await kept.forProducts(
        mine.map(p => p.component),
      );
      res.json({
        products: products
          .map(p => ({
            component: p.component,
            kind: p.kind,
            groups: p.groups
              .filter(g => !g.portalOnly)
              .map(g => ({
                name: g.name,
                kind: g.kind,
                grants: g.grants,
                classification: g.classification,
                admin: g.admin,
                member: caller.groups.has(g.name.toLowerCase()),
                pending: waiting.has(g.name),
              })),
          }))
          .filter(p => p.groups.length),
        mine: own,
        decides: mine.length > 0,
        // a request for a group only the portal administrators change cannot exist; the caller decides the rest
        pending,
        decided,
      });
    }),
  );

  router.post(
    '/requests',
    handle('request', async (req, res) => {
      const { caller, products, username } = await context(req);
      const kept = requestsOrRefuse();
      const groupName = String(req.body?.group ?? '');
      const reason = reasonOf(req.body?.reason);
      if (!reason)
        throw new Refusal(
          400,
          'Say why you need it, in at most 500 characters.',
        );
      const found = askable(products, groupName);
      if (!found)
        throw new Refusal(404, `${groupName} is not a group you can ask for.`);
      if (caller.groups.has(groupName.toLowerCase()))
        throw new Refusal(409, `You are in ${groupName} already.`);
      if (await kept.pendingOf(username, groupName))
        throw new Refusal(
          409,
          `You have asked for ${groupName} already: it waits for a decision.`,
        );
      const filed = await kept.file({
        requester: username,
        group: groupName,
        component: found.product.component,
        reason,
      });
      logger.info(
        `access requests: ${caller.ref} asks for ${groupName} (${found.product.component})`,
      );
      res.status(201).json(filed);
    }),
  );

  // approval: the person is added to the group, with every check of access administration
  router.post(
    '/requests/:id/approval',
    handle('approval', async (req, res) => {
      const { caller, mine } = await context(req);
      const request = await pendingRequestOrRefuse(req.params.id);
      await changeMembership(
        'add',
        caller,
        mine,
        request.group,
        request.requester,
      );
      if (
        !(await requestsOrRefuse().decide(request.id, 'approved', caller.ref))
      )
        throw new Refusal(409, 'Somebody else decided the request meanwhile.');
      res.json({ ok: true });
    }),
  );

  router.post(
    '/requests/:id/rejection',
    handle('rejection', async (req, res) => {
      const { caller, mine } = await context(req);
      const request = await pendingRequestOrRefuse(req.params.id);
      const found = askable(mine, request.group);
      if (!found)
        throw new Refusal(
          403,
          `You do not administer the product of ${request.group}.`,
        );
      const answer = reasonOf(req.body?.reason);
      if (!answer)
        throw new Refusal(
          400,
          'Say why it is rejected, in at most 500 characters: the person reads it.',
        );
      if (
        !(await requestsOrRefuse().decide(
          request.id,
          'rejected',
          caller.ref,
          answer,
        ))
      )
        throw new Refusal(409, 'Somebody else decided the request meanwhile.');
      logger.info(
        `access requests: ${caller.ref} rejects ${request.requester} ${request.group} (${request.component})`,
      );
      res.json({ ok: true });
    }),
  );

  // the person withdraws their own request while it waits
  router.delete(
    '/requests/:id',
    handle('withdrawal', async (req, res) => {
      const { caller, username } = await context(req);
      const request = await pendingRequestOrRefuse(req.params.id);
      if (request.requester !== username)
        throw new Refusal(403, 'Only who asked withdraws a request.');
      if (
        !(await requestsOrRefuse().decide(request.id, 'withdrawn', caller.ref))
      )
        throw new Refusal(409, 'The request was decided meanwhile.');
      res.json({ ok: true });
    }),
  );

  return router;
}
