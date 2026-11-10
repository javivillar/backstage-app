import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../i18n';
import type { ComponentRow, SegKind, SiteRole, SlotState } from '../interconnection';
import { useRq } from '../theme/consoleTheme';
import { Pill, type Tone } from './ui';

/** Pieces shared by the pages of the interconnection: the kind of a segregation, the state of a component, a typed confirmation. */

const KIND_TONE: Record<SegKind, Tone> = { programme: 'neu', common: 'pos', landing: 'info', integration: 'warn' };

/** Programme / Common / Landing · core / Integration · edge. */
export const KindPill = ({ kind }: { kind: SegKind }) => {
  const { t } = useI18n();
  return (
    <Pill tone={KIND_TONE[kind]} plain>
      {t(`ic.kind.${kind}`)}
    </Pill>
  );
};

/** "Core site" or "Edge site". */
export const SitePill = ({ role }: { role: SiteRole }) => {
  const { t } = useI18n();
  return (
    <Pill tone={role === 'core' ? 'info' : 'warn'} plain>
      {t(`ic.site.${role}`)}
    </Pill>
  );
};

export const STATE_TONE: Record<SlotState, Tone> = { running: 'pos', creating: 'info', git: 'info', waiting: 'warn', stopped: 'warn', failed: 'neg', missing: 'neu' };

/** Where a component is: running, being created, waiting for room in the hosts, failed, or not created. */
export const StatePill = ({ state }: { state: SlotState }) => {
  const { t } = useI18n();
  return <Pill tone={STATE_TONE[state]}>{t(`ic.state.${state}`)}</Pill>;
};

/** 2 vCPU · 4 GiB · 20 GB, with what is known. */
export const sizeText = (r: Pick<ComponentRow, 'cpu' | 'memoryMb' | 'diskGb'>) =>
  [r.cpu !== undefined ? `${r.cpu} vCPU` : '', r.memoryMb !== undefined ? `${Math.round((r.memoryMb / 1024) * 10) / 10} GiB` : '', r.diskGb !== undefined ? `${r.diskGb} GB` : ''].filter(Boolean).join(' · ') || '—';

/** Before a change that destroys something: its consequences, and the name typed to open the pull request. */
export const TypeToConfirm = ({ title, text, name, busy, onYes, onNo }: { title: string; text: ReactNode; name: string; busy: boolean; onYes: () => void; onNo: () => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  const [typed, setTyped] = useState('');
  return (
    <Box role="alertdialog" aria-label={title} sx={{ display: 'grid', gap: 1.25, border: `1px solid ${rq.negative}`, borderRadius: '8px', bgcolor: rq.neg.bg, color: rq.neg.fg, p: 2, mb: 3 }}>
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
      <Typography component="div">{text}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" label={t('ic.typeName', { name })} value={typed} onChange={e => setTyped(e.target.value)} sx={{ minWidth: 280, '& .MuiInputBase-root': { bgcolor: rq.sheet } }} autoComplete="off" />
        <Button variant="contained" color="error" disabled={typed.trim() !== name || busy} onClick={onYes}>
          {t('vmr.openPr')}
        </Button>
        <Button variant="text" onClick={onNo}>
          {t('vmr.cancel')}
        </Button>
      </Box>
    </Box>
  );
};

/** A choice card of the marketplace: what it is, what it creates, chosen or not, or why it is not offered here. */
export const ChoiceCard = ({ title, badge, badgeTone = 'neu', desc, foot, chosen, disabled, action, onPick, children }: {
  title: string; badge?: string; badgeTone?: Tone; desc: ReactNode; foot?: ReactNode; chosen: boolean; disabled?: string; action: string; onPick: () => void; children?: ReactNode;
}) => {
  const rq = useRq();
  const { t } = useI18n();
  return (
    <Box sx={{ border: `1px solid ${chosen ? rq.data : rq.border}`, boxShadow: chosen ? `0 0 0 1px ${rq.data}` : 'none', borderRadius: '8px', p: 2, display: 'grid', gap: 1, alignContent: 'start', bgcolor: rq.sheet, opacity: disabled ? 0.65 : 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h3">
          {title}
        </Typography>
        {badge && (
          <Pill tone={badgeTone} plain>
            {badge}
          </Pill>
        )}
      </Box>
      <Typography variant="body2">{desc}</Typography>
      {children}
      {foot && (
        <Typography variant="caption" color="text.secondary">
          {foot}
        </Typography>
      )}
      {disabled ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          {disabled}
        </Typography>
      ) : (
        <Button variant="outlined" onClick={onPick} sx={{ justifySelf: 'start' }} aria-pressed={chosen}>
          {chosen ? t('infra.chosen') : action}
        </Button>
      )}
    </Box>
  );
};
