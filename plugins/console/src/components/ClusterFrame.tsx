import { WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { useParams } from 'react-router-dom';
import { useConsoleConfig } from '../config';

/**
 * The console of another cluster, embedded: its own portal, with its own catalog and permissions, under the same
 * Keycloak login. The other cluster must allow this origin in backend.csp.frame-ancestors.
 */
export const ClusterFrame = () => {
  const { id } = useParams();
  const cfg = useConsoleConfig();
  const target = cfg.clusters.find(c => c.id === id);
  if (!target) {
    return <WarningPanel title={`Unknown cluster ${id}`} message="It is not in console.clusters of this portal." />;
  }
  const src = `${target.url}/console?embed=1`;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: 'calc(100vh - 110px)', minHeight: 480 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          {target.id}
        </Typography>
        <Typography color="text.secondary">{target.kind === 'zone' ? 'zone cluster' : 'programme cluster'}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button href={`${target.url}/console`} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />} size="small">
          Open in a new tab
        </Button>
      </Box>
      <Box
        component="iframe"
        title={`Console of ${target.id}`}
        src={src}
        sx={{ flex: 1, width: '100%', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}
      />
    </Box>
  );
};
