import { useEffect, useMemo, useState } from 'react';
import { Content, Header, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

type PageName = 'topology' | 'network';

/**
 * Inside the frame, the page's link to the design (network.html) asks this page to switch tab: the frame is
 * sandboxed without same-origin, so it cannot navigate to a sibling file.
 */
const BRIDGE = `<script>document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href="network.html"]');
  if (a) { e.preventDefault(); parent.postMessage({ rqTopology: 'network' }, '*'); }
});</script>`;

/** The page in the theme of Backstage (both pages carry their light and dark palettes, chosen by data-theme). */
function prepare(html: string, mode: 'light' | 'dark'): string {
  return html.replace(/<html([^>]*)>/i, `<html$1 data-theme="${mode}">`).replace(/<\/body>/i, `${BRIDGE}</body>`);
}

function useTopology(name: PageName) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; html?: string; error?: string; updated?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const base = await discovery.getBaseUrl('topology');
      const status = await (await fetch(`${base}/status`)).json().catch(() => ({}));
      const res = await fetch(`${base}/page/${name}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      return { html: await res.text(), updated: status.updated as string | undefined };
    })().then(
      data => alive && setState({ loading: false, ...data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, name]);
  return state;
}

/**
 * The live topology of the platform: zones, programs and clusters, from OpenNebula down to the namespaces and
 * NetworkPolicies of each cluster, as the OpenNebula host last published it (every 5 minutes).
 */
export const TopologyPage = () => {
  const [page, setPage] = useState<PageName>('topology');
  const { loading, html, error, updated } = useTopology(page);
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const doc = useMemo(() => (html ? prepare(html, mode) : undefined), [html, mode]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.rqTopology === 'network') setPage('network');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <Page themeId="tool">
      <Header
        title="Topology"
        subtitle={`Networks, clusters and segregation of the platform${updated ? ` · published ${new Date(updated).toLocaleString()}` : ''}`}
      />
      <Content>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Tabs value={page} onChange={(_e, v) => setPage(v)}>
            <Tab value="topology" label="Deployed state" />
            <Tab value="network" label="Design (network.toml)" />
          </Tabs>
          {loading && <Progress />}
          {error && (
            <WarningPanel severity="info" title="The topology is not available" message={error}>
              <Typography variant="body2">
                The OpenNebula host publishes it every 5 minutes (<code>configuration.py topology-publish</code>, timer{' '}
                <code>one-topology-publish.timer</code>).
              </Typography>
            </WarningPanel>
          )}
          {doc && !loading && (
            <iframe
              title={page === 'topology' ? 'Live topology' : 'Network design'}
              srcDoc={doc}
              // its scripts draw the diagrams; no same-origin: it cannot read Backstage or its token
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              style={{ width: '100%', height: 'calc(100vh - 230px)', minHeight: 600, border: 0, borderRadius: 4 }}
            />
          )}
        </Box>
      </Content>
    </Page>
  );
};
