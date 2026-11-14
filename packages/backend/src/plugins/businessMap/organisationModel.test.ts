import { bpmnPath, bpmnPull, readBpmn, readTarget } from './bpmnModel';
import { countsOf, organisationFromRows, organisationPath, organisationView, organisationYaml, ownershipOf, parseOrganisation, peopleOf, readOrganisation, TEMPLATE_HEAD, templateSheets, withOwner } from './organisationModel';

const ORG = {
  side: 'customer',
  name: 'aerospace-iberia',
  title: 'Aerospace Iberia',
  head: { name: 'Elena Ruiz', user: 'eruiz', role: 'Services Director' },
  units: [
    { name: 'Maintenance', head: { name: 'Raúl Méndez', user: 'rmendez' }, teams: [{ name: 'Line Maintenance', people: [{ name: 'Diego Navarro', user: 'DNavarro', role: 'Station manager' }, { name: 'Alba Serrano', user: 'aserrano' }] }] },
    { name: 'Logistics', teams: [{ name: 'Stores', people: [{ name: 'Víctor Reyes', user: 'vreyes' }] }] },
  ],
  productOwners: [{ application: 'aib-etechlog', user: 'dnavarro' }],
};
const rows = (...lines: string[][]) => [TEMPLATE_HEAD, ...lines].map((cells, i) => ({ n: i + 1, cells }));

describe('an organisation', () => {
  it('is read, with user names in lower case, and written as YAML that reads the same', () => {
    const org = readOrganisation(ORG);
    expect(peopleOf(org).map(p => [p.user, p.position, p.team])).toEqual([
      ['eruiz', 'head', undefined], ['rmendez', 'unit head', undefined], ['dnavarro', 'member', 'Line Maintenance'], ['aserrano', 'member', 'Line Maintenance'], ['vreyes', 'member', 'Stores'],
    ]);
    expect(parseOrganisation(organisationYaml(org), { side: 'customer', name: 'aerospace-iberia' })).toEqual(org);
    expect(organisationPath('customer', 'aerospace-iberia')).toBe('catalog/organisations/customer/aerospace-iberia.yaml');
    expect(organisationPath('provider', 'aerospace-iberia')).toBe('catalog/organisations/provider.yaml');
  });

  it('refuses what cannot be', () => {
    const bad = (change: (o: any) => void) => () => {
      const o = JSON.parse(JSON.stringify(ORG));
      change(o);
      readOrganisation(o);
    };
    expect(bad(o => { o.name = 'Bad Name'; })).toThrow(/not a name/);
    expect(bad(o => { o.units[1].teams[0].people.push({ name: 'Again', user: 'aserrano' }); })).toThrow(/twice in the organisation/);
    expect(bad(o => { o.units.push({ name: 'maintenance', teams: [] }); })).toThrow(/unit "maintenance" is twice/);
    expect(bad(o => { o.productOwners.push({ application: 'aib-stores', user: 'nobody' }); })).toThrow(/not a person of the organisation/);
    expect(bad(o => { o.productOwners.push({ application: 'aib-etechlog', user: 'vreyes' }); })).toThrow(/two product owners/);
    expect(bad(o => { o.units[0].teams[0].people[0].user = 'bad user'; })).toThrow(/not a user name/);
    expect(() => parseOrganisation('kind: Domain\nmetadata: {name: x}')).toThrow(/not an Organisation/);
    expect(() => parseOrganisation(organisationYaml(readOrganisation(ORG)), { side: 'provider', name: 'provider' })).toThrow(/not provider\/provider/);
  });

  it('names and removes a product owner', () => {
    const org = readOrganisation(ORG);
    expect(withOwner(org, 'aib-stores', 'VReyes').productOwners).toEqual([{ application: 'aib-etechlog', user: 'dnavarro' }, { application: 'aib-stores', user: 'vreyes' }]);
    expect(withOwner(org, 'aib-etechlog', 'aserrano').productOwners).toEqual([{ application: 'aib-etechlog', user: 'aserrano' }]);
    expect(withOwner(org, 'aib-etechlog', undefined).productOwners).toEqual([]);
    expect(() => withOwner(org, 'aib-stores', 'nobody')).toThrow(/not a person/);
  });

  it('says who has a Keycloak user and counts', () => {
    const org = readOrganisation(ORG);
    const users = new Set(['eruiz', 'dnavarro', 'vreyes', 'rmendez']);
    const view = organisationView(org, users, 'aerospace-iberia');
    expect(view.units[0].teams[0].people.map(p => p.inKeycloak)).toEqual([true, false]);
    expect(view.path).toBe('catalog/organisations/customer/aerospace-iberia.yaml');
    expect(organisationView(org, undefined, 'aerospace-iberia').head?.inKeycloak).toBeUndefined();
    expect(countsOf(org, users)).toEqual({ units: 2, teams: 2, people: 5, notInKeycloak: 1, productOwners: 1 });
  });

  it('gives the product owners of each application on both sides', () => {
    const customer = readOrganisation(ORG);
    const provider = readOrganisation({ side: 'provider', name: 'provider', units: [{ name: 'Products', teams: [{ name: 'Maintenance products', people: [{ name: 'Teresa Barrios', user: 'tbarrios' }] }] }], productOwners: [{ application: 'aib-stores', user: 'tbarrios' }] });
    const apps = [{ name: 'aib-etechlog', title: 'Electronic Tech Log', ref: 'component:default/aib-etechlog', criticality: 'critical', processes: 6 }, { name: 'aib-stores', title: 'Stores', ref: 'component:default/aib-stores', processes: 8 }];
    const out = ownershipOf(apps, customer, provider, new Set(['tbarrios']));
    expect(out[0].customer).toMatchObject({ user: 'dnavarro', team: 'Line Maintenance', unit: 'Maintenance', inKeycloak: false });
    expect(out[0].provider).toBeUndefined();
    expect(out[1].customer).toBeUndefined();
    expect(out[1].provider).toMatchObject({ user: 'tbarrios', inKeycloak: true });
    expect(ownershipOf(apps, undefined, undefined, undefined).every(a => !a.customer && !a.provider)).toBe(true);
  });
});

describe('the template of an organisation', () => {
  it('comes back as the same organisation', () => {
    const org = readOrganisation(ORG);
    const sheet = templateSheets(org)[0];
    const back = organisationFromRows(sheet.rows.map((cells, i) => ({ n: i + 1, cells })), { side: 'customer', name: 'aerospace-iberia', title: 'Aerospace Iberia' });
    expect(back.errors).toEqual([]);
    expect(back.organisation).toEqual(org);
    expect(templateSheets()[0].rows.length).toBeGreaterThan(2);
  });

  it('leaves out the rows that are wrong and says which', () => {
    const { organisation, errors } = organisationFromRows(
      rows(
        ['', '', 'Elena Ruiz', 'eruiz', 'Director', 'head', ''],
        ['Maintenance', 'Line', 'Diego Navarro', 'dnavarro', '', '', 'aib-etechlog, Bad App'],
        ['Maintenance', 'Line', 'Diego Again', 'dnavarro', '', '', ''],
        ['Maintenance', '', 'No Team', 'noteam', '', '', ''],
        ['', '', 'Second Head', 'head2', '', 'head', ''],
        ['Maintenance', 'Line', '', 'noname', '', '', ''],
        ['Maintenance', 'Line', 'Bad Position', 'badpos', '', 'boss', ''],
        ['', '', '', '', '', '', ''],
      ),
      { side: 'customer', name: 'aerospace-iberia' },
    );
    expect(peopleOf(organisation).map(p => p.user)).toEqual(['eruiz', 'dnavarro']);
    expect(organisation.productOwners).toEqual([{ application: 'aib-etechlog', user: 'dnavarro' }]);
    expect(errors.map(e => e.row)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(errors[0].message).toMatch(/not the name of an application/);
    expect(errors[1].message).toMatch(/already in row 3/);
  });

  it('needs the columns of the template', () => {
    expect(() => organisationFromRows([{ n: 1, cells: ['Person', 'Login'] }], { side: 'customer', name: 'x' })).toThrow(/no column "Name"/);
  });
});

const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="d">
<bpmn:collaboration id="c"><bpmn:participant id="p" name="Handle AOG &amp; requests" processRef="Process_1"/></bpmn:collaboration>
<bpmn:process id="Process_1" name="inner"><bpmn:laneSet><bpmn:lane id="l1" name="Customer Requests"/><bpmn:lane id="l2" name='Line Maintenance'/></bpmn:laneSet>
<bpmn:userTask id="a" name="Register"/><bpmn:serviceTask id="b"/><bpmn:callActivity id="c2"/></bpmn:process>
<bpmndi:BPMNDiagram id="dg"><bpmndi:BPMNPlane id="pl" bpmnElement="c"/></bpmndi:BPMNDiagram></bpmn:definitions>`;

describe('the BPMN model of a process', () => {
  it('reads what a BPMN 2.0 file says of itself', () => {
    const { summary, xml } = readBpmn(`${String.fromCharCode(0xfeff)}${BPMN}`);
    expect(summary).toEqual({ name: 'Handle AOG & requests', id: 'Process_1', tasks: 3, lanes: ['Customer Requests', 'Line Maintenance'] });
    expect(xml.startsWith('<?xml')).toBe(true);
    // without a prefix, as some tools write it
    expect(readBpmn(BPMN.replace(/bpmn:/g, '').replace('xmlns:bpmn=', 'xmlns=')).summary.tasks).toBe(3);
  });

  it('refuses what is not a model that can be drawn', () => {
    expect(() => readBpmn('')).toThrow(/empty/);
    expect(() => readBpmn('<html>not bpmn</html>')).toThrow(/not BPMN 2.0/);
    expect(() => readBpmn(BPMN.replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, ''))).toThrow(/no diagram/);
    expect(() => readBpmn(BPMN.replace(/<bpmn:process[\s\S]*<\/bpmn:process>/, ''))).toThrow(/no process/);
    expect(() => readBpmn(`<!DOCTYPE x [<!ENTITY e "x">]>${BPMN}`)).toThrow(/DOCTYPE/);
    expect(() => readBpmn(`${BPMN}${' '.repeat(2 * 1024 * 1024)}`)).toThrow(/larger than 2 MB/);
  });

  it('is kept next to its process', () => {
    expect(readTarget('aerospace-iberia', 'handle-aog-requests')).toEqual({ namespace: 'aerospace-iberia', process: 'handle-aog-requests' });
    expect(() => readTarget('aerospace-iberia', '../x')).toThrow(/names/);
    expect(bpmnPath('aerospace-iberia', 'handle-aog-requests')).toBe('catalog/business-map/aerospace-iberia/bpmn/handle-aog-requests.bpmn');
    const pull = bpmnPull({ namespace: 'aerospace-iberia', process: 'handle-aog-requests' }, 'Handle AOG requests', { tasks: 7, lanes: ['Stores'] }, { by: 'user:default/javi', fileName: 'aog.bpmn', replaces: false });
    expect(pull.title).toBe('business map: BPMN model of Handle AOG requests (aerospace-iberia)');
    expect(pull.body).toMatch(/^Adds the BPMN model/);
    expect(pull.body).toContain('catalog/business-map/aerospace-iberia/bpmn/handle-aog-requests.bpmn');
  });
});
