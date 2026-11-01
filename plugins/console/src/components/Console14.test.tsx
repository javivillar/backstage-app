import type { Entity } from '@backstage/catalog-model';
import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { collectTabs, groupTabs } from './ConsoleEntityLayout';
import { dependencyNodes, healthOf } from './EntityDependencies';
import { ManageHubPage } from './ManagePages';

const Route = (_: { path: string; title: string; children?: unknown }) => null;

describe('console 1.4', () => {
  it('groups the tabs of an entity and puts the rest under More; a console tab replaces the classic one', () => {
    const tabs = collectTabs(
      <>
        <Route path="/" title="Overview" />
        <Route path="/ci-cd" title="CI/CD" />
        <Route path="/kubernetes" title="Kubernetes" />
        <Route path="/dependencies" title="classic deps" />
        <>
          <Route path="/live" title="Live" />
          <Route path="/dependencies" title="console deps" />
        </>
      </>,
    );
    expect(tabs.map(t => t.path)).toEqual(['/', '/ci-cd', '/kubernetes', '/live', '/dependencies']);
    expect(tabs.find(t => t.path === '/dependencies')?.title).toBe('console deps');
    const { groups, more } = groupTabs(tabs);
    expect(groups.map(g => [g.label, g.tabs.map(t => t.path)])).toEqual([
      ['Overview', ['/']],
      ['Operate', ['/live', '/dependencies']],
      ['Build', ['/ci-cd']],
    ]);
    expect(more.map(t => t.path)).toEqual(['/kubernetes']);
  });

  it('reads who uses an entity and what it uses, through its APIs too', () => {
    const e: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'petstore', namespace: 'default' },
      relations: [
        { type: 'dependsOn', targetRef: 'component:default/iam-oneke' },
        { type: 'dependencyOf', targetRef: 'component:default/orders' },
        { type: 'providesApi', targetRef: 'api:default/petstore-api' },
      ],
    };
    const api: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'API', metadata: { name: 'petstore-api' }, relations: [{ type: 'apiConsumedBy', targetRef: 'component:default/web' }] };
    const nodes = dependencyNodes(e, new Map([['api:default/petstore-api', api]]));
    expect(nodes.map(n => [n.side, n.name, n.via])).toEqual([
      ['down', 'iam-oneke', 'depends on'],
      ['up', 'orders', 'depends on it'],
      ['up', 'web', 'API petstore-api'],
    ]);
    const apps = [{ name: 'iam-oneke', sync: 'Synced', health: 'Healthy', autosync: true }, { name: 'orders', sync: 'OutOfSync', health: 'Healthy', autosync: true }];
    expect(healthOf('iam', apps).tone).toBe('ok');
    expect(healthOf('orders', apps).tone).toBe('warn');
    expect(healthOf('nope', apps).tone).toBe('off');
  });

  it('shows every platform service in Manage with what it holds', async () => {
    const fetchFake = async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/users')) return new Response(JSON.stringify({ items: [{ username: 'javi' }, { username: 'ana' }] }));
      if (u.endsWith('/overview')) return new Response(JSON.stringify({ apps: [{ name: 'iam-oneke', sync: 'Synced', health: 'Healthy', autosync: true }], nodes: [], storage: [], volumes: [] }));
      return new Response(JSON.stringify({ items: [] }));
    };
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [configApiRef, new MockConfigApi({ console: { enabled: true } })],
          [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
          [fetchApiRef, { fetch: fetchFake }],
        ]}
      >
        <ManageHubPage />
      </TestApiProvider>,
    );
    expect(await screen.findByText('IAM')).toBeInTheDocument();
    expect(screen.getByText('Workflow integration')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument(); // users of IAM
  });
});

describe('build tabs', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { openApiOperations, repoSlug, runStats } = require('./EntityBuild');
  it('reads the operations of an OpenAPI definition in YAML and JSON', () => {
    const yaml = [
      'openapi: 3.1.0',
      'paths:',
      '  /pets:',
      '    get:',
      '      summary: List pets',
      '    post:',
      '      summary: Add a pet',
      '  "/health":',
      '    get:',
      '      summary: Health',
      '      security: []',
      'components:',
      '  schemas: {}',
    ].join('\n');
    expect(openApiOperations(yaml)).toEqual([
      { method: 'GET', path: '/pets', summary: 'List pets', open: false },
      { method: 'POST', path: '/pets', summary: 'Add a pet', open: false },
      { method: 'GET', path: '/health', summary: 'Health', open: true },
    ]);
    expect(openApiOperations('{"paths":{"/a":{"delete":{"summary":"x"}}}}')).toEqual([{ method: 'DELETE', path: '/a', summary: 'x', open: false }]);
  });
  it('finds the repository and summarises the runs', () => {
    expect(repoSlug({ apiVersion: 'v1', kind: 'Component', metadata: { name: 'x', annotations: { 'refresquito.io/repository': 'https://github.com/javivillar/petstore' } } })).toBe('javivillar/petstore');
    const run = (c: string, s: number) => ({ status: 'completed', conclusion: c, created_at: '2026-11-01T10:00:00Z', updated_at: new Date(Date.parse('2026-11-01T10:00:00Z') + s * 1000).toISOString() });
    expect(runStats([run('success', 60), run('failure', 30), run('success', 120), run('cancelled', 1)])).toEqual({ rate: 67, median: 60 });
  });
});

describe('docs reader', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseDocPage } = require('./EntityDocs');
  it('keeps the article, cleans it and reads the pages and headings of an MkDocs page', () => {
    const html = `<html><head><title>Petstore</title></head><body>
      <nav class="md-nav md-nav--primary"><ul><li><a class="md-nav__link" href="./">Home</a></li><li><a class="md-nav__link" href="arch/">Architecture</a></li></ul></nav>
      <article><h1>Petstore</h1><script>alert(1)</script><p onclick="x()">Hi <a href="javascript:evil()">x</a></p>
      <h2 id="run">Run it</h2><img src="img/a.png"></article></body></html>`;
    const p = parseDocPage(html, 'http://b/api/techdocs/static/docs/default/component/petstore', '');
    expect(p.title).toBe('Petstore');
    expect(p.html).not.toMatch(/script|onclick|javascript/);
    expect(p.html).toContain('src="http://b/api/techdocs/static/docs/default/component/petstore/img/a.png"');
    expect(p.toc).toEqual([{ id: 'run', title: 'Run it', level: 2 }]);
    expect(p.nav.map((n: { path: string }) => n.path)).toEqual(['', 'arch/']);
  });
});
