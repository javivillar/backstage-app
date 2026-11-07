import { grafanaUrl, hasGrafanaDashboard, GRAFANA_URL, GRAFANA_LOGS } from './EntityGrafana';
import { TAB_GROUPS } from './ConsoleEntityLayout';

const entity = (annotations: Record<string, string>) => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'support-dev-oneke', annotations },
});

describe('grafanaUrl', () => {
  it('builds the kiosk URL of a Logs dashboard with its filters', () => {
    const u = grafanaUrl('http://grafana.refresquito.com/', 'support-dev-logs', {
      range: '6h', theme: 'dark', kiosk: true, level: 'error', container: '', search: 'timeout',
    });
    expect(u.startsWith('http://grafana.refresquito.com/d/support-dev-logs?kiosk&')).toBe(true);
    const q = new URLSearchParams(u.split('?')[1]);
    expect(q.get('from')).toBe('now-6h');
    expect(q.get('to')).toBe('now');
    expect(q.get('theme')).toBe('dark');
    expect(q.get('var-level')).toBe('error');
    expect(q.get('var-container')).toBe('$__all');
    expect(q.get('var-search')).toBe('timeout');
  });
  it('leaves the variables out of a Performance dashboard and kiosk out of the full link', () => {
    const u = grafanaUrl('http://g', 'petstore-performance', { range: '1h' });
    expect(u).toBe('http://g/d/petstore-performance?from=now-1h&to=now');
  });
});

describe('hasGrafanaDashboard', () => {
  it('needs the base URL and the uid', () => {
    expect(hasGrafanaDashboard('logs')(entity({ [GRAFANA_URL]: 'http://g', [GRAFANA_LOGS]: 'x' }) as any)).toBe(true);
    expect(hasGrafanaDashboard('performance')(entity({ [GRAFANA_URL]: 'http://g', [GRAFANA_LOGS]: 'x' }) as any)).toBe(false);
    expect(hasGrafanaDashboard('logs')(entity({ [GRAFANA_LOGS]: 'x' }) as any)).toBe(false);
  });
});

describe('tab groups', () => {
  it('puts Logging and Performance in Operate right after Live', () => {
    const operate = TAB_GROUPS.find(g => g.label === 'Operate')!;
    expect(operate.paths.slice(0, 3)).toEqual(['/live', '/logging', '/performance']);
  });
});
