import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import type { CheckResult, Criticality } from '../../businessMap';
import { useI18n } from '../../i18n';
import { Pill } from '../ui';
import { CRIT_COLOURS, resultLabel, resultTone } from './businessMapModel';

/** A criticality pill (critical / important / standard): its own colours, darker the stricter, in both themes. */
export const CritPill = ({ value, children }: { value: Criticality; children?: ReactNode }) => {
  const { t } = useI18n();
  const c = CRIT_COLOURS[useTheme().palette.mode === 'dark' ? 'dark' : 'light'][value];
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', height: 22, px: 1.125, borderRadius: 999, fontSize: 12, fontWeight: 500, lineHeight: '22px', whiteSpace: 'nowrap', bgcolor: c.bg, color: c.fg }}>
      {children ?? t(`bm.crit.${value}`)}
    </Box>
  );
};

/** The result of a check: meets, no check yet, or the gap (with what is wrong when given). */
export const ResultPill = ({ result, text, gaps = [] }: { result: CheckResult; text?: string; gaps?: Array<{ element: string; field: 'rpo' | 'rto' }> }) => {
  const { t } = useI18n();
  const label = resultLabel({ result, gaps: gaps.map(g => ({ ...g, needs: '', delivers: '' })) });
  return (
    <Pill tone={resultTone(result)} plain>
      {text ?? t(label.key, label.vars)}
    </Pill>
  );
};

/** RPO / RTO as a pair, a dash for what is not known. */
export const pair = (v: { rpo: string | null; rto: string | null } | null | undefined) => `${v?.rpo ?? '—'} / ${v?.rto ?? '—'}`;
