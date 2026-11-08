import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { MapDomain } from '../../businessMap';
import { useI18n } from '../../i18n';
import { biaPath, nameOf } from './businessMapModel';

/**
 * "Download BIA sheet" of Business continuity: the .xlsx of the business impact analysis of a customer
 * (GET /api/business-map/bia), all of it or one level-1 domain (one sheet per business owner), with or without the
 * sub-processes. The owners fill it and it comes back through Import business model › BIA results.
 */
export const BiaDownload = ({ namespace, domains }: { namespace?: string; domains: MapDomain[] }) => {
  const { t } = useI18n();
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [level, setLevel] = useState<'3' | 'all'>('3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const roots = domains.filter(d => !d.parent);
  if (!namespace) return null;
  const download = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`${await discovery.getBaseUrl('business-map')}${biaPath(namespace, domain ? nameOf(domain) : undefined, level)}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `bia-${namespace}.xlsx`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outlined" size="small" onClick={() => setOpen(true)}>
        {t('bm.bia.download')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('bm.bia.download')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <Typography variant="body2" color="text.secondary">
            {t('bm.bia.text', { namespace })}
          </Typography>
          <TextField select size="small" label={t('bm.bia.domain')} value={domain} onChange={e => setDomain(e.target.value)} helperText={t('bm.bia.domain.hint')}>
            <MenuItem value="">{t('bm.bia.domain.all')}</MenuItem>
            {roots.map(d => (
              <MenuItem key={d.ref} value={d.ref}>
                {d.pcfId || d.modelId ? `${d.pcfId ?? d.modelId} ${d.title}` : d.title}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('bm.bia.level')} value={level} onChange={e => setLevel(e.target.value as '3' | 'all')}>
            <MenuItem value="3">{t('bm.bia.level.3')}</MenuItem>
            <MenuItem value="all">{t('bm.bia.level.all')}</MenuItem>
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('bm.bia.cancel')}</Button>
          <Button variant="contained" disableElevation disabled={busy} onClick={download}>
            {t('bm.bia.get')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
