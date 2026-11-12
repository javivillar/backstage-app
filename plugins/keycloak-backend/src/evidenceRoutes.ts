import { accessToArea, isPortalAdmin } from '@internal/backstage-plugin-portal-access-common';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { parseEntityRef } from '@backstage/catalog-model';
import { Request, Response, Router } from 'express';
import { kcAdminFetch } from './actions';
import { productsOf, type AccessRules, type KcGroup, type Product } from './accessModel';
import type { AccessRequestStore } from './accessRequests';
import type { AccessStore } from './accessStore';
import { byPerson, findingsOf, INACTIVE_DAYS, inactiveWindow, MIN_INACTIVE_DAYS, parse, RECENT_DAYS, reportOf, verify, type Account, type Members, type ReportRow } from './evidenceModel';
import type { EvidenceStore } from './evidenceStore';
import { tagsOf } from './security';

/**
 * /api/keycloak-manager/evidence: Control and evidence (the rules are in evidenceModel.ts). Read by who has the area
 * `evidence` of the table of permissions (the administrators of the portal, the security team, the auditors):
 * what needs a decision, the activity recorded, the report of access now and at each snapshot, and the proposals
 * of double approval. Nothing here changes Keycloak; only an administrator of the portal takes a snapshot by hand.
 */

const DAY = 24 * 60 * 60 * 1000;
/** how long what was read from Keycloak is reused: every tab of the page asks for it */
const CACHE_MS = 60 * 1000;

type KcUser = { id: string; username: string; enabled?: boolean; createdTimestamp?: number };
type Realm = { at: number; products: Product[]; members: Members; untagged: string[]; accounts: Account[]; lastSignIn?: Record<string, number>; inactiveDays?: number };

export type Activity = { at: string; who: string; kind: 'access' | 'approval' | 'refused'; action: string; username: string; group: string; component: string; note?: string };

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function evidenceRouter(options: {
  config: Config;
  logger: LoggerService;
  rules: AccessRules;
  store?: AccessStore;
  requests?: AccessRequestStore;
  evidence?: EvidenceStore;
  /** whether the platform has an evidence key: the snapshots are signed */
  signs: boolean;
  key?: string;
  caller(req: Request): Promise<{ entityRef: string; ownershipEntityRefs: string[] }>;
}): { router: Router; snapshot(takenBy: string): Promise<void> } {
  const { config, logger, rules, store, requests, evidence } = options;
  const router = Router();
  let cached: Realm | undefined;

  async function kc<T>(path: string): Promise<T> {
    const res = await kcAdminFetch(config, path);
    if (!res.ok) throw new Error(`Keycloak GET ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  /** When each person last signed in, from the login events of Keycloak; undefined when it does not record them. */
  async function signIns(now: number): Promise<{ last: Record<string, number>; days: number } | undefined> {
    try {
      const settings = await kc<{ eventsEnabled?: boolean; eventsExpiration?: number }>('');
      // a sign-in older than what Keycloak keeps is not known: the period is never longer than that
      const days = settings.eventsEnabled ? inactiveWindow(settings.eventsExpiration) : undefined;
      if (!days) return undefined;
      const from = new Date(now - days * DAY).toISOString().slice(0, 10);
      const last: Record<string, number> = {};
      const ids: Record<string, number> = {};
      for (let first = 0; first < 50000; first += 1000) {
        const page = await kc<Array<{ time: number; userId?: string; details?: { username?: string } }>>(`/events?type=LOGIN&dateFrom=${from}&first=${first}&max=1000`);
        for (const e of page) {
          if (e.details?.username) last[e.details.username] = Math.max(last[e.details.username] ?? 0, e.time);
          else if (e.userId) ids[e.userId] = Math.max(ids[e.userId] ?? 0, e.time);
        }
        if (page.length < 1000) break;
      }
      return { days, last: { ...last, ...Object.fromEntries(Object.entries(ids).map(([id, t]) => [`id:${id}`, t])) } };
    } catch (e) {
      logger.info(`control and evidence: the sign-ins cannot be read (${(e as Error).message}): nobody is called inactive`);
      return undefined;
    }
  }

  /** The realm as the findings and the report need it; reused for a minute. */
  async function realm(fresh = false): Promise<Realm> {
    const now = Date.now();
    if (!fresh && cached && now - cached.at < CACHE_MS) return cached;
    const groups = await kc<KcGroup[]>('/groups?briefRepresentation=false&max=10000');
    const members: Members = {};
    for (const g of groups) members[g.name] = (await kc<KcUser[]>(`/groups/${g.id}/members?briefRepresentation=true&max=10000`)).map(u => u.username);
    const users = await kc<KcUser[]>('/users?briefRepresentation=true&max=10000');
    const seen = await signIns(now);
    const lastSignIn = seen && Object.fromEntries(users.map(u => [u.username, seen.last[u.username] ?? seen.last[`id:${u.id}`]]).filter(([, t]) => t !== undefined));
    cached = {
      at: now,
      products: productsOf(groups, rules),
      members,
      untagged: groups.filter(g => !tagsOf(g.attributes).component).map(g => g.name),
      accounts: users.filter(u => !u.username.startsWith('service-account-')).map(u => ({ username: u.username, enabled: u.enabled !== false, createdAt: u.createdTimestamp })),
      lastSignIn,
      inactiveDays: seen?.days,
    };
    return cached;
  }

  const handle = (what: string, fn: (req: Request, res: Response, who: { ref: string; portalAdmin: boolean }) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      const who = await options.caller(req);
      if (accessToArea('evidence', who.ownershipEntityRefs) === 'hidden') throw new Refusal(403, 'Control and evidence is for the administrators of the portal, the security team and the auditors.');
      await fn(req, res, { ref: who.entityRef, portalAdmin: isPortalAdmin(who.ownershipEntityRefs) });
    } catch (e) {
      if (e instanceof Refusal) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      logger.error(`keycloak-manager /evidence ${what} failed`, e as Error);
      res.status(500).json({ error: (e as Error).message });
    }
  };

  router.get(
    '/overview',
    handle('overview', async (_req, res) => {
      const r = await realm();
      const now = Date.now();
      const added = store ? await store.addedSince(new Date(now - RECENT_DAYS * DAY)) : {};
      const findings = findingsOf({ ...r, added, now });
      const week = store ? (await store.recent(1000)).filter(c => now - Date.parse(c.at) < 7 * DAY && c.action !== 'refused').length : 0;
      res.json({
        findings,
        kpis: {
          atRisk: findings.filter(f => f.kind === 'no-admin' || f.kind === 'single-admin').length,
          inactive: findings.find(f => f.kind === 'inactive')?.count ?? 0,
          approvals: requests ? (await requests.proposed()).pending.length : 0,
          changesWeek: week,
        },
        signIns: Boolean(r.lastSignIn),
        inactiveDays: r.inactiveDays ?? INACTIVE_DAYS,
        minInactiveDays: MIN_INACTIVE_DAYS,
        recentDays: RECENT_DAYS,
      });
    }),
  );

  // one record: the changes of access, the refused attempts and the decisions on requests, the most recent first
  router.get(
    '/activity',
    handle('activity', async (_req, res) => {
      const short = (ref?: string) => (ref ? parseEntityRef(ref).name : '');
      const changes: Activity[] = (store ? await store.recent() : []).map(c => ({
        at: c.at,
        who: short(c.actor),
        kind: c.action === 'refused' ? 'refused' : 'access',
        action: c.action,
        username: c.username,
        group: c.group,
        component: c.component,
      }));
      const decisions: Activity[] = (requests ? await requests.decidedRecently() : []).map(r => ({
        at: r.decidedAt ?? r.at,
        who: short(r.decidedBy),
        kind: 'approval',
        action: r.state,
        username: r.requester,
        group: r.group,
        component: r.component,
        note: r.proposedBy ? short(r.proposedBy) : undefined,
      }));
      res.json({ recorded: Boolean(store), activity: [...changes, ...decisions].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500) });
    }),
  );

  // the report of access: now, or as a snapshot kept it (?snapshot=<id>)
  router.get(
    '/report',
    handle('report', async (req, res) => {
      const snapshots = evidence ? await evidence.list() : [];
      const id = req.query.snapshot ? Number(req.query.snapshot) : undefined;
      let rows: ReportRow[];
      let of: object;
      if (id === undefined) {
        const r = await realm();
        rows = reportOf(r.products, r.members);
        of = { at: new Date(r.at).toISOString(), live: true };
      } else {
        const kept = await evidence?.get(id);
        if (!kept) throw new Refusal(404, `There is no snapshot ${id}.`);
        rows = parse(kept.text);
        of = { at: kept.at, live: false, id: kept.id, takenBy: kept.takenBy, digest: kept.digest, signature: kept.signature, state: verify(kept, options.key) };
      }
      res.json({ of, rows, people: byPerson(rows), snapshots, kept: Boolean(evidence), signs: options.signs });
    }),
  );

  async function snapshot(takenBy: string): Promise<void> {
    if (!evidence) throw new Refusal(503, 'Snapshots cannot be kept (no database).');
    const r = await realm(true);
    const taken = await evidence.take(reportOf(r.products, r.members), takenBy);
    logger.info(`control and evidence: snapshot ${taken.id} taken by ${takenBy}: ${taken.groups} groups, ${taken.people} people, ${taken.signature ? 'signed' : 'not signed (no evidence key)'}`);
  }

  router.post(
    '/snapshots',
    handle('snapshot', async (_req, res, who) => {
      if (!who.portalAdmin) throw new Refusal(403, 'Only the administrators of the portal take a snapshot.');
      await snapshot(who.ref);
      res.status(201).json({ ok: true });
    }),
  );

  // the proposals of double approval: what waits for a second administrator, and the last decided
  router.get(
    '/approvals',
    handle('approvals', async (_req, res, who) => {
      const { pending, decided } = requests ? await requests.proposed() : { pending: [], decided: [] };
      res.json({ pending, decided, me: who.ref, decides: who.portalAdmin, kept: Boolean(requests) });
    }),
  );

  return { router, snapshot };
}
