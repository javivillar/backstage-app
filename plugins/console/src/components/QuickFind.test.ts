import type { Entity } from '@backstage/catalog-model';
import { findMatches } from './QuickFind';
import { ownerRef } from './PortalHome';

const e = (name: string, title?: string): Entity => ({ apiVersion: 'v1', kind: 'Component', metadata: { name, title } });

describe('quick find and ownership', () => {
  it('ranks exact, then prefix, then contains', () => {
    const all = [e('petstore-oneke', 'Petstore'), e('my-pets'), e('pets'), e('iam-oneke')];
    expect(findMatches(all, 'pets').map(x => x.metadata.name)).toEqual(['pets', 'petstore-oneke', 'my-pets']);
    expect(findMatches(all, 'pet').map(x => x.metadata.name)).toEqual(['pets', 'petstore-oneke', 'my-pets']);
    expect(findMatches(all, '  ')).toEqual([]);
  });

  it('turns an owner into an entity ref', () => {
    expect(ownerRef('team-pets')).toBe('group:default/team-pets');
    expect(ownerRef('group:team-pets')).toBe('group:default/team-pets');
    expect(ownerRef('Group:Default/Team-Pets')).toBe('group:default/team-pets');
    expect(ownerRef(undefined)).toBeUndefined();
  });
});
