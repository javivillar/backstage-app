import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
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
 * Framed, an application of refresquito-angular ≥ 3.3.2 drops its own header (user, Sign out, light/dark: the console
 * shows them) and takes the console's mode from `rq-theme`, so it reads as a page of the console.
 */

/** The URL of the application with the console's mode (light|dark) for its shell. */
export function embedUrl(url: string, mode: 'light' | 'dark'): string {
  const u = new URL(url);
  u.searchParams.set('rq-theme', mode);
  return u.toString();
}

export const AppFrame = () => {
  const { application } = useParams();
  const links = usePortalLinks();
  const { t } = useI18n();
  const rq = useRq();
  const mode = useTheme().palette.mode;
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
        src={embedUrl(app.url, mode)}
        sx={{ flex: 1, width: '100%', border: 0, borderTop: `1px solid ${rq.border}`, bgcolor: rq.sheet }}
      />
    </Box>
  );
};
