import type { Entity } from '@backstage/catalog-model';
import { appsOf, daysBetween, isLine, linesOf, statusOf } from './model';

const line = (framework: string, version: string, supportedUntil: string, extra: Partial<Entity['metadata']> = {}, spec: Record<string, unknown> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: `${framework}-${version.replace('.', '-')}`,
    title: `${framework} ${version}`,
    tags: ['framework', 'framework-line'],
    annotations: { 'refresquito.io/framework-line': version, 'refresquito.io/supported-until': supportedUntil, 'refresquito.io/versions': `lib ${version}.x` },
    ...extra,
  },
  spec: { type: 'library', lifecycle: 'production', owner: 'development-team', subcomponentOf: `component:default/${framework}`, ...spec },
});

const instance = (name: string, application: string, version: string, stage?: string, spec: Record<string, unknown> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name,
    annotations: {
      'argocd/app-name': name,
      'refresquito.io/framework-line': version,
      'refresquito.io/application': application,
      ...(stage ? { 'refresquito.io/stage': stage } : {}),
    },
  },
  spec: { type: 'application-instance', lifecycle: 'production', owner: 'group:default/team', ...spec },
});

const block = (name: string, application: string, b: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: { name, annotations: { 'refresquito.io/platform-block': b, 'refresquito.io/application': application } },
  spec: { type: 'platform-block', owner: 'team' },
});

const python = [line('python-framework', '3.2', '2027-04-28'), line('python-framework', '3.3', 'while it is the latest line of the latest major version'), line('python-framework', '3.1', '2027-01-20')];
const spring = [line('spring-framework', '1.0', 'not released yet')];

describe('isLine', () => {
  it('accepts the tag and spec.type framework-line', () => {
    expect(isLine(line('python-framework', '3.3', 'x'))).toBe(true);
    expect(isLine(line('python-framework', '3.3', 'x', { tags: [] }, { type: 'framework-line' }))).toBe(true);
    expect(isLine(instance('petstore', 'petstore', '3.3'))).toBe(false);
  });
});

describe('linesOf', () => {
  it('sorts 3.10 after 3.9 and groups by framework', () => {
    const ls = linesOf([line('python-framework', '3.10', 'x'), ...spring, line('python-framework', '3.9', 'x')]);
    expect(ls.map(l => `${l.framework} ${l.line}`)).toEqual(['python-framework 3.9', 'python-framework 3.10', 'spring-framework 1.0']);
    expect(ls[0].ref).toBe('component:default/python-framework-3-9');
    expect(ls[0].versions).toBe('lib 3.9.x');
  });
  it('supported-until text keeps supportText and no date', () => {
    const [l] = linesOf([line('python-framework', '3.3', 'while it is the latest line…')]);
    expect(l.supportedUntil).toBeUndefined();
    expect(l.supportText).toBe('while it is the latest line…');
  });
  it('reads an ISO date and the requirements', () => {
    const [l] = linesOf([line('python-framework', '3.2', '2027-04-28', { annotations: { 'refresquito.io/framework-line': '3.2', 'refresquito.io/supported-until': '2027-04-28', 'refresquito.io/requires': 'iam-oneke, monitoring' } })]);
    expect(l.supportedUntil).toBe('2027-04-28');
    expect(l.requires).toEqual(['iam-oneke', 'monitoring']);
  });
  it('takes the title of the framework entity when it is there', () => {
    const fw: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'python-framework', title: 'Python Framework' }, spec: { type: 'development-service' } };
    expect(linesOf([fw, ...spring, python[0]]).find(l => l.framework === 'python-framework')?.frameworkTitle).toBe('Python Framework');
    expect(linesOf([fw, ...spring]).find(l => l.framework === 'spring-framework')?.frameworkTitle).toBe('spring-framework');
  });
});

describe('appsOf', () => {
  const lines = linesOf([...python, ...spring]);
  it('groups dev/pre/pro instances of one application', () => {
    const apps = appsOf(
      [instance('petstore-dev', 'petstore', '3.3', 'dev'), instance('petstore-pre', 'petstore', '3.3', 'pre'), instance('petstore', 'petstore', '3.2'), block('petstore-s3', 'petstore-dev', 's3'), block('petstore-mon', 'petstore', 'monitoring'), block('petstore-mon-dev', 'petstore-dev', 'monitoring')],
      lines,
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].lines).toEqual({ dev: '3.3', pre: '3.3', pro: '3.2' });
    expect(apps[0].instances).toEqual({ dev: 'component:default/petstore-dev', pre: 'component:default/petstore-pre', pro: 'component:default/petstore' });
    expect(apps[0].framework).toBe('python-framework');
    expect(apps[0].blocks).toEqual(['monitoring', 's3']);
    expect(apps[0].owner).toBe('group:default/team');
  });
  it('skips the lines and the services of a Spring application', () => {
    const part = instance('petshop-orders', 'petshop', '1.0', 'dev');
    part.metadata.annotations!['refresquito.io/service'] = 'orders';
    expect(appsOf([...python, part, instance('petshop-dev', 'petshop', '1.0', 'dev')], lines).map(a => Object.keys(a.instances))).toEqual([['dev']]);
  });
  it('finds the framework from dependsOn before the line number', () => {
    const [a] = appsOf([instance('x-dev', 'x', '1.0', 'dev', { dependsOn: ['component:default/spring-framework-1-0'] })], lines);
    expect(a.framework).toBe('spring-framework');
  });
});

describe('statusOf', () => {
  const lines = linesOf([...python, ...spring]);
  const today = '2026-11-08';
  it('dev-only app is absent in pro', () => {
    const [ps] = appsOf([instance('personnelsecurity-dev', 'personnelsecurity', '3.3', 'dev')], lines);
    expect(statusOf(ps, 'pro', lines, today)).toEqual({ kind: 'absent' });
    expect(statusOf(ps, 'dev', lines, today)).toEqual({ kind: 'latest' });
  });
  it('spring compares within its framework', () => {
    const [petshop] = appsOf([instance('petshop-dev', 'petshop', '1.0', 'dev')], lines);
    expect(statusOf(petshop, 'dev', lines, today)).toEqual({ kind: 'latest' });
  });
  it('ending wins over behind', () => {
    const [orders] = appsOf([instance('orders', 'orders', '3.1')], lines);
    expect(statusOf(orders, 'pro', lines, today)).toEqual({ kind: 'ending', daysLeft: 73 });
  });
  it('counts the newer lines of the same framework', () => {
    const [a] = appsOf([instance('a', 'a', '3.2')], lines);
    expect(statusOf(a, 'pro', lines, '2026-01-01')).toEqual({ kind: 'behind', behind: 1, daysLeft: 482 });
  });
  it('line with text support never ends', () => {
    const [a] = appsOf([instance('a', 'a', '3.3')], lines);
    const s = statusOf(a, 'pro', lines, today);
    expect(s.kind).not.toBe('ending');
    expect(s.daysLeft).toBeUndefined();
  });
  it('a past date gives no negative countdown', () => {
    const [orders] = appsOf([instance('orders', 'orders', '3.1')], lines);
    expect(statusOf(orders, 'pro', lines, '2027-03-01')).toEqual({ kind: 'ending', daysLeft: 0 });
  });
  it('a line the catalog no longer keeps is behind', () => {
    const [old] = appsOf([instance('old-dev', 'old', '3.3', 'dev'), instance('old', 'old', '2.0')], lines);
    expect(old.framework).toBe('python-framework');
    expect(statusOf(old, 'pro', lines, today)).toEqual({ kind: 'behind', behind: 3 });
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => expect(daysBetween('2026-11-08', '2027-01-20')).toBe(73));
});
