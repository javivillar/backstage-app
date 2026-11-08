import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useI18n } from '../../i18n';
import { type ManageOwner, ownerKey, ownerOf, type OwnerView } from '../../manage';

/**
 * Who an object belongs to: a business application, or the platform. Required in every Manage form: the file of that
 * application declares the object, and DataHub links it to the application. Only the owners the person may change
 * can be picked; the others are listed, disabled.
 */
export const AppPicker = ({
  owners,
  value,
  onChange,
  platform = false,
  disabled,
}: {
  owners: OwnerView[];
  value?: ManageOwner;
  onChange: (o: ManageOwner) => void;
  /** whether the object may belong to the platform (not every kind can) */
  platform?: boolean;
  disabled?: boolean;
}) => {
  const { t } = useI18n();
  const list = owners.filter(o => platform || o.kind === 'application');
  const any = list.some(o => o.canWrite);
  return (
    <div>
      <TextField
        select
        fullWidth
        size="small"
        required
        label={t('mng.owner')}
        value={value ? ownerKey(value) : ''}
        disabled={disabled || !any}
        onChange={e => {
          const o = list.find(x => ownerKey(ownerOf(x)) === e.target.value);
          if (o) onChange(ownerOf(o));
        }}
        helperText={any ? t('mng.ownerHint') : t('mng.noOwner')}
      >
        {list.map(o => (
          <MenuItem key={ownerKey(ownerOf(o))} value={ownerKey(ownerOf(o))} disabled={!o.canWrite}>
            <span>
              {o.title}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {o.canWrite ? (o.owner ? t('mng.ownerTeam', { team: o.owner.replace(/^group:(default\/)?/, '') }) : '') : t('mng.readOnly')}
              </Typography>
            </span>
          </MenuItem>
        ))}
      </TextField>
    </div>
  );
};
