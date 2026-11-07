import { applicationQuery, hasDataProduct, lineageColumns, DATA_PRODUCT } from './EntityData';
import { TAB_GROUPS } from './ConsoleEntityLayout';

const entity = (annotations: Record<string, string>) => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'personnelsecurity-dev-oneke', annotations },
});

const node = (urn: string, inProduct = false) => ({ urn, label: urn, platform: 'postgres', kind: 'dataset', inProduct, url: '' });

describe('the Data tab', () => {
  it('shows only for a deployment with a data product', () => {
    expect(hasDataProduct(entity({ [DATA_PRODUCT]: 'urn:li:dataProduct:sirtap-personnelsecurity' }))).toBe(true);
    expect(hasDataProduct(entity({}))).toBe(false);
  });

  it('asks the backend with the annotations of the deployment', () => {
    const q = new URLSearchParams(
      applicationQuery(
        entity({
          [DATA_PRODUCT]: 'urn:li:dataProduct:sirtap-personnelsecurity',
          'refresquito.io/stage': 'dev',
          'refresquito.io/repository': 'javivillar/personnelsecurity',
          'refresquito.io/deployment-file': 'javivillar/refresquito-services:bootstrap/app-of-apps/apps/personnelsecurity.yaml',
        }),
      ),
    );
    expect(q.get('product')).toBe('urn:li:dataProduct:sirtap-personnelsecurity');
    expect(q.get('stage')).toBe('dev');
    expect(q.get('repository')).toBe('javivillar/personnelsecurity');
    expect(q.get('deploymentFile')).toContain('apps/personnelsecurity.yaml');
    expect(new URLSearchParams(applicationQuery(entity({ [DATA_PRODUCT]: 'urn:li:dataProduct:x' }))).get('stage')).toBe('pro');
  });

  it('lays the lineage out in columns, sources first', () => {
    const cols = lineageColumns(
      [node('chart'), node('pet', true), node('superset-pet'), node('flow_run', true)],
      [
        { from: 'pet', to: 'superset-pet' },
        { from: 'superset-pet', to: 'chart' },
      ],
    );
    expect(cols.map(c => c.map(n => n.urn))).toEqual([['pet', 'flow_run'], ['superset-pet'], ['chart']]);
  });

  it('is in the group Secure, after Security', () => {
    const secure = TAB_GROUPS.find(g => g.label === 'Secure')!;
    expect(secure.paths.indexOf('/data')).toBe(secure.paths.indexOf('/security') + 1);
  });
});
