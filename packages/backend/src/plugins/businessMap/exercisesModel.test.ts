import { parse } from 'yaml';
import { ExerciseError, exercisePath, exercisePull, exerciseSlug, exerciseYaml, readExercise, resultCounts, writers } from './exercisesModel';

// made-up exercise: no customer data
const BODY = {
  namespace: 'example-customer',
  failed: ['Component:default/Postgres', 'component:default/keycloak'],
  processes: [
    { ref: 'businessprocess:example-customer/plan-a-repair', result: 'gap', marginMinutes: -30 },
    { ref: 'businessprocess:example-customer/order-parts', result: 'meets', marginMinutes: 120 },
    { ref: 'businessprocess:example-customer/report', result: 'meets' },
  ],
  note: '  Tabletop of November  ',
};

describe('readExercise', () => {
  it('reads a body, lowercasing refs and trimming the note', () => {
    const e = readExercise(BODY);
    expect(e.failed).toEqual(['component:default/postgres', 'component:default/keycloak']);
    expect(e.processes[2]).toEqual({ ref: 'businessprocess:example-customer/report', result: 'meets', marginMinutes: null });
    expect(e.note).toBe('Tabletop of November');
  });

  it('refuses what is not an exercise', () => {
    expect(() => readExercise({ ...BODY, namespace: 'Bad_NS' })).toThrow(ExerciseError);
    expect(() => readExercise({ ...BODY, failed: [] })).toThrow(/failed/);
    expect(() => readExercise({ ...BODY, failed: ['postgres'] })).toThrow(/entity reference/);
    expect(() => readExercise({ ...BODY, processes: [{ ref: 'businessprocess:a/b', result: 'Not OK' }] })).toThrow(/result/);
    expect(() => readExercise({ ...BODY, processes: [{ ref: 'businessprocess:a/b', result: 'gap', marginMinutes: '5' }] })).toThrow(/marginMinutes/);
    expect(() => readExercise({ ...BODY, note: 5 })).toThrow(/note/);
    expect(() => readExercise(undefined)).toThrow(/namespace/);
  });

  it('leaves out an empty note and repeated failed refs', () => {
    const e = readExercise({ ...BODY, failed: ['component:default/a', 'component:default/A'], note: ' ' });
    expect(e.failed).toEqual(['component:default/a']);
    expect('note' in e).toBe(false);
  });
});

describe('the file of an exercise', () => {
  const e = readExercise(BODY);

  it('is named by what failed and the day', () => {
    expect(exerciseSlug(e)).toBe('fail-postgres-keycloak');
    expect(exercisePath(e, '2026-11-08')).toBe('continuity/exercises/example-customer/2026-11-08-fail-postgres-keycloak.yaml');
    expect(exercisePath(e, '2026-11-08', 2)).toBe('continuity/exercises/example-customer/2026-11-08-fail-postgres-keycloak-2.yaml');
  });

  it('keeps the slug short', () => {
    const many = { failed: Array.from({ length: 20 }, (_, i) => `component:default/service-number-${i}`) };
    expect(exerciseSlug(many).length).toBeLessThanOrEqual(60);
    expect(exerciseSlug(many)).not.toMatch(/-$/);
  });

  it('says what an exercise is and lists the processes strictest first', () => {
    const text = exerciseYaml(e, { date: '2026-11-08', by: 'user:default/someone' });
    expect(text.startsWith('# A continuity exercise of the business map')).toBe(true);
    const doc = parse(text);
    expect(doc.kind).toBe('ContinuityExercise');
    expect(doc.metadata).toEqual({ name: '2026-11-08-fail-postgres-keycloak', namespace: 'example-customer' });
    expect(doc.spec.summary).toEqual({ gap: 1, meets: 2 });
    expect(doc.spec.processes.map((p: { marginMinutes: number | null }) => p.marginMinutes)).toEqual([-30, 120, null]);
    expect(doc.spec.note).toBe('Tabletop of November');
  });

  it('has a pull request that names what failed and the results', () => {
    const p = exercisePull(e, { date: '2026-11-08', by: 'user:default/someone', path: 'x.yaml' });
    expect(p.title).toBe('Continuity exercise example-customer: fail postgres, keycloak');
    expect(p.body).toContain('1 gap, 2 meets');
    expect(p.body).toContain('> Tabletop of November');
  });
});

describe('helpers', () => {
  it('counts results', () => {
    expect(resultCounts([])).toEqual({});
  });

  it('adds console.actions.groups to the writers once', () => {
    expect(writers()).toEqual(['business-architect', 'backstage-admin']);
    expect(writers(['backstage-admin', 'ops'])).toEqual(['business-architect', 'backstage-admin', 'ops']);
  });
});
