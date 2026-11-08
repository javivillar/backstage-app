import {
  adoptProblems,
  adoptTotals,
  adoptValues,
  cardsOf,
  categoriesOf,
  csvHeaders,
  domainOptions,
  emptyImport,
  emptyProcess,
  firstBadStep,
  importBlocker,
  importProblems,
  importValues,
  inOwnFile,
  type LiteEntity,
  mayChangeMap,
  namespacesOf,
  normRef,
  previewBody,
  previewKey,
  type PreviewState,
  processFormOf,
  processProblems,
  processValues,
  shownChanges,
  slugOf,
  supportIds,
  withFileName,
  withTitle,
} from './businessMapFormsModel';

// made-up data
const FILE = 'data:text/csv;name=model.csv;base64,SUQsVGl0bGUK';
const domain = (ns: string, name: string, extra: Partial<LiteEntity['spec']> = {}, annotations?: Record<string, string>, title?: string): LiteEntity => ({
  kind: 'Domain',
  metadata: { name, namespace: ns, title, annotations },
  spec: { type: 'business-area', ...extra },
});
const bp = (ns: string, name: string, dom: string): LiteEntity => ({ kind: 'BusinessProcess', metadata: { name, namespace: ns }, spec: { domain: dom } });

describe('who may and refs', () => {
  it('lets only business-architect and backstage-admin run the templates', () => {
    expect(mayChangeMap(['user:default/ana', 'group:default/Business-Architect'])).toBe(true);
    expect(mayChangeMap(['group:default/backstage-admin'])).toBe(true);
    expect(mayChangeMap(['group:default/developers'])).toBe(false);
  });
  it('normalises refs', () => {
    expect(normRef('Team', 'group')).toBe('group:default/team');
    expect(normRef('orders', 'domain', 'customer')).toBe('domain:customer/orders');
    expect(normRef('system:default/shop', 'system')).toBe('system:default/shop');
  });
  it('makes the slug of a title', () => {
    expect(slugOf('Gestión de reparación  y mantenimiento!')).toBe('gestion-de-reparacion-y-mantenimiento');
    expect(slugOf('x')).toBe('');
    expect(slugOf('a'.repeat(80)).length).toBe(63);
  });
});

describe('import', () => {
  it('puts the name of the file in the data URL as rjsf does', () => {
    expect(withFileName('data:text/csv;base64,QQ==', 'Mapa de procesos.csv')).toBe('data:text/csv;name=Mapa%20de%20procesos.csv;base64,QQ==');
    expect(withFileName(FILE, 'other.csv')).toBe(FILE);
  });
  it('reads the headers of a CSV', () => {
    expect(csvHeaders('\uFEFF"Código";Proceso;Padre\n1;a;\n')).toEqual(['Código', 'Proceso', 'Padre']);
    expect(csvHeaders('\nID,Title\n')).toEqual(['ID', 'Title']);
  });
  it('asks for the file, the namespace and, for an own layout, the ID and title columns', () => {
    const f = emptyImport();
    expect(Object.keys(importProblems(f, 'source')).sort()).toEqual(['file', 'namespace']);
    const own = { ...emptyImport('occar-a400m'), file: FILE, source: 'own' as const };
    expect(importProblems(own, 'source')).toEqual({});
    expect(Object.keys(importProblems(own, 'mapping')).sort()).toEqual(['mapping.id', 'mapping.title']);
    expect(firstBadStep(own)).toBe('mapping');
    const mapped = { ...own, mapping: { id: 'B', title: 'C' }, criticalityValues: [{ value: 'Alta', means: '' as const }] };
    expect(Object.keys(importProblems(mapped, 'mapping'))).toEqual(['value.0']);
    expect(importProblems({ ...emptyImport('x1'), file: FILE, source: 'apqc', version: 'seven' }, 'source').version?.key).toBe('bmf.err.version');
  });
  it('sends the mapping only for an own layout and industry/version only for APQC', () => {
    const base = { ...emptyImport('occar-a400m'), file: FILE, fileName: 'model.csv', mapping: { id: 'B', title: ' C ', owner: '' } };
    const tpl = previewBody(base);
    expect(tpl).toEqual({ source: 'template', file: FILE, fileName: 'model.csv', namespace: 'occar-a400m' });
    const own = previewBody({ ...base, source: 'own', criticalityValues: [{ value: 'Alta', means: 'critical' }] });
    expect(own?.mapping).toEqual({ id: 'B', title: 'C' });
    expect(own?.valueMapping).toEqual({ criticality: { Alta: 'critical' } });
    expect(previewBody({ ...base, source: 'apqc', industry: 'aerospace-defense' })?.version).toBe('7.4');
    expect(previewBody({ ...base, namespace: 'X' })).toBeUndefined();
  });
  it('blocks the run until the preview of these values is there and has no errors (or they are skipped)', () => {
    const f = { ...emptyImport('occar-a400m'), file: FILE };
    const body = previewBody(f);
    const key = body ? previewKey(body) : '';
    expect(key.length).toBeGreaterThan(0);
    const done = (errors: number): PreviewState => ({
      key,
      state: 'done',
      preview: { counts: { domains: 1, subdomains: 0, new: 1, changed: 0, gone: 0, unchanged: 0 }, errors: Array.from({ length: errors }, (_, i) => ({ row: i + 2, message: 'bad' })), warnings: [], changes: [] },
    });
    expect(importBlocker(emptyImport(), undefined)?.key).toBe('bmf.block.missing');
    expect(importBlocker(f, undefined)?.key).toBe('bmf.block.wait');
    expect(importBlocker(f, { key: 'other', state: 'done' })?.key).toBe('bmf.block.wait');
    expect(importBlocker(f, { key, state: 'failed', error: 'x' })?.key).toBe('bmf.block.failed');
    expect(importBlocker(f, done(2))).toEqual({ key: 'bmf.block.errors', vars: { n: 2 } });
    expect(importBlocker({ ...f, skipErrors: true }, done(2))).toBeUndefined();
    expect(importBlocker(f, done(0))).toBeUndefined();
  });
  it('gives the template business-model-import its parameters', () => {
    const f = { ...emptyImport('occar-a400m'), file: FILE, source: 'own' as const, owner: 'group:default/a400m', mapping: { id: 'B', title: 'C' }, skipErrors: true };
    const preview: PreviewState = { key: 'k', state: 'done', preview: { counts: { domains: 0, subdomains: 0, new: 0, changed: 0, gone: 0, unchanged: 0 }, errors: [{ message: 'x' }], warnings: [], changes: [] } };
    expect(importValues(f, preview)).toEqual({
      source: 'own',
      file: FILE,
      sheet: '',
      namespace: 'occar-a400m',
      skipErrors: true,
      preview: { state: 'done', key: 'k', errors: 1, warnings: 0 },
      owner: 'group:default/a400m',
      mapping: { id: 'B', title: 'C' },
    });
    const apqc = importValues({ ...emptyImport('x1'), file: FILE, source: 'apqc' }, undefined);
    expect([apqc.industry, apqc.version, apqc.mapping, apqc.preview]).toEqual(['', '7.4', undefined, {}]);
  });
  it('orders the changes and makes the cards', () => {
    const { rows, total } = shownChanges(
      [
        { kind: 'new', id: '1', title: 'a', what: '' },
        { kind: 'review', id: '2', title: 'b', what: '' },
        { kind: 'changed', id: '3', title: 'c', what: '' },
      ],
      2,
    );
    expect([rows.map(r => r.id), total]).toEqual([['2', '3'], 3]);
    const cards = cardsOf({ domains: 4, subdomains: 11, new: 9, changed: 6, gone: 2, unchanged: 118 });
    expect(cards.map(c => c.value)).toEqual(['4', '+ 9', '~ 6', '− 2', '118']);
    expect(cards[1].positive).toBe(true);
  });
});

describe('adopt', () => {
  const model: LiteEntity = { kind: 'ReferenceModel', metadata: { name: 'pcf-ad' }, spec: { source: 'apqc', namespace: 'apqc-ad' } };
  const entities = [
    domain('apqc-ad', 'vision', {}, { 'apqc.org/pcf-id': '1.0' }, 'Vision and strategy'),
    domain('apqc-ad', 'vision-1', { subdomainOf: 'vision' }),
    domain('apqc-ad', 'vision-1-1', { subdomainOf: 'domain:apqc-ad/vision-1' }),
    domain('apqc-ad', 'hr', {}, { 'apqc.org/pcf-id': '7.0' }),
    domain('apqc-ad', 'own'),
    bp('apqc-ad', 'p1', 'vision-1-1'),
    bp('apqc-ad', 'p2', 'domain:apqc-ad/vision'),
    bp('apqc-ad', 'p3', 'hr'),
  ];
  it('lists the level-1 domains with their subdomains and processes', () => {
    const c = categoriesOf(entities);
    expect(c).toEqual([
      { id: '1.0', title: 'Vision and strategy', subdomains: 2, processes: 2 },
      { id: '7.0', title: 'hr', subdomains: 0, processes: 1 },
      { id: 'own', title: 'own', subdomains: 0, processes: 0 },
    ]);
    expect(supportIds(model, c)).toEqual(['7.0']);
    expect(supportIds({ ...model, spec: { source: 'template', supportCategories: ['own'] } }, c)).toEqual(['own']);
    expect(adoptTotals(c, ['1.0', '7.0'])).toEqual({ domains: 2, subdomains: 2, processes: 3 });
  });
  it('checks and builds the values of business-model-adopt', () => {
    const f = { model: 'referencemodel:default/pcf-ad', categories: ['1.0', '1.0'], namespace: 'occar-a400m', owner: 'group:default/a400m' };
    expect(adoptProblems(f)).toEqual({});
    expect(adoptValues(f)).toEqual({ ...f, categories: ['1.0'] });
    expect(Object.keys(adoptProblems({ model: '', categories: [], namespace: 'A', owner: '' })).sort()).toEqual(['categories', 'model', 'namespace', 'owner']);
    expect(adoptProblems({ ...f, categories: ['.x'] }).categories?.key).toBe('bmf.err.category');
  });
});

describe('process', () => {
  const entity: LiteEntity = {
    kind: 'BusinessProcess',
    metadata: {
      name: 'repair',
      namespace: 'occar-a400m',
      title: 'Repair',
      annotations: { 'refresquito.io/process-key': 'repair-event', 'backstage.io/managed-by-location': 'url:https://github.com/x/y/blob/main/catalog/business-map/occar-a400m/process-repair.yaml' },
    },
    spec: { owner: 'maintenance', domain: 'mro', criticality: 'critical', rpo: '15m', dependsOn: ['gmao', 'component:default/db'] },
  };
  it('prefills Edit from the entity', () => {
    const f = processFormOf(entity);
    expect(f).toEqual({
      title: 'Repair',
      name: 'repair',
      nameFromTitle: false,
      description: '',
      namespace: 'occar-a400m',
      domain: 'domain:occar-a400m/mro',
      owner: 'group:default/maintenance',
      criticality: 'critical',
      rpo: '15m',
      rto: '',
      retention: '',
      dependsOn: ['system:default/gmao', 'component:default/db'],
      processKey: 'repair-event',
    });
    expect(inOwnFile(entity)).toBe(true);
    expect(inOwnFile({ ...entity, metadata: { ...entity.metadata, annotations: { 'backstage.io/managed-by-location': 'url:.../catalog/business-map/occar-a400m/domain-mro.yaml' } } })).toBe(false);
  });
  it('follows the title with the name until it is typed by hand', () => {
    const f = withTitle(emptyProcess('domain:occar-a400m/mro'), 'Manage repair');
    expect([f.name, f.namespace, f.domain]).toEqual(['manage-repair', 'occar-a400m', 'domain:occar-a400m/mro']);
    expect(withTitle({ ...f, nameFromTitle: false, name: 'mine' }, 'Other').name).toBe('mine');
  });
  it('checks the fields as the template does', () => {
    const f = { ...withTitle(emptyProcess('domain:occar-a400m/mro'), 'Manage repair'), owner: 'group:default/x' };
    expect(processProblems(f, 'new')).toEqual({});
    const bad = { ...f, title: 'Say "hi"', name: '-x', rpo: '15 min', rto: '4h', retention: '30y', processKey: '1bad', domain: '' };
    expect(Object.keys(processProblems(bad, 'new')).sort()).toEqual(['domain', 'name', 'processKey', 'rpo', 'title']);
    expect(processProblems({ ...bad, name: '-x' }, 'edit').name).toBeUndefined();
  });
  it('gives the templates business-process-new and -edit their parameters', () => {
    const f = { ...withTitle(emptyProcess('domain:occar-a400m/mro'), ' Manage repair '), owner: 'group:default/x', dependsOn: ['system:default/a', 'system:default/a'] };
    expect(processValues(f, 'new')).toEqual({
      name: 'manage-repair',
      title: 'Manage repair',
      description: '',
      domain: 'domain:occar-a400m/mro',
      owner: 'group:default/x',
      processKey: '',
      criticality: 'standard',
      rpo: '',
      rto: '',
      retention: '',
      dependsOn: ['system:default/a'],
    });
    const edit = processValues(processFormOf(entity), 'edit', 'businessprocess:occar-a400m/repair');
    expect([edit.process, edit.name, edit.rpo, edit.processKey]).toEqual(['businessprocess:occar-a400m/repair', undefined, '15m', 'repair-event']);
  });
  it('lists the domains of a customer under their parents', () => {
    const ds = [domain('c', 'mro', {}, undefined, 'MRO'), domain('c', 'fleet', { subdomainOf: 'mro' }, undefined, 'Fleet'), domain('d', 'other')];
    expect(domainOptions(ds, 'c')).toEqual([
      { ref: 'domain:c/mro', label: 'MRO', depth: 0 },
      { ref: 'domain:c/fleet', label: 'MRO › Fleet', depth: 1 },
    ]);
    expect(namespacesOf(ds)).toEqual(['c', 'd']);
  });
});
