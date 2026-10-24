import { useEffect, useState } from 'react';
import { useFillViewport } from '../shared/useFillViewport';
import { Content, Header, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Fullscreen from '@mui/icons-material/Fullscreen';
import OpenInNew from '@mui/icons-material/OpenInNew';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

type PageName = 'topology' | 'network';

/**
 * The page of the frame: the backend serves it with its own Content-Security-Policy (inline, in srcdoc, it would
 * inherit the one of Backstage, which refuses its scripts). The frame is a navigation of the browser, without the
 * Backstage token: first a session cookie of the topology plugin (like TechDocs).
 */
function useTopology(name: PageName, mode: 'light' | 'dark') {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; src?: string; error?: string; updated?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const base = await discovery.getBaseUrl('topology');
      const status = await (await fetch(`${base}/status`)).json().catch(() => ({}));
      if (!status.available) throw new Error('The OpenNebula host has not published the topology to this cluster yet');
      const cookie = await fetch(`${base}/cookie`, { credentials: 'include' });
      if (!cookie.ok) throw new Error(`${cookie.status} ${cookie.statusText}`);
      return { src: `${base}/frame/${name}?theme=${mode}`, updated: status.updated as string | undefined };
    })().then(
      data => alive && setState({ loading: false, ...data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, name, mode]);
  return state;
}

/**
 * The live topology of the platform: zones, programs and clusters, from OpenNebula down to the namespaces and
 * NetworkPolicies of each cluster, as the OpenNebula host last published it (every 5 minutes).
 */
export const TopologyPage = () => {
  const [page, setPage] = useState<PageName>('topology');
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const { loading, src, error, updated } = useTopology(page, mode);

  // the frame reaches the bottom of the window (a fixed height was cut on a laptop screen, with two scroll bars)
  const { ref: frameRef, height } = useFillViewport<HTMLIFrameElement>([src]);

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
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Tabs value={page} onChange={(_e, v) => setPage(v)} sx={{ flex: 1 }}>
              <Tab value="topology" label="Deployed state" />
              <Tab value="network" label="Design (network.toml)" />
            </Tabs>
            {src && !loading && (
              <>
                <Button size="small" startIcon={<Fullscreen />} onClick={() => frameRef.current?.requestFullscreen?.().catch(() => {})}>
                  Full screen
                </Button>
                {/* the page itself, outside Backstage: the session cookie of the plugin opens it too */}
                <Button size="small" startIcon={<OpenInNew />} href={src} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                </Button>
              </>
            )}
          </Box>
          {loading && <Progress />}
          {error && (
            <WarningPanel severity="info" title="The topology is not available" message={error}>
              <Typography variant="body2">
                The OpenNebula host publishes it every 5 minutes (<code>configuration.py topology-publish</code>, timer{' '}
                <code>one-topology-publish.timer</code>).
              </Typography>
            </WarningPanel>
          )}
          {src && !loading && (
            <iframe
              ref={frameRef}
              title={page === 'topology' ? 'Live topology' : 'Network design'}
              src={src}
              // its scripts draw the diagrams and answer its tabs; no same-origin: it cannot read Backstage or its token
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              allow="fullscreen"
              style={{ width: '100%', height, border: 0, borderRadius: 4, background: 'transparent' }}
            />
          )}
        </Box>
      </Content>
    </Page>
  );
};
