import { blockingMessage, cardsOf, issueText, type Preview, previewKey, previewRequest, shownChanges, valueOf } from './businessModelPreviewModel';

// made-up form values: no customer data
const FORM = { source: 'template', file: 'data:text/csv;name=m.csv;base64,SUQsVGl0bGUK', namespace: 'example-customer', sheet: '', owner: '', mapping: { id: 'A' } };
const PREVIEW: Preview = {
  counts: { domains: 1, subdomains: 2, new: 3, changed: 1, gone: 1, unchanged: 7 },
  errors: [{ row: 4, message: 'X: its parent Q is not in the file.' }],
  warnings: [{ message: 'The current files could not be read.' }],
  changes: [
    { kind: 'new', id: 'D1', title: 'One', what: 'new domain one' },
    { kind: 'review', id: 'D9', title: 'Gone', what: 'not in the file any more' },
    { kind: 'changed', id: 'D2', title: 'Two', what: 'criticality important → critical' },
  ],
};

describe('previewRequest', () => {
  it('sends what the action reads, without empty values or the mapping of another source', () => {
    expect(previewRequest(FORM)).toEqual({ body: { source: 'template', file: FORM.file, namespace: 'example-customer' } });
    const own = previewRequest({ ...FORM, source: 'own', sheet: 2, keepFrom: 'referencemodel:default/apqc', valueMapping: { criticality: { Alta: 'critical' } } });
    expect(own.body?.mapping).toEqual({ id: 'A' });
    expect(own.body?.sheet).toBe(2);
    expect(own.body?.keepFrom).toBe('referencemodel:default/apqc');
    expect(own.body?.valueMapping).toEqual({ criticality: { Alta: 'critical' } });
  });

  it('says what is missing', () => {
    expect(previewRequest({ source: 'apqc' })).toEqual({ missing: 'file, namespace' });
    expect(previewRequest(undefined).missing).toBe('source, file, namespace');
  });
});

describe('previewKey', () => {
  it('changes with the file and the options, not with the order of the keys', () => {
    const a = previewRequest(FORM).body!;
    expect(previewKey(a)).toBe(previewKey({ namespace: a.namespace, file: a.file, source: a.source }));
    expect(previewKey(a)).not.toBe(previewKey({ ...a, file: `${a.file}QQ` }));
    expect(previewKey(a)).not.toBe(previewKey({ ...a, namespace: 'other' }));
  });
});

describe('blockingMessage', () => {
  const key = previewKey(previewRequest(FORM).body!);

  it('blocks while the preview is missing, running, of other values or failed', () => {
    expect(blockingMessage(undefined, FORM)).toMatch(/not ready/);
    expect(blockingMessage({ state: 'loading', key }, FORM)).toMatch(/not ready/);
    expect(blockingMessage({ state: 'done', key: 'old', errors: 0 }, FORM)).toMatch(/not ready/);
    expect(blockingMessage(valueOf(key, { error: 'GitHub answered 502' }), FORM)).toMatch(/failed \(GitHub answered 502\)/);
    expect(blockingMessage(undefined, { source: 'own' })).toMatch(/needs file, namespace/);
  });

  it('blocks on errors unless they are skipped', () => {
    const v = valueOf(key, { preview: PREVIEW });
    expect(v).toEqual({ state: 'done', key, errors: 1, warnings: 1 });
    expect(blockingMessage(v, FORM)).toMatch(/1 error: fix it/);
    expect(blockingMessage(v, { ...FORM, skipErrors: true })).toBeUndefined();
    expect(blockingMessage({ ...v, errors: 0 }, FORM)).toBeUndefined();
    expect(blockingMessage({ ...v, errors: 3 }, FORM)).toMatch(/3 errors: fix them/);
  });
});

describe('what the field shows', () => {
  it('has the cards of the mockup', () => {
    expect(cardsOf(PREVIEW.counts).map(c => `${c.value} ${c.label}`)).toEqual([
      '1 domain · 2 subdomains',
      '+ 3 new',
      '~ 1 changed',
      '− 1 no longer in the file: marked for review',
      '7 unchanged',
    ]);
    expect(cardsOf({ ...PREVIEW.counts, new: 0 })[1].tone).toBe('neutral');
  });

  it('lists reviews and changes before the new ones, at most n', () => {
    expect(shownChanges(PREVIEW.changes).rows.map(c => c.kind)).toEqual(['review', 'changed', 'new']);
    expect(shownChanges(PREVIEW.changes, 2)).toEqual({ rows: [PREVIEW.changes[1], PREVIEW.changes[2]], total: 3 });
  });

  it('writes an issue with its row', () => {
    expect(issueText(PREVIEW.errors[0])).toBe('Row 4: X: its parent Q is not in the file.');
    expect(issueText(PREVIEW.warnings[0])).toBe('The current files could not be read.');
  });
});
