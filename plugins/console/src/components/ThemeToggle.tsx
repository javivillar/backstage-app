import { appThemeApiRef, useApi } from '@backstage/core-plugin-api';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import { useI18n } from '../i18n';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';

/**
 * Day / night: switches the theme of the portal (the user's own setting, kept by Backstage). The console reads the
 * mode of that theme and draws itself with its light or dark tokens.
 */
export const ThemeToggle = () => {
  const themes = useApi(appThemeApiRef);
  const { t } = useI18n();
  const dark = useTheme().palette.mode === 'dark';
  const list = themes.getInstalledThemes();
  const target = list.find(t => t.variant === (dark ? 'light' : 'dark'));
  if (!target) return null;
  const label = dark ? t('shell.day') : t('shell.night');
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} size="small" onClick={() => themes.setActiveThemeId(target.id)} sx={{ color: 'text.secondary', width: 32, height: 32, borderRadius: '6px' }}>
        {dark ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
};
