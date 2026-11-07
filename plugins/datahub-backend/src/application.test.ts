import {
  contractAssertions,
  declarationStats,
  declaredVsFound,
  parseDeclarations,
  parseDeploymentBlock,
  parseGovernance,
  parseProfile,
  personalData,
  platformLabel,
} from './application';

// A cut of platform/datahub.yaml of personnelsecurity (2026-11-07).
const DECLARATIONS = `
tables:
  audit_entry:
    terms: [Security.AuditTrail]
    columns:
      actor: { terms: [PersonalData.Identifier], classification: CONFIDENTIAL }
      action: { classification: CONFIDENTIAL }
  person:
    terms: [Business.Person]
    columns:
      subject: { terms: [PersonalData.Identifier] }
      name: { terms: [PersonalData.Name] }
      email: { terms: [PersonalData.Email] }
  holiday:
    terms: [Business.Calendar]
sites:
  - { name: documents }
processes: [request-review]
contracts:
  audit_entry: { rows: { min: 1 } }
  person: { fresh: { hours: 24 } }
`;

describe('application data view', () => {
  it('reads the daily governance check', () => {
    const g = parseGovernance('{"aboveCeiling": 0, "assets": 23, "contractChecks": 10, "contractsFailing": 0, "ok": true, "checkedAt": "2026-11-05T05:43:56+00:00"}');
    expect(g).toMatchObject({ assets: 23, contractChecks: 10, contractsFailing: 0, ok: true, aboveCeiling: 0 });
    expect(parseGovernance('not json')).toBeUndefined();
    expect(parseGovernance(undefined)).toBeUndefined();
  });

  it('keeps only the assertion urns of the contracts', () => {
    expect(contractAssertions('{"contracts": ["urn:li:assertion:a", "urn:li:dataContract:b", 3]}')).toEqual(['urn:li:assertion:a']);
    expect(contractAssertions(undefined)).toEqual([]);
  });

  it('reads the profile of a table', () => {
    const p = parseProfile('{"columns": {"id": {"distinct": 6, "nulls": 0}}, "measuredAt": "2026-11-07T09:02:55+00:00", "rows": 6}');
    expect(p).toEqual({ rows: 6, measuredAt: '2026-11-07T09:02:55+00:00', columns: { id: { distinct: 6, nulls: 0 } } });
  });

  it('turns the declarations into the figures of the tab', () => {
    const d = parseDeclarations(DECLARATIONS)!;
    expect(d.tables.map(t => t.name)).toEqual(['audit_entry', 'person', 'holiday']);
    expect(d.sites).toEqual(['documents']);
    expect(d.processes).toEqual(['request-review']);
    expect(d.tables.find(t => t.name === 'person')!.contract).toBe(true);
    const s = declarationStats(d);
    expect(s).toMatchObject({ tables: 3, columns: 5, confidentialColumns: 2, personalColumns: 4, contractTables: ['audit_entry', 'person'] });
    expect(s.personal[0]).toEqual({ kind: 'PersonalData.Identifier', count: 2, examples: ['audit_entry.actor', 'person.subject'] });
    expect(s.terms).toContain('Security.AuditTrail');
    expect(parseDeclarations('tables: [unclosed')).toBeUndefined();
  });

  it('groups personal data by kind', () => {
    expect(personalData([{ table: 't', column: 'c', terms: ['Business.X'] }])).toEqual([]);
  });

  it('reads the block datahub of a deployment file', () => {
    const b = parseDeploymentBlock(`
name: personnelsecurity
platform:
  datahub:
    enabled: true
    description: "Personnel security"
    owners: { users: [], groups: ["personnelsecuritygovernance"] }
    classification: "CONFIDENTIAL"
    retentionDays: 3650
`);
    expect(b).toEqual({ description: 'Personnel security', classification: 'CONFIDENTIAL', retentionDays: 3650, owners: { users: [], groups: ['personnelsecuritygovernance'] } });
    expect(parseDeploymentBlock('name: x')).toBeUndefined();
  });

  it('compares what is declared with what was found', () => {
    const d = parseDeclarations(DECLARATIONS)!;
    const r = declaredVsFound(d, [
      { table: 'audit_entry', columns: ['actor', 'action'] },
      { table: 'person', columns: ['subject', 'name'] },
      { table: 'flow_run', columns: ['id'] },
    ]);
    expect(r).toEqual({ undeclaredTables: ['flow_run'], missingTables: ['holiday'], missingColumns: ['person.email'] });
    expect(declaredVsFound(undefined, [{ table: 'pet', columns: [] }]).undeclaredTables).toEqual(['pet']);
  });

  it('names the platforms', () => {
    expect(platformLabel('postgres')).toBe('PostgreSQL');
    expect(platformLabel('other')).toBe('other');
  });
});
