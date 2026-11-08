import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { type ChangeAnswer, ManageError, type ManageOwner, type OwnerView, useManageChange } from '../../manage';
import { ResultNote, type Note } from '../Requests';
import { AppPicker } from './AppPicker';
import { fieldErrors, type Field, fieldsFor, initialValues, shownFor, specFrom } from './manageFormModel';

/**
 * The form of one Manage object (create, or change one): its fields, the application it belongs to, why; then the
 * diff of the file (a dry run of POST /api/manage/changes) and the pull request. Each page of Manage gives its fields;
 * nothing is written to the product: the change happens when the pull request is merged.
 */
export const ManageForm = ({
  service,
  object,
  what,
  fields,
  owners,
  current,
  owner: fixedOwner,
  platform,
  idFromOwner,
  onDone,
  onCancel,
}: {
  service: string;
  object: string;
  /** "bucket": for the title */
  what: string;
  fields: Field[];
  owners: OwnerView[];
  /** the object being changed (its current values, with name); undefined to create one */
  current?: Record<string, unknown> & { name: string };
  /** the owner of the object being changed (it cannot move) */
  owner?: ManageOwner;
  platform?: boolean;
  /** one object per application (its gateway API, its data product…): on create, its name is the application's */
  idFromOwner?: boolean;
  onDone?: (a: ChangeAnswer) => void;
  onCancel?: () => void;
}) => {
  const { t } = useI18n();
  const change = useManageChange();
  const creating = !current;
  const [values, setValues] = useState(() => initialValues(fields, current));
  const [owner, setOwner] = useState<ManageOwner | undefined>(fixedOwner);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ChangeAnswer | undefined>();
  const [note, setNote] = useState<Note | undefined>();
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => fieldsFor(fields, owner).filter(f => !(idFromOwner && creating && f.key === 'name')), [fields, owner, idFromOwner, creating]);
  const errors = useMemo(() => fieldErrors(shown, values, creating), [shown, values, creating]);
  const ready = !!owner && Object.keys(errors).length === 0 && !busy;
  const body = () => ({
    service,
    object,
    action: creating ? ('create' as const) : ('update' as const),
    owner: owner!,
    id: current?.name,
    spec: { ...specFrom(shown, values, creating, current), ...(idFromOwner && creating && owner?.kind === 'application' ? { name: owner.name } : {}) },
    reason: reason.trim() || undefined,
  });
  const send = async (dryRun: boolean) => {
    setBusy(true);
    setNote(undefined);
    setServerErrors([]);
    try {
      const a = await change({ ...body(), dryRun });
      if (dryRun) setPreview(a);
      else {
        setPreview(undefined);
        setNote({ ok: true, text: t('mng.opened', { n: a.pull?.number ?? '', summary: a.summary }), url: a.pull?.url });
        onDone?.(a);
      }
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
      if (e instanceof ManageError) setServerErrors(e.errors);
    } finally {
      setBusy(false);
    }
  };
  /** under a field: what is wrong with it, else its help (lists: how to type them) */
  const helpOf = (f: Field) => {
    if (errors[f.key] && errors[f.key] !== 'required') return errors[f.key];
    if (f.kind === 'list') return `${f.help ? `${f.help} · ` : ''}${t('mng.listHint')}`;
    return f.help;
  };
  const set = (k: string, v: string | boolean) => {
    setValues(x => ({ ...x, [k]: v }));
    setPreview(undefined);
  };
  return (
    <Box component="form" onSubmit={e => e.preventDefault()} sx={{ display: 'grid', gap: 1.5, maxWidth: 720 }} aria-label={creating ? t('mng.create', { what }) : t('mng.edit', { what, id: current!.name })}>
      <Typography variant="h6" component="h3" sx={{ fontSize: 16 }}>
        {creating ? t('mng.create', { what }) : t('mng.edit', { what, id: current!.name })}
      </Typography>
      <AppPicker owners={owners} value={owner} onChange={o => {
          setOwner(o);
          setPreview(undefined);
        }} platform={platform} disabled={!!fixedOwner} />
      {shown
        .filter(f => (creating || !f.createOnly) && shownFor(f, values))
        .map(f =>
          f.kind === 'boolean' ? (
            <FormControlLabel key={f.key} control={<Switch checked={values[f.key] === true} onChange={e => set(f.key, e.target.checked)} />} label={f.label} />
          ) : (
            <TextField
              key={f.key}
              size="small"
              select={f.kind === 'select'}
              label={f.label}
              required={f.required}
              value={String(values[f.key] ?? '')}
              onChange={e => set(f.key, e.target.value)}
              error={!!errors[f.key] && errors[f.key] !== 'required'}
              helperText={helpOf(f)}
              multiline={f.kind === 'list' || f.kind === 'textarea'}
              minRows={f.kind === 'textarea' ? 6 : undefined}
              maxRows={f.kind === 'textarea' ? 16 : undefined}
              slotProps={f.kind === 'textarea' ? { htmlInput: { style: { fontFamily: 'monospace', fontSize: 12 } } } : undefined}
            >
              {f.kind === 'select' && f.options?.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          ),
        )}
      <TextField size="small" label={t('mng.reason')} value={reason} onChange={e => setReason(e.target.value)} multiline minRows={2} />
      {serverErrors.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 3, color: 'error.main' }}>
          {serverErrors.map(e => <li key={e}>{e}</li>)}
        </Box>
      )}
      {preview && (
        <Box>
          <Typography variant="caption" color="text.secondary">{t('mng.diffTitle', { file: preview.file })}</Typography>
          <Box component="pre" sx={{ m: 0, p: 1.25, borderRadius: '8px', bgcolor: 'action.hover', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, overflowX: 'auto' }}>
            {preview.diff}
          </Box>
        </Box>
      )}
      <ResultNote note={note} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {!preview ? (
          <Button variant="contained" disabled={!ready} onClick={() => send(true)} sx={{ textTransform: 'none' }}>
            {t('mng.preview')}
          </Button>
        ) : (
          <Button variant="contained" disabled={!ready} onClick={() => send(false)} sx={{ textTransform: 'none' }}>
            {t('mng.open')}
          </Button>
        )}
        {onCancel && (
          <Button variant="text" onClick={onCancel} sx={{ textTransform: 'none' }}>
            {t('mng.cancel')}
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">{t('mng.viaPr')}</Typography>
      </Box>
    </Box>
  );
};
