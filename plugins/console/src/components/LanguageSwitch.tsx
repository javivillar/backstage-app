import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Translate from '@mui/icons-material/Translate';
import { useState } from 'react';
import { LANGS, useI18n } from '../i18n';

/** EN / ES: the language of the console, kept in this browser. */
export const LanguageSwitch = () => {
  const { lang, setLang, t } = useI18n();
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        size="small"
        variant="text"
        aria-label={t('shell.language')}
        aria-haspopup="menu"
        onClick={e => setEl(e.currentTarget)}
        startIcon={<Translate sx={{ fontSize: '16px !important' }} />}
        sx={{ color: 'text.secondary', minWidth: 0, px: 1, height: 32 }}
      >
        {lang.toUpperCase()}
      </Button>
      <Menu anchorEl={el} open={!!el} onClose={() => setEl(null)}>
        {LANGS.map(l => (
          <MenuItem key={l.id} selected={l.id === lang} onClick={() => { setLang(l.id); setEl(null); }}>
            {l.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
