import { productsOf, type KcGroup } from './accessModel';
import { byPerson, canonical, digestOf, findingsOf, inactiveWindow, parse, reportOf, signatureOf, verify } from './evidenceModel';

const tag = (component: string) => ({ 'refresquito.component': [component] });
const GROUPS: KcGroup[] = [
  { id: '1', name: 'superset-admin', attributes: tag('superset-oneke') },
  { id: '2', name: 'superset-users', attributes: tag('superset-oneke') },
  { id: '3', name: 'operaton-admin', attributes: tag('operaton-oneke') },
  { id: '4', name: 'whisker-admin', attributes: tag('whisker-oneke') },
  { id: '5', name: 's3-admins', attributes: tag('seaweedfs-oneke') },
  { id: '6', name: 'seaweedfs-admin', attributes: tag('seaweedfs-oneke') },
];
const products = productsOf(GROUPS);
const members = { 'superset-admin': ['ana', 'luis'], 'superset-users': ['eva', 'old'], 'operaton-admin': ['ana'], 's3-admins': ['luis', 'rosa'], 'seaweedfs-admin': ['ana', 'luis'] };
const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 12);
const accounts = ['ana', 'luis', 'eva', 'old', 'rosa'].map(username => ({ username, enabled: true, createdAt: now - 400 * DAY }));

describe('what needs a decision', () => {
  const base = { products, members, untagged: ['made-by-hand'], added: { 's3-admins': ['rosa'] }, accounts, now };

  it('finds the products at risk, the sensitive groups, the empty ones and the ones of nobody', () => {
    const found = findingsOf(base);
    expect(found.map(f => [f.kind, f.subject, f.count])).toEqual([
      ['single-admin', 'operaton-oneke', 1],
      ['no-admin', 'whisker-oneke', 0],
      ['sensitive', 's3-admins', 2],
      ['empty', undefined, 1],
      ['no-owner', undefined, 1],
    ]);
    expect(found[0].names).toEqual(['ana']);
    expect(found[2]).toMatchObject({ recent: 1, product: 'seaweedfs-oneke' });
    expect(found[3].names).toEqual(['whisker-admin']);
  });

  it('calls nobody inactive while Keycloak does not record the sign-ins', () => {
    expect(findingsOf(base).some(f => f.kind === 'inactive')).toBe(false);
  });

  it('finds who keeps access without signing in for 90 days', () => {
    const lastSignIn = { ana: now - DAY, luis: now - 10 * DAY, eva: now - 89 * DAY, rosa: now - 91 * DAY };
    const [inactive] = findingsOf({ ...base, lastSignIn }).filter(f => f.kind === 'inactive');
    // old never signed in and was created long ago; rosa 91 days ago
    expect(inactive).toMatchObject({ count: 2, names: ['old', 'rosa'], recent: 2 });
    // a new account that has not signed in yet is not inactive
    const fresh = accounts.map(a => (a.username === 'old' ? { ...a, createdAt: now - DAY } : a));
    expect(findingsOf({ ...base, accounts: fresh, lastSignIn }).find(f => f.kind === 'inactive')?.names).toEqual(['rosa']);
  });
});

describe('the period of inactivity', () => {
  it('is never longer than what Keycloak keeps of its sign-ins', () => {
    expect(inactiveWindow(10 * 24 * 60 * 60)).toBe(10);
    expect(inactiveWindow(400 * 24 * 60 * 60)).toBe(90);
    // 30 hours, or nothing: too little to call anybody inactive
    expect(inactiveWindow(108000)).toBeUndefined();
    expect(inactiveWindow(undefined)).toBeUndefined();
  });

  it('finds who has not signed in within it', () => {
    const lastSignIn = { ana: now - DAY, luis: now - 11 * DAY, eva: now - 9 * DAY, rosa: now - 12 * DAY, old: now - 2 * DAY };
    const [inactive] = findingsOf({ products, members, untagged: [], added: {}, accounts, lastSignIn, inactiveDays: 10, now }).filter(f => f.kind === 'inactive');
    expect(inactive.names).toEqual(['luis', 'rosa']);
  });
});

describe('the report of access', () => {
  const rows = reportOf(products, members);

  it('lists who is in each group of each product, and what each person holds', () => {
    expect(rows.find(r => r.group === 's3-admins')).toEqual({ component: 'seaweedfs-oneke', group: 's3-admins', members: ['luis', 'rosa'] });
    expect(rows.find(r => r.group === 'whisker-admin')?.members).toEqual([]);
    expect(byPerson(rows).find(p => p.username === 'ana')?.groups).toEqual(['operaton-admin', 'seaweedfs-admin', 'superset-admin']);
  });

  it('is the same text for the same realm, and comes back from it', () => {
    const text = canonical(rows);
    expect(canonical(reportOf(productsOf([...GROUPS].reverse()), members))).toBe(text);
    expect(parse(text)).toEqual(rows);
  });

  it('shows a snapshot that was changed after it was signed', () => {
    const text = canonical(rows);
    const at = '2026-11-12T02:00:00.000Z';
    const digest = digestOf(text);
    const signature = signatureOf(digest, at, 'key-of-the-platform');
    expect(verify({ at, text, digest, signature }, 'key-of-the-platform')).toBe('ok');
    expect(verify({ at, text: text.replace('rosa', 'mallory'), digest, signature }, 'key-of-the-platform')).toBe('altered');
    expect(verify({ at: '2026-11-11T02:00:00.000Z', text, digest, signature }, 'key-of-the-platform')).toBe('altered');
    expect(verify({ at, text, digest, signature }, 'another-key')).toBe('altered');
    expect(verify({ at, text, digest }, 'key-of-the-platform')).toBe('unsigned');
    expect(signatureOf(digest, at)).toBeUndefined();
  });
});
