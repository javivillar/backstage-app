import { type ApplicationOwnership, applicationsOfTeam, countsOf, hasGap, modelOf, type Organisation, ownerState, ownershipCounts, peopleOf, sameProcessName, teamNames, teamOfLane } from './organisation';

const org: Organisation = {
  side: 'customer', name: 'aerospace-iberia', title: 'Aerospace Iberia', path: 'catalog/organisations/customer/aerospace-iberia.yaml',
  head: { name: 'Elena Ruiz', user: 'eruiz', inKeycloak: true },
  units: [
    { name: 'Maintenance', head: { name: 'Raúl Méndez', user: 'rmendez', inKeycloak: true }, teams: [{ name: 'Line Maintenance', people: [{ name: 'Diego Navarro', user: 'dnavarro', inKeycloak: true }, { name: 'Alba Serrano', user: 'aserrano', inKeycloak: false }] }] },
    { name: 'Logistics', teams: [{ name: 'Stores and Distribution', people: [{ name: 'Víctor Reyes', user: 'vreyes' }] }] },
  ],
  productOwners: [{ application: 'aib-etechlog', user: 'dnavarro' }],
};
const app = (name: string, over: Partial<ApplicationOwnership> = {}): ApplicationOwnership => ({ name, title: name, ref: `component:default/${name}`, processes: 1, ...over });
const apps = [
  app('aib-etechlog', { customer: { user: 'dnavarro', name: 'Diego Navarro', unit: 'Maintenance', team: 'Line Maintenance', inKeycloak: true }, provider: { user: 'tbarrios', name: 'Teresa Barrios', unit: 'Products', team: 'Maintenance products', inKeycloak: true } }),
  app('aib-stores', { customer: { user: 'vreyes', name: 'Víctor Reyes', unit: 'Logistics', team: 'Stores and Distribution' } }),
  app('support', { customer: { user: 'aserrano', name: 'Alba Serrano', unit: 'Maintenance', team: 'Line Maintenance', inKeycloak: false }, provider: { user: 'jsancho', name: 'Julia Sancho', inKeycloak: true } }),
];

describe('an organisation in the console', () => {
  it('lists its people and counts', () => {
    expect(peopleOf(org).map(p => `${p.user}:${p.position}`)).toEqual(['eruiz:head', 'rmendez:unit head', 'dnavarro:member', 'aserrano:member', 'vreyes:member']);
    expect(countsOf(org)).toEqual({ units: 2, teams: 2, people: 5, notInKeycloak: 1, productOwners: 1 });
    expect(teamNames(org)).toEqual(['Line Maintenance', 'Stores and Distribution']);
    expect(teamNames(undefined)).toEqual([]);
  });

  it('gives the applications a team answers for, by side', () => {
    expect(applicationsOfTeam(apps, 'customer', 'Maintenance', 'Line Maintenance').map(a => a.name)).toEqual(['aib-etechlog', 'support']);
    expect(applicationsOfTeam(apps, 'provider', 'Products', 'Maintenance products').map(a => a.name)).toEqual(['aib-etechlog']);
    expect(applicationsOfTeam(apps, 'customer', 'Logistics', 'Line Maintenance')).toEqual([]);
  });

  it('finds the gaps of the ownership', () => {
    expect(apps.map(a => [ownerState(a.customer), ownerState(a.provider)])).toEqual([['ok', 'ok'], ['ok', 'none'], ['no-user', 'ok']]);
    expect(apps.map(hasGap)).toEqual([false, true, true]);
    expect(ownershipCounts(apps)).toEqual({ applications: 3, complete: 1, noCustomer: 0, noProvider: 1, noUser: 1 });
  });
});

describe('the model of a process', () => {
  it('matches a lane with a team by name', () => {
    const teams = ['Stores and Distribution', 'Line Maintenance'];
    expect(teamOfLane('line maintenance', teams)).toBe('Line Maintenance');
    expect(teamOfLane('Stores and Distribution · AOG desk', teams)).toBe('Stores and Distribution');
    expect(teamOfLane('Stores', teams)).toBeUndefined();
    expect(teamOfLane('Procurement', teams)).toBeUndefined();
  });

  it('compares the name in the file with the process', () => {
    expect(sameProcessName('Handle AOG requests', 'Handle AOG Requests.')).toBe(true);
    expect(sameProcessName(undefined, 'Handle AOG requests')).toBe(true);
    expect(sameProcessName('Receive and inspect parts', 'Perform line checks')).toBe(false);
  });

  it('reads the steps of a file in reading order, with their lanes', () => {
    const m = modelOf(
      [
        { id: 'lane1', type: 'bpmn:Lane', businessObject: { name: 'Stores', flowNodeRef: [{ id: 'b' }, { id: 'gw' }] } },
        { id: 'lane2', type: 'bpmn:Lane', businessObject: { name: 'Line', flowNodeRef: [{ id: 'a' }] } },
        { id: 'b', type: 'bpmn:ServiceTask', x: 300, y: 10, businessObject: { name: 'Check stock' } },
        { id: 'a', type: 'bpmn:UserTask', x: 100, y: 200, businessObject: { name: 'Register' } },
        { id: 'c', type: 'bpmn:CallActivity', x: 500, y: 10, businessObject: {} },
        { id: 'gw', type: 'bpmn:ExclusiveGateway', x: 400 },
        { id: 's', type: 'bpmn:StartEvent' },
        { id: 'e', type: 'bpmn:EndEvent' },
        { id: 'b_label', type: 'label' },
      ],
      'Handle AOG requests',
      0,
    );
    expect(m.steps).toEqual([
      { id: 'a', name: 'Register', kind: 'person', lane: 'Line' },
      { id: 'b', name: 'Check stock', kind: 'automatic', lane: 'Stores' },
      { id: 'c', name: 'c', kind: 'process', lane: undefined },
    ]);
    expect(m).toMatchObject({ lanes: ['Stores', 'Line'], gateways: 1, events: 2, name: 'Handle AOG requests' });
  });
});
