import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { type ChangeAnswer, type ManageOwner, useManageChange } from '../../manage';
import { TONES } from '../Flow';
import { ResultNote, type Note } from '../Requests';

/**
 * Removing a Manage object: a pull request that marks it for removal (state: absent), which the platform deletes on
 * merge, with its content. The person types the name to confirm and says why; the diff is shown before it opens.
 */
export const DeleteConfirm = ({
  service,
  object,
  what,
  id,
  owner,
  onDone,
  onCancel,
}: {
  service: string;
  object: string;
  what: string;
  id: string;
  owner: ManageOwner;
  onDone?: (a: ChangeAnswer) => void;
  onCancel: () => void;
}) => {
  const { t } = useI18n();
  const change = useManageChange();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ChangeAnswer | undefined>();
  const [note, setNote] = useState<Note | undefined>();
  const [busy, setBusy] = useState(false);
  const send = async (dryRun: boolean) => {
    setBusy(true);
    setNote(undefined);
    try {
      const a = await change({ service, object, action: 'delete', owner, id, reason: reason.trim() || undefined, dryRun });
      if (dryRun) setPreview(a);
      else {
        setNote({ ok: true, text: t('mng.opened', { n: a.pull?.number ?? '', summary: a.summary }), url: a.pull?.url });
        onDone?.(a);
      }
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box role="alertdialog" aria-label={t('mng.deleteTitle', { what, id })} sx={{ display: 'grid', gap: 1.25, bgcolor: TONES.warn.bg, borderRadius: '8px', p: 1.5, maxWidth: 720 }}>
      <Typography sx={{ fontWeight: 600 }}>{t('mng.deleteTitle', { what, id })}</Typography>
      <Typography variant="body2">{t('mng.deleteText')}</Typography>
      <TextField size="small" label={t('mng.typeName')} value={typed} onChange={e => setTyped(e.target.value)} />
      <TextField size="small" label={t('mng.reason')} value={reason} onChange={e => setReason(e.target.value)} multiline minRows={2} />
      {preview && (
        <Box component="pre" sx={{ m: 0, p: 1.25, borderRadius: '8px', bgcolor: 'background.paper', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, overflowX: 'auto' }}>
          {preview.diff}
        </Box>
      )}
      <ResultNote note={note} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" color="error" disabled={typed !== id || busy} onClick={() => send(!preview)} sx={{ textTransform: 'none' }}>
          {preview ? t('mng.open') : t('mng.preview')}
        </Button>
        <Button variant="text" onClick={onCancel} sx={{ textTransform: 'none' }}>
          {t('mng.cancel')}
        </Button>
      </Box>
    </Box>
  );
};
