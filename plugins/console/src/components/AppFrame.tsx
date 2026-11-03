import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { useParams } from 'react-router-dom';
import { usePortalLinks } from '../portalApps';
import { useI18n } from '../i18n';
import { useRq } from '../theme/consoleTheme';
import { TitleRow } from './ui';

/**
 * A business application of the Portal menu (Incidents, Accreditation…) inside the console, under the same Keycloak
 * login. The application must let *.<domain> frame it (frame-ancestors); if it does not, the button opens it apart.
 */
export const AppFrame = () => {
  const { application } = useParams();
  const links = usePortalLinks();
  const { t } = useI18n();
  const rq = useRq();
  const app = links.find(l => l.application === application);
  if (!links.length) return <Progress />;
  if (!app) return <WarningPanel title={t('app.unknown', { app: application ?? '' })} message={t('app.unknownWhy')} />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: 'calc(100vh - 120px)', minHeight: 480 }}>
      <TitleRow
        crumbs={[[t('nav.portal'), '/console'], [t('nav.support')], [app.label]]}
        title={app.label}
        sub={app.hint}
        actions={
          <Button href={app.url} target="_blank" rel="noopener" variant="outlined" endIcon={<OpenInNew fontSize="small" />} size="small">
            {t('app.newTab')}
          </Button>
        }
      />
      <Box
        component="iframe"
        title={app.label}
        src={app.url}
        sx={{ flex: 1, width: '100%', border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.sheet }}
      />
    </Box>
  );
};
