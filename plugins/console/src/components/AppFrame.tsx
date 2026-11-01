import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { useParams } from 'react-router-dom';
import { usePortalLinks } from '../portalApps';

/**
 * A business application of the Portal menu (Incidents, Accreditation…) inside the console, under the same Keycloak
 * login. The application must let *.<domain> frame it (frame-ancestors); if it does not, the button opens it apart.
 */
export const AppFrame = () => {
  const { application } = useParams();
  const links = usePortalLinks();
  const app = links.find(l => l.application === application);
  if (!links.length) return <Progress />;
  if (!app) return <WarningPanel title={`Unknown application ${application}`} message="It is not in console.portalApps, or the catalog does not know its URL." />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: 'calc(100vh - 110px)', minHeight: 480 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          {app.label}
        </Typography>
        {app.hint && <Typography color="text.secondary">{app.hint}</Typography>}
        <Box sx={{ flex: 1 }} />
        <Button href={app.url} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />} size="small">
          Open in a new tab
        </Button>
      </Box>
      <Box
        component="iframe"
        title={app.label}
        src={app.url}
        sx={{ flex: 1, width: '100%', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}
      />
    </Box>
  );
};
