import { cleanValues, defaultsOf, linesOf, problemsOf, stepsOf, stepStates } from './newAppModel';

const template = {
  spec: {
    parameters: [
      { title: 'The application', required: ['name'], properties: { name: { type: 'string', pattern: '^[a-z][a-z0-9]*$' }, sso: { type: 'boolean', default: true } } },
      {
        title: 'Where it runs',
        properties: {
          frameworkVersion: {
            type: 'string',
            enum: ['3.3', '0.1'],
            enumNames: ['3.3 (refresquito-fastapi 3.3.0, refresquito-angular 3.3.1) - the look of Refresquito', '0.1'],
          },
          s3Buckets: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' } },
        },
      },
    ],
  },
};

describe('newAppModel', () => {
  const steps = stepsOf(template);

  it('reads the steps and their defaults from the template', () => {
    expect(steps.map(s => s.title)).toEqual(['The application', 'Where it runs']);
    expect(defaultsOf(steps)).toEqual({ name: '', sso: true, frameworkVersion: '', s3Buckets: [] });
  });

  it('reads the lines of a framework with their releases', () => {
    const [latest, first] = linesOf(steps[1].properties.frameworkVersion);
    expect(latest).toMatchObject({ value: '3.3', what: 'the look of Refresquito' });
    expect(latest.releases).toEqual([
      { name: 'refresquito-fastapi', version: '3.3.0' },
      { name: 'refresquito-angular', version: '3.3.1' },
    ]);
    expect(first).toMatchObject({ value: '0.1', releases: [], what: '' });
  });

  it('checks required fields, patterns and repeated items', () => {
    expect(problemsOf(steps[0], { name: '' })).toEqual({ name: 'Required.' });
    expect(problemsOf(steps[0], { name: 'Orders-1' }).name).toMatch(/Not valid/);
    expect(problemsOf(steps[1], { s3Buckets: ['docs', 'docs'] }).s3Buckets).toBe('Each one only once.');
    expect(problemsOf(steps[1], { s3Buckets: ['X'] }).s3Buckets).toBe('Not valid: X.');
  });

  it('drops the empty rows of the lists', () => {
    expect(cleanValues(steps, { name: 'orders', sso: true, frameworkVersion: '3.3', s3Buckets: ['docs', ''] }).s3Buckets).toEqual(['docs']);
  });

  it('follows the state of each step of a task', () => {
    const m = stepStates([
      { id: 1, type: 'log', body: { stepId: 'fetch', status: 'processing' } },
      { id: 2, type: 'log', body: { stepId: 'fetch', status: 'completed' } },
    ]);
    expect(m.get('fetch')).toBe('completed');
  });
});
