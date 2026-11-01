import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import type { ClusterNetwork } from '../network';
import { journeyLanes, networkLanes } from './EntityNetwork';
import { mapLanes, NetworkPage } from './NetworkPage';

const net: ClusterNetwork = {
  generatedAt: '2026-11-01T08:00:00.000Z',
  warnings: [],
  entry: { service: 'one-traefik', namespace: 'traefik-system', ports: ['80→32080', '443→32443'] },
  hosts: [
    { host: 'petstore.x', namespace: 'petstore', ingress: 'petstore', service: 'petstore-ui', tls: true },
    { host: 'iam.x', namespace: 'iam', ingress: 'keycloak', service: 'keycloak', tls: true },
    { host: 'whisker.x', namespace: 'calico-system', ingress: 'whisker', tls: true },
  ],
  segments: [
    { name: 'business-support', policy: 'refresquito.business-support', enforced: false, actions: ['Pass'], namespaces: 2 },
    { name: 'iam', policy: 'refresquito.iam', enforced: true, actions: ['Allow', 'Deny'], namespaces: 1 },
  ],
  namespaces: [
    {
      name: 'petstore',
      segment: 'business-support',
      system: false,
      hosts: ['petstore.x'],
      isolation: 'isolated',
      egressRestricted: true,
      policies: [{ name: 'only-traefik', appliesTo: 'all', ingress: true, egress: true, from: ['namespace traefik-system (TCP 8080)'], to: ['namespace iam (TCP 443)'] }],
      pods: { ready: 1, total: 2 },
    },
    { name: 'shop', segment: 'business-support', system: false, hosts: [], isolation: 'open', egressRestricted: false, policies: [], pods: { ready: 1, total: 1 } },
    { name: 'iam', segment: 'iam', system: false, hosts: ['iam.x'], isolation: 'partial', egressRestricted: false, policies: [], pods: { ready: 1, total: 1 } },
    { name: 'kube-system', system: true, hosts: [], isolation: 'open', egressRestricted: false, policies: [] },
  ],
};

describe('network diagrams', () => {
  it('draws the user journey up to the pods', () => {
    const lanes = journeyLanes('Petstore', net.namespaces[0], net);
    expect(lanes.map(l => l.label)).toEqual(['User', 'Zone', 'Cluster', 'Ingress', 'Login', 'Application']);
    expect(lanes[3].nodes[0]).toMatchObject({ title: 'petstore.x', state: 'TLS', tone: 'ok' });
    expect(lanes[4].nodes[0]).toMatchObject({ title: 'Keycloak', sub: 'iam.x' });
    expect(lanes[5].nodes[0]).toMatchObject({ sub: '1 / 2 pods ready', state: 'Degraded', tone: 'warn' });
    // outside the cluster: drawn dashed, never invented
    expect(lanes[1].nodes[0].dashed).toBe(true);
  });

  it('shows who can talk to an isolated and to an open namespace', () => {
    const iso = networkLanes('Petstore', net.namespaces[0], net);
    expect(iso[0].nodes.map(n => n.state)).toEqual(['Allowed', 'Denied']);
    expect(iso[2].nodes.map(n => n.title)).toEqual(['namespace iam (TCP 443)', 'Anything else']);
    const open = networkLanes('Shop', net.namespaces[1], net);
    expect(open[0].nodes[0]).toMatchObject({ title: 'Every namespace of the cluster', state: 'Open', sub: 'segment business-support lets everything through (Pass)' });
    expect(open[2].nodes[0]).toMatchObject({ title: 'Anything', state: 'Open' });
  });

  it('maps the cluster without the namespaces of the cluster itself', () => {
    const lanes = mapLanes(net);
    expect(lanes[2].nodes.map(n => n.state)).toEqual(['Pass-through', 'Enforced']);
    expect(lanes[3].nodes.map(n => n.title)).toEqual(['1 isolated', '1 partly isolated', '1 open to the cluster']);
  });

  it('renders the Network page from the backend', async () => {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program' } } })],
          [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
          [fetchApiRef, { fetch: async () => new Response(JSON.stringify(net), { status: 200 }) }],
        ]}
      >
        <NetworkPage />
      </TestApiProvider>,
    );
    expect(await screen.findByText('Network of nato-sirtap')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cluster map' })).toBeInTheDocument();
    expect(screen.getByText('Live flows in Calico Whisker')).toHaveAttribute('href', 'https://whisker.x');
  });
});
