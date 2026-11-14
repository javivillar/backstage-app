import { parse, stringify } from 'yaml';
import type { SheetOut, SheetRow } from './sheets';

/**
 * The organisations behind the business applications of a customer (docs/business-map.md, "Organisations"): its own
 * and the one of the service provider. Each is a hierarchy (head, units, teams, people) kept as one YAML file of
 * refresquito-services, so a new installation loads it from the repository and every change is a pull request:
 *
 *   catalog/organisations/customer/<customer>.yaml     the organisation of a customer
 *   catalog/organisations/provider.yaml                the organisation of the service provider (one for every customer)
 *
 * A person is named by its Keycloak user name; the portal says who has no user (the catalog has the users of
 * Keycloak). The file also names the product owner of each business application on its side: the customer product
 * owner in the organisation of the customer, the provider product owner in that of the provider.
 */

export type Side = 'customer' | 'provider';
export const SIDES: Side[] = ['customer', 'provider'];
export type Person = { name: string; user: string; role?: string };
export type Team = { name: string; people: Person[] };
export type Unit = { name: string; head?: Person; teams: Team[] };
export type ProductOwner = { application: string; user: string };
export type Organisation = { side: Side; name: string; title: string; head?: Person; units: Unit[]; productOwners: ProductOwner[] };

export class OrganisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrganisationError';
  }
}

export const API_VERSION = 'refresquito.io/v1alpha1';
export const KIND = 'Organisation';
const NAME = /^[a-z0-9]([-a-z0-9.]{0,61}[a-z0-9])?$/;
const USER = /^[a-z0-9][a-z0-9._@-]{0,62}$/i;
const MAX_TEXT = 120;
const MAX_PEOPLE = 5000;
export const PROVIDER_NAME = 'provider';

/** Where the organisation of a side is kept. */
export const organisationPath = (side: Side, namespace: string) => (side === 'provider' ? 'catalog/organisations/provider.yaml' : `catalog/organisations/customer/${namespace}.yaml`);

const text = (v: unknown, what: string, required = true): string => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  if (!s && required) throw new OrganisationError(`${what} is missing.`);
  if (s.length > MAX_TEXT) throw new OrganisationError(`${what} is longer than ${MAX_TEXT} characters.`);
  return s;
};

function person(v: unknown, where: string): Person {
  if (!v || typeof v !== 'object') throw new OrganisationError(`${where}: a person has a name and a user.`);
  const p = v as Record<string, unknown>;
  const name = text(p.name, `${where}: the name of the person`);
  const user = text(p.user, `${where}: the user name of ${name}`).toLowerCase();
  if (!USER.test(user)) throw new OrganisationError(`${where}: "${user}" is not a user name (letters, digits, ".", "_", "-", "@").`);
  const role = text(p.role, `${where}: the role of ${name}`, false);
  return { name, user, ...(role ? { role } : {}) };
}

/** Every person of the organisation, with where it is. */
export function peopleOf(org: Organisation): Array<Person & { unit?: string; team?: string; position: 'head' | 'unit head' | 'member' }> {
  return [
    ...(org.head ? [{ ...org.head, position: 'head' as const }] : []),
    ...org.units.flatMap(u => [
      ...(u.head ? [{ ...u.head, unit: u.name, position: 'unit head' as const }] : []),
      ...u.teams.flatMap(t => t.people.map(p => ({ ...p, unit: u.name, team: t.name, position: 'member' as const }))),
    ]),
  ];
}

/** An organisation from what a client or a file says; throws what is wrong with it. */
export function readOrganisation(v: unknown, expect?: { side: Side; name: string }): Organisation {
  if (!v || typeof v !== 'object') throw new OrganisationError('The organisation is an object with units and teams.');
  const o = v as Record<string, unknown>;
  const side = o.side === 'provider' ? 'provider' : 'customer';
  if (o.side !== undefined && !SIDES.includes(o.side as Side)) throw new OrganisationError(`side is one of ${SIDES.join(', ')}.`);
  const name = text(o.name, 'The name of the organisation').toLowerCase();
  if (!NAME.test(name)) throw new OrganisationError(`"${name}" is not a name: lowercase letters, digits and "-".`);
  if (expect && (expect.side !== side || expect.name !== name)) throw new OrganisationError(`The organisation is ${side}/${name}, not ${expect.side}/${expect.name}.`);
  const title = text(o.title, 'The title of the organisation', false) || name;
  const head = o.head ? person(o.head, 'The head of the organisation') : undefined;
  if (o.units !== undefined && !Array.isArray(o.units)) throw new OrganisationError('units is a list.');
  const seenUnits = new Set<string>();
  const users = new Map<string, string>();
  const note = (p: Person | undefined, where: string) => {
    if (!p) return;
    const before = users.get(p.user);
    if (before) throw new OrganisationError(`${p.user} is twice in the organisation: in ${before} and in ${where}. A person has one place.`);
    users.set(p.user, where);
  };
  note(head, 'the head of the organisation');
  const units: Unit[] = ((o.units as unknown[]) ?? []).map((raw, i) => {
    const u = (raw ?? {}) as Record<string, unknown>;
    const uname = text(u.name, `Unit ${i + 1}: its name`);
    if (seenUnits.has(uname.toLowerCase())) throw new OrganisationError(`The unit "${uname}" is twice.`);
    seenUnits.add(uname.toLowerCase());
    const uhead = u.head ? person(u.head, `Unit ${uname}`) : undefined;
    note(uhead, `the head of ${uname}`);
    if (u.teams !== undefined && !Array.isArray(u.teams)) throw new OrganisationError(`Unit ${uname}: teams is a list.`);
    const seenTeams = new Set<string>();
    const teams: Team[] = ((u.teams as unknown[]) ?? []).map((rt, j) => {
      const t = (rt ?? {}) as Record<string, unknown>;
      const tname = text(t.name, `Unit ${uname}, team ${j + 1}: its name`);
      if (seenTeams.has(tname.toLowerCase())) throw new OrganisationError(`The team "${tname}" is twice in ${uname}.`);
      seenTeams.add(tname.toLowerCase());
      if (t.people !== undefined && !Array.isArray(t.people)) throw new OrganisationError(`Team ${tname}: people is a list.`);
      const people = ((t.people as unknown[]) ?? []).map(p => person(p, `Team ${tname}`));
      people.forEach(p => note(p, `${uname} › ${tname}`));
      return { name: tname, people };
    });
    return { name: uname, ...(uhead ? { head: uhead } : {}), teams };
  });
  if (users.size > MAX_PEOPLE) throw new OrganisationError(`An organisation holds up to ${MAX_PEOPLE} people.`);
  if (o.productOwners !== undefined && !Array.isArray(o.productOwners)) throw new OrganisationError('productOwners is a list.');
  const seenApps = new Set<string>();
  const productOwners: ProductOwner[] = ((o.productOwners as unknown[]) ?? []).map(raw => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const application = text(p.application, 'A product owner: its application').toLowerCase();
    const user = text(p.user, `The product owner of ${application}`).toLowerCase();
    if (!NAME.test(application)) throw new OrganisationError(`"${application}" is not the name of an application.`);
    if (seenApps.has(application)) throw new OrganisationError(`${application} has two product owners: it has one on each side.`);
    seenApps.add(application);
    if (!users.has(user)) throw new OrganisationError(`The product owner of ${application}, ${user}, is not a person of the organisation.`);
    return { application, user };
  });
  return { side, name, title, ...(head ? { head } : {}), units, productOwners };
}

/** The organisation of a YAML file of the repository. */
export function parseOrganisation(yaml: string, expect?: { side: Side; name: string }): Organisation {
  let doc: unknown;
  try {
    doc = parse(yaml);
  } catch (e) {
    throw new OrganisationError(`The file is not YAML: ${(e as Error).message}`);
  }
  const d = (doc ?? {}) as { kind?: unknown; metadata?: { name?: unknown; title?: unknown }; spec?: Record<string, unknown> };
  if (d.kind !== KIND) throw new OrganisationError(`The file is not an ${KIND}.`);
  return readOrganisation({ ...(d.spec ?? {}), name: d.metadata?.name, title: d.metadata?.title }, expect);
}

/** The YAML file of an organisation. */
export function organisationYaml(org: Organisation): string {
  return stringify(
    {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name: org.name, title: org.title },
      spec: { side: org.side, ...(org.head ? { head: org.head } : {}), units: org.units, productOwners: [...org.productOwners].sort((a, b) => a.application.localeCompare(b.application)) },
    },
    { lineWidth: 0 },
  );
}

/** The organisation with another product owner of an application (undefined: nobody). */
export function withOwner(org: Organisation, application: string, user: string | undefined): Organisation {
  const app = application.trim().toLowerCase();
  if (!NAME.test(app)) throw new OrganisationError(`"${application}" is not the name of an application.`);
  const rest = org.productOwners.filter(p => p.application !== app);
  if (!user) return { ...org, productOwners: rest };
  const u = user.trim().toLowerCase();
  if (!peopleOf(org).some(p => p.user === u)) throw new OrganisationError(`${u} is not a person of ${org.title}: add it to the organisation first.`);
  return { ...org, productOwners: [...rest, { application: app, user: u }] };
}

// ---- the template: one row per person

export const TEMPLATE_HEAD = ['Unit', 'Team', 'Name', 'User name', 'Role', 'Position', 'Product owner of'];
export const TEMPLATE_SHEET = 'Organisation';
const POSITIONS = ['head', 'unit head', ''];

/** The organisation as the template workbook: its rows, or an example when there is none. */
export function templateSheets(org?: Organisation): SheetOut[] {
  const owned = (user: string) => (org?.productOwners ?? []).filter(p => p.user === user).map(p => p.application).join(', ');
  const rows = org
    ? peopleOf(org).map(p => [p.unit ?? '', p.team ?? '', p.name, p.user, p.role ?? '', p.position === 'member' ? '' : p.position, owned(p.user)])
    : [
        ['', '', 'Elena Ruiz Cano', 'eruiz', 'Services Director', 'head', ''],
        ['Maintenance', '', 'Raúl Méndez Ibáñez', 'rmendez', 'Head of Maintenance', 'unit head', ''],
        ['Maintenance', 'Line Maintenance', 'Diego Navarro Peña', 'dnavarro', 'Station manager', '', 'aib-etechlog'],
        ['Maintenance', 'Line Maintenance', 'Alba Serrano Cruz', 'aserrano', 'Certifying technician', '', ''],
      ];
  return [
    { name: TEMPLATE_SHEET, header: true, widths: [30, 30, 30, 18, 30, 14, 34], rows: [TEMPLATE_HEAD, ...rows] },
    {
      name: 'Guide',
      widths: [22, 110],
      rows: [
        ['Column', 'What to write'],
        ['Unit', 'The unit (department, directorate) of the person. Empty for the head of the organisation.'],
        ['Team', 'The team of the person inside its unit. Empty for the head of the organisation and for the head of a unit.'],
        ['Name', 'Name and surname.'],
        ['User name', 'The user name of the person in Keycloak. The portal marks the people who have no user.'],
        ['Role', 'What the person does in the team (free text).'],
        ['Position', '"head" for the head of the organisation (one row), "unit head" for the head of a unit, empty for a member of a team.'],
        ['Product owner of', 'The business applications this person is the product owner of, separated by commas (their names in the catalogue, e.g. aib-etechlog).'],
      ],
    },
  ];
}

export type RowError = { row: number; message: string };

/** An organisation from the rows of the template (the first row is the header); the rows that are wrong are left out and listed. */
export function organisationFromRows(rows: SheetRow[], into: { side: Side; name: string; title?: string }): { organisation: Organisation; errors: RowError[] } {
  const errors: RowError[] = [];
  const head = rows[0]?.cells.map(c => c.trim().toLowerCase()) ?? [];
  const col = (label: string) => head.indexOf(label.toLowerCase());
  const at = Object.fromEntries(TEMPLATE_HEAD.map(h => [h, col(h)])) as Record<string, number>;
  for (const need of ['Name', 'User name']) if (at[need] < 0) throw new OrganisationError(`The sheet has no column "${need}": use the template (columns ${TEMPLATE_HEAD.join(', ')}).`);
  const cell = (r: SheetRow, h: string) => (at[h] >= 0 ? (r.cells[at[h]] ?? '').trim() : '');
  const org: Record<string, unknown> & { units: Array<{ name: string; head?: Person; teams: Array<{ name: string; people: Person[] }> }>; productOwners: ProductOwner[] } = {
    side: into.side,
    name: into.name,
    title: into.title || into.name,
    units: [],
    productOwners: [],
  };
  const seen = new Map<string, number>();
  for (const r of rows.slice(1)) {
    if (r.cells.every(c => !c.trim())) continue;
    const fail = (message: string) => errors.push({ row: r.n, message });
    const name = cell(r, 'Name');
    const user = cell(r, 'User name').toLowerCase();
    const position = cell(r, 'Position').toLowerCase();
    const unit = cell(r, 'Unit');
    const team = cell(r, 'Team');
    if (!name || !user) {
      fail('A row needs a name and a user name.');
      continue;
    }
    if (!USER.test(user)) {
      fail(`"${user}" is not a user name.`);
      continue;
    }
    if (!POSITIONS.includes(position)) {
      fail(`Position "${position}" is not one of: head, unit head, or empty.`);
      continue;
    }
    if (seen.has(user)) {
      fail(`${user} is already in row ${seen.get(user)}: a person has one place.`);
      continue;
    }
    const role = cell(r, 'Role');
    const p: Person = { name, user, ...(role ? { role } : {}) };
    if (position === 'head') {
      if (org.head) {
        fail('The organisation already has a head in another row.');
        continue;
      }
      org.head = p;
    } else {
      if (!unit) {
        fail('A person who is not the head of the organisation needs a unit.');
        continue;
      }
      let u = org.units.find(x => x.name.toLowerCase() === unit.toLowerCase());
      if (!u) {
        u = { name: unit, teams: [] };
        org.units.push(u);
      }
      if (position === 'unit head') {
        if (u.head) {
          fail(`The unit ${u.name} already has a head in another row.`);
          continue;
        }
        u.head = p;
      } else {
        if (!team) {
          fail('A member needs a team (or the position "unit head").');
          continue;
        }
        let t = u.teams.find(x => x.name.toLowerCase() === team.toLowerCase());
        if (!t) {
          t = { name: team, people: [] };
          u.teams.push(t);
        }
        t.people.push(p);
      }
    }
    seen.set(user, r.n);
    for (const app of cell(r, 'Product owner of').split(/[,;]/).map(a => a.trim().toLowerCase()).filter(Boolean)) {
      if (!NAME.test(app)) fail(`"${app}" is not the name of an application: left out.`);
      else if (org.productOwners.some(x => x.application === app)) fail(`${app} already has a product owner in another row: left out here.`);
      else org.productOwners.push({ application: app, user });
    }
  }
  return { organisation: readOrganisation(org, { side: into.side, name: into.name }), errors };
}

// ---- what the portal shows

export type PersonView = Person & { inKeycloak?: boolean };
export type OrganisationView = Omit<Organisation, 'head' | 'units'> & { head?: PersonView; units: Array<{ name: string; head?: PersonView; teams: Array<{ name: string; people: PersonView[] }> }>; path: string };
export type Counts = { units: number; teams: number; people: number; notInKeycloak: number; productOwners: number };

/** The organisation with who has a Keycloak user (users: their names; undefined when the catalog has none to compare with). */
export function organisationView(org: Organisation, users: Set<string> | undefined, namespace: string): OrganisationView {
  const mark = (p: Person): PersonView => (users ? { ...p, inKeycloak: users.has(p.user) } : p);
  return {
    ...org,
    head: org.head ? mark(org.head) : undefined,
    units: org.units.map(u => ({ name: u.name, head: u.head ? mark(u.head) : undefined, teams: u.teams.map(t => ({ name: t.name, people: t.people.map(mark) })) })),
    path: organisationPath(org.side, namespace),
  };
}

export function countsOf(org: Organisation, users?: Set<string>): Counts {
  const people = peopleOf(org);
  return {
    units: org.units.length,
    teams: org.units.reduce((n, u) => n + u.teams.length, 0),
    people: people.length,
    notInKeycloak: users ? people.filter(p => !users.has(p.user)).length : 0,
    productOwners: org.productOwners.length,
  };
}

export type OwnerView = { user: string; name: string; role?: string; unit?: string; team?: string; inKeycloak?: boolean };
export type ApplicationOwnership = { name: string; title: string; ref: string; criticality?: string; processes: number; customer?: OwnerView; provider?: OwnerView };

/** Who answers for each business application on each side. */
export function ownershipOf(
  applications: Array<{ name: string; title: string; ref: string; criticality?: string; processes: number }>,
  customer: Organisation | undefined,
  provider: Organisation | undefined,
  users: Set<string> | undefined,
): ApplicationOwnership[] {
  const owner = (org: Organisation | undefined, app: string): OwnerView | undefined => {
    const po = org?.productOwners.find(p => p.application === app);
    const p = po && org ? peopleOf(org).find(x => x.user === po.user) : undefined;
    return p ? { user: p.user, name: p.name, role: p.role, unit: p.unit, team: p.team, ...(users ? { inKeycloak: users.has(p.user) } : {}) } : undefined;
  };
  return applications.map(a => ({ ...a, customer: owner(customer, a.name), provider: owner(provider, a.name) }));
}

/** The title and the text of the pull request of a change of an organisation. */
export function organisationPull(org: Organisation, by: string, what: string, path: string): { title: string; body: string } {
  const c = countsOf(org);
  const who = org.side === 'provider' ? 'the provider organisation' : `the organisation of ${org.name}`;
  return {
    title: `business map: ${what} of ${who}`,
    body: [
      `${what[0].toUpperCase()}${what.slice(1)} of ${who} (${org.title}), asked from the console by ${by}.`,
      '',
      `- File: \`${path}\``,
      `- ${c.units} unit(s), ${c.teams} team(s), ${c.people} people, ${c.productOwners} product owner(s)`,
      '',
      'Once merged, Business continuity › Organisation and Ownership show it within a minute. Nothing is written to Keycloak: a person is matched with its Keycloak user by user name.',
    ].join('\n'),
  };
}
