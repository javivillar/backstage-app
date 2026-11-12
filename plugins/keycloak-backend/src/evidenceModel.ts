import { createHash, createHmac } from 'crypto';
import type { Product } from './accessModel';

/**
 * Control and evidence (console › Portal › Administration › Control and evidence): what needs a decision in who has access
 * to what, and the report of access that can be shown to an auditor. The rules, kept pure for the tests;
 * evidenceRoutes.ts reads Keycloak and the database and applies them.
 */

/** nobody is called inactive before this many days without signing in... */
export const INACTIVE_DAYS = 90;
/** ...or fewer, when Keycloak keeps its login events for less: the days it keeps them, never under this */
export const MIN_INACTIVE_DAYS = 7;

/**
 * After how many days without signing in a person is inactive, given how long Keycloak keeps its login events
 * (seconds): what is not kept cannot be told apart from no sign-in. Undefined when it keeps them too little.
 */
export function inactiveWindow(eventsExpirationSeconds: number | undefined): number | undefined {
  const kept = Math.floor((eventsExpirationSeconds ?? 0) / (24 * 60 * 60));
  return kept >= MIN_INACTIVE_DAYS ? Math.min(INACTIVE_DAYS, kept) : undefined;
}
export const RECENT_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export type FindingKind = 'no-admin' | 'single-admin' | 'inactive' | 'sensitive' | 'empty' | 'no-owner';
export type Finding = {
  kind: FindingKind;
  tone: 'bad' | 'warn' | 'info';
  /** the product, the group or nothing (a finding about several) */
  subject?: string;
  /** how many people or groups it is about */
  count: number;
  /** the names it is about (people or groups), the first ones */
  names: string[];
  /** added to a sensitive group in the last RECENT_DAYS */
  recent?: number;
  /** where to act in Access administration */
  product?: string;
};

/** Who is in each group, by group name. */
export type Members = Record<string, string[]>;
/** A person of the realm as the findings need them. */
export type Account = { username: string; enabled: boolean; createdAt?: number };

const SHOWN = 5;
const first = (names: string[]) => [...names].sort().slice(0, SHOWN);

/**
 * What needs a decision, the worst first.
 * - `untagged`: groups without the security tags (they belong to no product).
 * - `added`: the people added to each group since RECENT_DAYS ago (from the record of access administration).
 * - `lastSignIn`: when each person last signed in; undefined when Keycloak does not record sign-ins, and then
 *   nobody is called inactive.
 */
export function findingsOf(input: {
  products: Product[];
  members: Members;
  untagged: string[];
  added: Record<string, string[]>;
  accounts: Account[];
  lastSignIn?: Record<string, number>;
  /** days without signing in that make a person inactive (inactiveWindow); INACTIVE_DAYS when not said */
  inactiveDays?: number;
  now: number;
}): Finding[] {
  const { products, members, untagged, added, accounts, lastSignIn, now } = input;
  const of = (group: string) => members[group] ?? [];
  const out: Finding[] = [];

  for (const p of products) {
    if (!p.adminGroups.length) continue; // administered only by the portal administrators, by design
    const admins = [...new Set(p.adminGroups.flatMap(of))];
    if (admins.length === 0) out.push({ kind: 'no-admin', tone: 'bad', subject: p.component, count: 0, names: p.adminGroups, product: p.component });
    else if (admins.length === 1) out.push({ kind: 'single-admin', tone: 'bad', subject: p.component, count: 1, names: admins, product: p.component });
  }

  if (lastSignIn) {
    const holds = new Set(Object.values(members).flat());
    const inactive = accounts.filter(a => {
      if (!a.enabled || !holds.has(a.username)) return false;
      const last = lastSignIn[a.username] ?? a.createdAt ?? 0;
      return now - last > (input.inactiveDays ?? INACTIVE_DAYS) * DAY;
    });
    if (inactive.length) {
      const names = inactive.map(a => a.username);
      const groups = new Set(Object.entries(members).filter(([, m]) => m.some(u => names.includes(u))).map(([g]) => g));
      out.push({ kind: 'inactive', tone: 'warn', count: names.length, names: first(names), recent: groups.size });
    }
  }

  for (const p of products) {
    for (const g of p.groups.filter(x => x.portalOnly && !x.from)) {
      const inside = of(g.name);
      if (inside.length) out.push({ kind: 'sensitive', tone: 'warn', subject: g.name, count: inside.length, names: first(inside), recent: (added[g.name] ?? []).length, product: p.component });
    }
  }

  const empty = products.flatMap(p => p.groups.filter(g => !g.from && of(g.name).length === 0).map(g => g.name));
  if (empty.length) out.push({ kind: 'empty', tone: 'warn', count: empty.length, names: first(empty) });
  if (untagged.length) out.push({ kind: 'no-owner', tone: 'info', count: untagged.length, names: first(untagged) });

  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

// --- the report of access ------------------------------------------------------------------------------------------

export type ReportRow = { component: string; group: string; members: string[] };
export type PersonRow = { username: string; groups: string[] };

/** Who is in each group of each product, sorted: the same realm always gives the same report. */
export function reportOf(products: Product[], members: Members): ReportRow[] {
  return products
    .flatMap(p => p.groups.filter(g => !g.from).map(g => ({ component: p.component, group: g.name, members: [...(members[g.name] ?? [])].sort() })))
    .sort((a, b) => a.component.localeCompare(b.component) || a.group.localeCompare(b.group));
}

/** The same report by person: the groups each one holds. */
export function byPerson(rows: ReportRow[]): PersonRow[] {
  const groups = new Map<string, Set<string>>();
  for (const r of rows) for (const u of r.members) groups.set(u, (groups.get(u) ?? new Set()).add(r.group));
  return [...groups.entries()].map(([username, g]) => ({ username, groups: [...g].sort() })).sort((a, b) => a.username.localeCompare(b.username));
}

/** The report as text, one line per group: what is digested and signed, and what a snapshot keeps. */
export const canonical = (rows: ReportRow[]): string => rows.map(r => [r.component, r.group, r.members.join(' ')].join('\t')).join('\n');

export const digestOf = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** HMAC-SHA256 of the digest and its date with the evidence key of the platform; undefined without a key. */
export const signatureOf = (digest: string, at: string, key?: string): string | undefined => (key ? createHmac('sha256', key).update(`${at}\n${digest}`, 'utf8').digest('hex') : undefined);

/** Whether a snapshot is as it was signed. */
export function verify(snapshot: { at: string; text: string; digest: string; signature?: string }, key?: string): 'ok' | 'unsigned' | 'altered' {
  if (digestOf(snapshot.text) !== snapshot.digest) return 'altered';
  if (!snapshot.signature) return 'unsigned';
  return signatureOf(snapshot.digest, snapshot.at, key) === snapshot.signature ? 'ok' : 'altered';
}

/** The rows of a snapshot back from its text. */
export const parse = (text: string): ReportRow[] =>
  text
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [component, group, members = ''] = line.split('\t');
      return { component, group, members: members ? members.split(' ') : [] };
    });
