import { belongs, tagsOf } from './security';
import { Entity } from '@backstage/catalog-model';
import { securityOwner } from './actions';

describe('security tags', () => {
  it('reads lists (groups, roles) and strings (clients)', () => {
    expect(
      tagsOf({
        'refresquito.component': ['superset-oneke'],
        'refresquito.stage': ['dev', 'pro'],
      }),
    ).toMatchObject({
      component: 'superset-oneke',
      stages: ['dev', 'pro'],
    });
    expect(
      tagsOf({
        'refresquito.component': 'petstore',
        'refresquito.stage': 'pro',
      }),
    ).toMatchObject({
      component: 'petstore',
      stages: ['pro'],
    });
    expect(tagsOf(undefined)).toMatchObject({
      component: undefined,
      stages: [],
    });
  });

  it('shows an object for its component and stage; one without stage for every stage', () => {
    const dev = tagsOf({
      'refresquito.component': ['animalshelter'],
      'refresquito.stage': ['dev'],
    });
    const every = tagsOf({ 'refresquito.component': ['animalshelter'] });
    expect(belongs(dev, 'animalshelter', 'dev')).toBe(true);
    expect(belongs(dev, 'animalshelter', 'pro')).toBe(false);
    expect(belongs(every, 'animalshelter', 'pro')).toBe(true);
    expect(belongs(dev, 'animalshelter')).toBe(true);
    expect(belongs(dev, 'petstore', 'dev')).toBe(false);
  });
});

describe('owner of a group made from Backstage', () => {
  const entity = (
    name: string,
    annotations: Record<string, string> = {},
  ): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name, annotations },
  });
  it('is the Component of a service', () => {
    expect(securityOwner(entity('superset-oneke'))).toEqual({
      component: 'superset-oneke',
      stage: undefined,
    });
  });
  it('is the application and its stage', () => {
    expect(
      securityOwner(
        entity('animalshelter-dev-oneke', {
          'refresquito.io/application': 'animalshelter',
          'refresquito.io/stage': 'dev',
        }),
      ),
    ).toEqual({ component: 'animalshelter', stage: 'dev' });
  });
});
