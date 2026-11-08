import './manageHandlersIam';
import './manageHandlersGravitee';
import './manageHandlersDatahub';
import './manageHandlersSuperset';
import './manageHandlersProcesses';
import './manageHandlersMonitoring';
import { parseDocument } from 'yaml';
import { applyChange, ChangeError, handlerFor, type ChangeRequest } from './manageModel';
import { groupsWithTombstones } from './manageHandlersProcesses';

const APP = `# Animal shelter
name: animalshelter
title: "Animal shelter"
platform:
  sso:
    enabled: true
    roles:
      - { name: coordinator, description: "manages everything", users: [javi] }
      - { name: staff, description: "registers the animals", groups: [helpdesk] }
    testUsers: false
    extraRedirectUris: ["http://localhost:4200/*"]
  datahub:
    enabled: true
    description: "Animals and adoptions"
    classification: "CONFIDENTIAL"
  gateway:
    enabled: true
    team: gravitee-team-alpha
`;

const app = { kind: 'application' as const, name: 'animalshelter' };
const platform = { kind: 'platform' as const };
const run = (r: Partial<ChangeRequest> & Pick<ChangeRequest, 'service' | 'object' | 'action'>, text = APP) =>
  applyChange(text, handlerFor(r.service, r.object), { owner: app, ...r } as ChangeRequest).text;
const json = (text: string) => parseDocument(text).toJSON();
const fails = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as ChangeError;
  }
  throw new Error('it did not fail');
};

describe('Manage › IAM', () => {
  it('gives a role of the application to a new group, keeping the rest of the file', () => {
    const out = run({ service: 'iam', object: 'group', action: 'create', spec: { name: 'vets', role: 'staff' } });
    expect(out).toContain('# Animal shelter');
    expect(json(out).platform.sso.roles[1].groups).toEqual(['helpdesk', 'vets']);
    expect(json(out).platform.sso.roles[0]).toEqual({ name: 'coordinator', description: 'manages everything', users: ['javi'] });
  });

  it('deletes a group of the application as a tombstone in its role', () => {
    const out = run({ service: 'iam', object: 'group', action: 'delete', id: 'helpdesk' });
    expect(json(out).platform.sso.roles[1].groups).toEqual([{ name: 'helpdesk', state: 'absent' }]);
  });

  it('moves a group to another role (the old one by tombstone)', () => {
    const out = run({ service: 'iam', object: 'group', action: 'update', id: 'helpdesk', spec: { role: 'coordinator' } });
    const roles = json(out).platform.sso.roles;
    expect(roles[0].groups).toEqual(['helpdesk']);
    expect(roles[1].groups).toEqual([{ name: 'helpdesk', state: 'absent' }]);
  });

  it('refuses a role the application does not have', () => {
    expect(fails(() => run({ service: 'iam', object: 'group', action: 'create', spec: { name: 'vets', role: 'nobody' } })).status).toBe(422);
  });

  it('adds and retires roles of the application', () => {
    const added = run({ service: 'iam', object: 'role', action: 'create', spec: { name: 'vet', description: 'treatments' } });
    expect(json(added).platform.sso.roles[2]).toEqual({ name: 'vet', description: 'treatments' });
    const gone = run({ service: 'iam', object: 'role', action: 'delete', id: 'staff' });
    expect(json(gone).platform.sso.roles[1]).toEqual({ name: 'staff', state: 'absent' });
  });

  it('changes the settings of the client of the application, never adds a second one', () => {
    const out = run({ service: 'iam', object: 'client', action: 'update', id: 'animalshelter', spec: { testUsers: true, extraRedirectUris: ['http://localhost:4200/*', 'http://localhost:8080/*'] } });
    expect(json(out).platform.sso.testUsers).toBe(true);
    expect(json(out).platform.sso.extraRedirectUris).toEqual(['http://localhost:4200/*', 'http://localhost:8080/*']);
    expect(fails(() => run({ service: 'iam', object: 'client', action: 'create', spec: { name: 'animalshelter' } })).status).toBe(409);
  });

  it('keeps groups and clients of the platform in manage: of a new platform file', () => {
    const g = run({ service: 'iam', object: 'group', action: 'create', owner: platform, spec: { name: 'soc-analysts', description: 'SOC', kind: 'team' } }, '');
    expect(json(g).manage.groups).toEqual([{ name: 'soc-analysts', description: 'SOC', kind: 'team' }]);
    const c = run({ service: 'iam', object: 'client', action: 'create', owner: platform, spec: { name: 'reports-batch', type: 'service-account', secretName: 'reports-batch-client' } }, g);
    expect(json(c).manage.clients).toEqual([{ name: 'reports-batch', type: 'service-account', secretName: 'reports-batch-client' }]);
    const d = run({ service: 'iam', object: 'client', action: 'delete', owner: platform, id: 'reports-batch' }, c);
    expect(json(d).manage.clients).toEqual([{ name: 'reports-batch', state: 'absent' }]);
  });

  it('refuses a public client with a secret and a bad redirect', () => {
    const e = fails(() => run({ service: 'iam', object: 'client', action: 'create', owner: platform, spec: { name: 'web', type: 'public', secretName: 'x-secret', redirectUris: ['ftp://x'] } }, ''));
    expect(e.status).toBe(422);
    expect(e.errors.join(' ')).toMatch(/public client has no secret/);
    expect(e.errors.join(' ')).toMatch(/not an http/);
  });

  it('says what git declares', () => {
    const h = handlerFor('iam', 'group');
    expect(h.declared!(parseDocument(APP), app)).toEqual([{ id: 'helpdesk', spec: { name: 'helpdesk', role: 'staff' }, gone: false }]);
  });
});

describe('Manage › API management', () => {
  it('sets the team of the API of an application in place', () => {
    const out = run({ service: 'gravitee', object: 'api', action: 'update', id: 'animalshelter', spec: { team: 'gravitee-team-beta' } });
    expect(out).toContain('team: gravitee-team-beta');
    expect(out.split('\n').length).toBe(APP.split('\n').length);
  });

  it('retires the API of an application with the block tombstone, and revives it', () => {
    const gone = run({ service: 'gravitee', object: 'api', action: 'delete', id: 'animalshelter' });
    expect(json(gone).platform.gateway).toEqual({ enabled: true, team: 'gravitee-team-alpha', state: 'absent' });
    const back = run({ service: 'gravitee', object: 'api', action: 'create', id: 'animalshelter', spec: { name: 'animalshelter' } }, gone);
    expect(json(back).platform.gateway.state).toBeUndefined();
  });

  it('adds an API of the platform under /gateway/', () => {
    const out = run({ service: 'gravitee', object: 'api', action: 'create', owner: platform, spec: { name: 'Weather', path: '/gateway/weather', target: 'http://weather.example:8080', plan: 'keyless' } }, '');
    expect(json(out).manage.apis).toEqual([{ name: 'Weather', path: '/gateway/weather/', target: 'http://weather.example:8080', plan: 'keyless' }]);
    expect(fails(() => run({ service: 'gravitee', object: 'api', action: 'create', owner: platform, spec: { name: 'X', path: '/other/x', target: 'http://x' } }, '')).status).toBe(422);
  });
});

describe('Manage › Data management', () => {
  it('changes the data product of an application in place', () => {
    const out = run({ service: 'datahub', object: 'dataProduct', action: 'update', id: 'animalshelter', spec: { classification: 'RESTRICTED', retentionDays: 365, ownerGroups: ['animalsheltercoordinators'] } });
    const b = json(out).platform.datahub;
    expect(b).toMatchObject({ description: 'Animals and adoptions', classification: 'RESTRICTED', retentionDays: 365, owners: { users: [], groups: ['animalsheltercoordinators'] } });
  });

  it('keeps domains of the platform only', () => {
    const out = run({ service: 'datahub', object: 'domain', action: 'create', owner: platform, spec: { name: 'logistics', title: 'Logistics' } }, '');
    expect(json(out).manage.domains).toEqual([{ name: 'logistics', title: 'Logistics' }]);
    expect(fails(() => run({ service: 'datahub', object: 'domain', action: 'create', spec: { name: 'x1', title: 'X' } })).status).toBe(422);
  });
});

describe('Manage › Business intelligence', () => {
  it('adds a connection of the platform with a store reference, never a password', () => {
    const out = run({ service: 'superset', object: 'connection', action: 'create', owner: platform, spec: { name: 'Reference data', backend: 'postgresql', host: 'refdata.example', database: 'refdata', passwordFrom: 'superset-connections.REFDATA_PASSWORD' } }, '');
    expect(json(out).manage.connections[0].passwordFrom).toEqual({ storeKey: 'superset-connections', property: 'REFDATA_PASSWORD' });
    expect(fails(() => run({ service: 'superset', object: 'connection', action: 'create', owner: platform, spec: { name: 'W', backend: 'postgresql', host: 'h', database: 'd', allowDml: true } }, '')).status).toBe(422);
  });

  it('turns the dashboards of an application on and off', () => {
    const on = run({ service: 'superset', object: 'dashboards', action: 'create', id: 'animalshelter', spec: { name: 'animalshelter' } });
    expect(json(on).platform.dashboards).toEqual({ enabled: true });
    const off = run({ service: 'superset', object: 'dashboards', action: 'delete', id: 'animalshelter' }, on);
    expect(json(off).platform.dashboards).toEqual({ enabled: true, state: 'absent' });
  });
});

describe('Manage › Business process (Operaton)', () => {
  it('turns the processes of an application on with its groups', () => {
    const out = run({ service: 'processes', object: 'processes', action: 'create', spec: { name: 'animalshelter', groups: ['animalsheltercoordinators'] } });
    expect(json(out).platform.processes).toEqual({ enabled: true, groups: ['animalsheltercoordinators'] });
  });

  it('keeps a tombstone for a group taken out, and retires the block', () => {
    const on = run({ service: 'processes', object: 'processes', action: 'create', spec: { name: 'animalshelter', groups: ['a-team', 'b-team'] } });
    const less = run({ service: 'processes', object: 'processes', action: 'update', id: 'animalshelter', spec: { groups: ['a-team'] } }, on);
    expect(json(less).platform.processes.groups).toEqual(['a-team', { name: 'b-team', state: 'absent' }]);
    const off = run({ service: 'processes', object: 'processes', action: 'delete', id: 'animalshelter' }, less);
    expect(json(off).platform.processes.state).toBe('absent');
    expect(fails(() => run({ service: 'processes', object: 'processes', action: 'update', id: 'animalshelter', spec: {} }, on)).status).toBe(422);
  });

  it('revives a group given back', () => {
    expect(groupsWithTombstones(['a', { name: 'b', state: 'absent' }], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('Manage › Monitoring', () => {
  const dash = handlerFor('monitoring', 'dashboard').files!;
  const change = (r: Partial<ChangeRequest> & { action: ChangeRequest['action']; id: string }, current?: string) =>
    dash.change({ service: 'monitoring', object: 'dashboard', owner: app, ...r } as ChangeRequest & { id: string }, current);

  it('turns monitoring of an application on, and refuses to turn it off', () => {
    const on = run({ service: 'monitoring', object: 'monitoring', action: 'create', spec: { name: 'animalshelter' } });
    expect(json(on).platform.monitoring).toEqual({ enabled: true });
    expect(on).toContain('# Animal shelter');
    expect(fails(() => run({ service: 'monitoring', object: 'monitoring', action: 'create', spec: { name: 'animalshelter' } }, on)).status).toBe(409);
    expect(fails(() => run({ service: 'monitoring', object: 'monitoring', action: 'delete', id: 'animalshelter' }, on)).status).toBe(422);
  });

  it('adds a dashboard from a template as platform/monitoring/<name>.json of the repository', () => {
    expect(handlerFor('monitoring', 'dashboard').target(app)).toEqual({ repo: 'app', path: 'platform/monitoring' });
    expect(dash.path('database')).toBe('platform/monitoring/database.json');
    const { text, summary } = change({ action: 'create', id: 'database', spec: { name: 'database', template: 'database' } });
    const d = JSON.parse(text!);
    expect(summary).toBe('Add dashboard database of animalshelter');
    expect(d.title).toBe('Database');
    expect(d.tags).toEqual(['template:database']);
    expect(d.uid).toBeUndefined();
    expect(d.templating.list.map((v: { name: string }) => v.name)).toEqual(['prometheus', 'namespace']);
    expect(JSON.stringify(d.panels)).toContain('namespace=\\"$namespace\\"');
    expect(dash.declared('database.json', text!)).toEqual({ id: 'database', spec: { name: 'database', title: 'Database', source: 'template', template: 'database', replacesStandard: false }, gone: false });
    expect(fails(() => change({ action: 'create', id: 'database', spec: { name: 'database', template: 'database' } }, text!)).status).toBe(409);
  });

  it('every template is a dashboard with panels', () => {
    for (const template of ['database', 'jobs', 'platform', 'business']) {
      const d = JSON.parse(change({ action: 'create', id: template, spec: { name: template, template } }).text!);
      expect(d.panels.length).toBeGreaterThan(1);
    }
  });

  it('imports a Grafana export: unwraps it, drops what Grafana keeps per instance and maps its datasources', () => {
    const exported = JSON.stringify({
      __inputs: [{ name: 'DS_PROM', pluginId: 'prometheus' }],
      id: 12,
      uid: 'abc',
      version: 7,
      title: 'Pets',
      panels: [{ type: 'timeseries', datasource: { uid: '${DS_PROM}' } }],
    });
    const { text } = change({ action: 'create', id: 'pets', spec: { name: 'pets', source: 'import', json: exported } });
    const d = JSON.parse(text!);
    expect(d.id).toBeUndefined();
    expect(d.uid).toBeUndefined();
    expect(d.__inputs).toBeUndefined();
    expect(d.panels[0].datasource.uid).toBe('${prometheus}');
    expect(d.templating.list[0]).toMatchObject({ name: 'prometheus', type: 'datasource' });
    expect(dash.declared('pets.json', text!)!.spec.source).toBe('import');
    expect(dash.declared('logs.json', text!)!.spec.replacesStandard).toBe(true);
    expect(fails(() => change({ action: 'create', id: 'bad', spec: { name: 'bad', source: 'import', json: '{"title":"x"}' } })).errors[0]).toContain('no panels');
  });

  it('changes and removes a dashboard of the repository', () => {
    const { text } = change({ action: 'create', id: 'jobs', spec: { name: 'jobs', template: 'jobs' } });
    expect(change({ action: 'update', id: 'jobs', spec: { template: 'platform' } }, text!).summary).toBe('Change dashboard jobs of animalshelter');
    expect(change({ action: 'delete', id: 'jobs' }, text!)).toEqual({ text: null, summary: 'Remove dashboard jobs of animalshelter' });
    expect(fails(() => change({ action: 'delete', id: 'jobs' })).status).toBe(404);
    expect(fails(() => change({ action: 'create', id: 'x', spec: { name: 'x', template: 'nope' } })).status).toBe(422);
  });
});
