import { fieldErrors, initialValues, specFrom, splitList, type Field } from './manageFormModel';

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
});
