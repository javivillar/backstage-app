import { declarationOf, fieldErrors, fieldsFor, initialValues, productNames, specFrom, splitList, type Field } from './manageFormModel';

const FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', required: true, createOnly: true, pattern: { re: /^[a-z0-9-]+$/, message: 'lowercase' } },
  { key: 'users', label: 'Users', kind: 'list' },
  { key: 'public', label: 'Public', kind: 'boolean' },
  { key: 'tier', label: 'Tier', kind: 'select', options: [{ value: 'gold', label: 'Gold' }] },
];

describe('the fields of a Manage form', () => {
  it('reads lists typed with commas or lines', () => {
    expect(splitList(' ana, javi\nluis ,, ')).toEqual(['ana', 'javi', 'luis']);
  });

  it('starts empty or from the object', () => {
    expect(initialValues(FIELDS)).toEqual({ name: '', users: '', public: false, tier: '' });
    expect(initialValues(FIELDS, { name: 'docs', users: ['ana', 'javi'], public: true })).toEqual({ name: 'docs', users: 'ana, javi', public: true, tier: '' });
  });

  it('checks required, patterns and options; the name only when creating', () => {
    expect(fieldErrors(FIELDS, { name: '', users: '', public: false, tier: '' }, true)).toEqual({ name: 'required' });
    expect(fieldErrors(FIELDS, { name: 'Docs', users: '', public: false, tier: 'silver' }, true)).toEqual({ name: 'lowercase', tier: 'not one of the options' });
    expect(fieldErrors(FIELDS, { name: '', users: '', public: false, tier: '' }, false)).toEqual({});
  });

  it('makes the spec: everything when creating, only what changed when changing', () => {
    expect(specFrom(FIELDS, { name: 'docs', users: 'ana', public: false, tier: '' }, true)).toEqual({ name: 'docs', users: ['ana'], public: false });
    const current = { name: 'docs', users: ['ana'], public: false };
    expect(specFrom(FIELDS, { name: 'docs', users: 'ana, javi', public: false, tier: '' }, false, current)).toEqual({ users: ['ana', 'javi'] });
  });

  it('keeps the fields of the owner', () => {
    const f: Field[] = [{ key: 'name', label: 'Name', kind: 'text' }, { key: 'writeGroup', label: 'Writers', kind: 'text', only: 'platform' }];
    expect(fieldsFor(f, { kind: 'application' }).map(x => x.key)).toEqual(['name']);
    expect(fieldsFor(f, { kind: 'platform' }).map(x => x.key)).toEqual(['name', 'writeGroup']);
    expect(fieldsFor(f).length).toBe(2);
  });

  it('finds the declaration of an object of the product by its name in every stage', () => {
    const app = { owner: { kind: 'application' as const, name: 'petstore' }, id: 'files', spec: { name: 'files' }, gone: false };
    const plat = { owner: { kind: 'platform' as const }, id: 'shared', spec: { name: 'shared' }, gone: false };
    expect(productNames(app)).toEqual(['petstore-files', 'petstore-dev-files', 'petstore-pre-files']);
    expect(declarationOf([app, plat], 'petstore-dev-files')).toBe(app);
    expect(declarationOf([app, plat], 'shared')).toBe(plat);
    expect(declarationOf([app, plat], 'manual-bucket')).toBeUndefined();
  });

  it('checks and sends only the fields shown for the values (when)', () => {
    const f: Field[] = [
      { key: 'source', label: 'Source', kind: 'select', required: true, options: [{ value: 'template', label: 'T' }, { value: 'import', label: 'I' }] },
      { key: 'template', label: 'Template', kind: 'select', required: true, options: [{ value: 'database', label: 'D' }], when: v => v.source !== 'import' },
      { key: 'json', label: 'JSON', kind: 'textarea', required: true, when: v => v.source === 'import' },
    ];
    expect(fieldErrors(f, { source: 'import', template: '', json: '' }, true)).toEqual({ json: 'required' });
    expect(specFrom(f, { source: 'import', template: 'database', json: ' {"panels":[]} ' }, true)).toEqual({ source: 'import', json: '{"panels":[]}' });
    expect(specFrom(f, { source: 'template', template: 'database', json: 'x' }, true)).toEqual({ source: 'template', template: 'database' });
  });
});
