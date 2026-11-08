import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { pendingFor, useManageDeclared, useManageOwners, useManagePending } from '../../manage';
import { Badge } from '../Badge';
import { TONES } from '../Flow';
import { DeleteConfirm } from './DeleteConfirm';
import { ManageForm } from './ManageForm';
import { declarationOf, type Field } from './manageFormModel';

/**
 * What a section of a Manage page can change through git: the kind of object (service/object of /api/manage), how
 * a person names it, and the fields of its form. A section without it only lists what the product has.
 */
export type SectionManage = {
  service: string;
  object: string;
  /** "bucket", "site": for the buttons and titles */
  what: string;
  fields: Field[];
  /** whether objects of this kind may belong to the platform too */
  platform?: boolean;
  /** the name of a row of the product as the provisioner names it (default: its name) */
  nameOf?: (row: Record<string, unknown>) => string;
};

/** Above the table of a section: "New <what>", and its form. */
export const ManageToolbar = ({ m, onDone }: { m: SectionManage; onDone?: () => void }) => {
  const { t } = useI18n();
  const owners = useManageOwners();
  const [open, setOpen] = useState(false);
  const can = (owners.data ?? []).some(o => o.canWrite);
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {!open && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="contained" disableElevation disabled={!can} onClick={() => setOpen(true)} sx={{ textTransform: 'none' }}>
            {t('mng.create', { what: m.what })}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {can ? t('mng.viaPr') : t('mng.noOwner')}
          </Typography>
        </Box>
      )}
      {open && owners.data && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', p: 2, bgcolor: 'background.paper' }}>
          <ManageForm
            service={m.service}
            object={m.object}
            what={m.what}
            fields={m.fields}
            owners={owners.data}
            platform={m.platform}
            onDone={() => onDone?.()}
            onCancel={() => setOpen(false)}
          />
        </Box>
      )}
    </Box>
  );
};

/**
 * In the detail of the selected object: who it belongs to and its pending change, then Change and Remove when git
 * declares it; when git does not (made by hand, or before Manage), it says so: it can only be changed in the product
 * until it is assigned to an application.
 */
export const ManageRowActions = ({ m, name }: { m: SectionManage; name: string }) => {
  const { t } = useI18n();
  const owners = useManageOwners();
  const declared = useManageDeclared(m.service, m.object);
  const pending = useManagePending(m.service);
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  if (declared.loading) return null;
  const d = declarationOf(declared.data, name);
  const p = d && pendingFor(pending.data, m.object, d.id);
  if (!d) {
    return (
      <Box sx={{ display: 'grid', gap: 0.5 }}>
        <Box>
          <Badge label={t('mng.notInGit')} {...TONES.warn} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t('mng.notInGitText')}
        </Typography>
      </Box>
    );
  }
  const view = owners.data?.find(o => (d.owner.kind === 'platform' ? o.kind === 'platform' : o.kind === 'application' && o.name === d.owner.name));
  const canWrite = !!view?.canWrite && !d.gone;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge label={`${t('mng.owner')}: ${view?.title ?? (d.owner.kind === 'platform' ? 'platform' : d.owner.name)}`} {...TONES.info} />
        {d.gone && <Badge label={t('mng.beingRemoved')} {...TONES.warn} />}
        {p && (
          <a href={p.url} target="_blank" rel="noopener noreferrer">
            {t('mng.pending', { n: p.number })}
          </a>
        )}
      </Box>
      {mode === 'view' && canWrite && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={() => setMode('edit')} sx={{ textTransform: 'none' }}>
            {t('mng.change')}
          </Button>
          <Button size="small" variant="outlined" color="error" onClick={() => setMode('delete')} sx={{ textTransform: 'none' }}>
            {t('mng.delete')}
          </Button>
        </Box>
      )}
      {mode === 'edit' && owners.data && (
        <ManageForm
          service={m.service}
          object={m.object}
          what={m.what}
          fields={m.fields}
          owners={owners.data}
          current={{ ...d.spec, name: d.id }}
          owner={d.owner}
          platform={m.platform}
          onDone={() => pending.reload()}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'delete' && (
        <DeleteConfirm service={m.service} object={m.object} what={m.what} id={d.id} owner={d.owner} onDone={() => pending.reload()} onCancel={() => setMode('view')} />
      )}
    </Box>
  );
};
