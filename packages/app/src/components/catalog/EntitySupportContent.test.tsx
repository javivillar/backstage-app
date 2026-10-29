import { Entity } from '@backstage/catalog-model';
import { catalogApiRef, EntityProvider } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { EntitySupportContent, supportLinks, supportUrl } from './EntitySupportContent';

const deployment = (stage: string, url?: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: `support-${stage}-oneke`,
    annotations: { 'refresquito.io/application': 'support', 'refresquito.io/stage': stage, ...(url ? { 'refresquito.io/url': url } : {}) },
  },
});

const petstore: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'petstore-oneke', namespace: 'default', title: 'Pet Store' },
  spec: { type: 'service' },
};

describe('the support of an element', () => {
  it('is the most stable stage of the support in the catalog', () => {
    expect(supportUrl([deployment('dev', 'https://support-dev.x/'), deployment('pro', 'https://support.x')])).toBe('https://support.x');
    expect(supportUrl([deployment('dev', 'https://support-dev.x/')])).toBe('https://support-dev.x');
    expect(supportUrl([deployment('pro')])).toBeNull();
    expect(supportUrl([])).toBeNull();
  });

  it('links to open an incident on the element and to its incidents', () => {
    expect(supportLinks('https://support.x', petstore)).toEqual({
      open: 'https://support.x/incidents/new?element=component%3Adefault%2Fpetstore-oneke',
      incidents: 'https://support.x/elements/component%3Adefault/petstore-oneke',
    });
  });

  it('shows the links when the support is deployed', async () => {
    const catalogApi = { getEntities: jest.fn().mockResolvedValue({ items: [deployment('dev', 'https://support-dev.x')] }) };
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    const open = await screen.findByText('Open an incident on Pet Store');
    expect(open.closest('a')?.getAttribute('href')).toBe('https://support-dev.x/incidents/new?element=component%3Adefault%2Fpetstore-oneke');
    expect(screen.getByText('Its incidents not closed').closest('a')?.getAttribute('href')).toBe(
      'https://support-dev.x/elements/component%3Adefault/petstore-oneke',
    );
    expect(catalogApi.getEntities).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': 'support' } }),
    );
  });

  it('says so when the support is not deployed', async () => {
    const catalogApi = { getEntities: jest.fn().mockResolvedValue({ items: [] }) };
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, catalogApi]]}>
        <EntityProvider entity={petstore}>
          <EntitySupportContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    expect(await screen.findByText('The support is not deployed')).toBeTruthy();
  });
});
