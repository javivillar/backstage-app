import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { ProgrammeRow } from '../programmes';
import { useRq } from '../theme/consoleTheme';
import { Pill } from './ui';

export const PROGRAMMES_PATH = '/console/infrastructure/programmes';

/** Where a programme is on this platform: its cluster, its segregation, another zone (a mismatch), or nowhere. */
export const ProgrammeState = ({ row }: { row: ProgrammeRow }) => {
  const { t } = useI18n();
  const p = row.placed;
  return (
    <>
      {p?.cluster && <Pill tone="pos">{t('prog.state.cluster', { name: p.cluster })}</Pill>}
      {p && !p.cluster && <Pill tone="info" plain>{t('prog.state.segregation', { id: `${p.zone}/${p.name}` })}</Pill>}
      {row.elsewhere && <Pill tone="warn">{t('prog.state.elsewhere', { id: `${row.elsewhere.zone}/${row.elsewhere.name}` })}</Pill>}
      {!p && !row.elsewhere && <Pill plain>{t('prog.state.none')}</Pill>}
    </>
  );
};

/** What the catalogue says of a programme, under the form that creates its segregation or its cluster. */
export const ProgrammeCard = ({ row, name }: { row: ProgrammeRow; name?: string }) => {
  const { t } = useI18n();
  const rq = useRq();
  const facts: Array<[string, ReactNode]> = row.test
    ? [[t('prog.col.customer'), `${t('prog.testCustomer')} · ${t('prog.testDetail')}`]]
    : [
        [t('prog.col.customer'), [row.customer, row.customerDetail].filter(Boolean).join(' · ')],
        [t('prog.col.nations'), row.nations.join(', ') || '—'],
        [t('prog.col.body'), row.managingBody || '—'],
        [t('prog.col.prime'), row.primeContractor || '—'],
      ];
  return (
    <Box data-testid="programme-card" sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', p: 2, display: 'grid', gap: 1, bgcolor: rq.sheet }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h3">
          {row.test ? t('prog.pick.test').split(':')[0] : row.title}
        </Typography>
        <Pill tone={row.test ? 'warn' : 'info'} plain>
          {row.test ? t('prog.test') : row.industry}
        </Pill>
        <ProgrammeState row={row} />
      </Box>
      <Typography variant="body2">{row.test ? t('prog.testDesc') : row.description}</Typography>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: '10px 24px', m: 0, my: 0.5 }}>
        {facts.map(([k, v]) => (
          <Box key={k}>
            <Typography component="dt" variant="caption" color="text.secondary">
              {k}
            </Typography>
            <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
              {v}
            </Box>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t(row.test ? 'prog.fromTest' : 'prog.fromCatalogue')} {row.zone}/{name ?? row.name}
        {row.confidence === 'verify' && ` · ${t('prog.toVerify')}`} · <Link to={PROGRAMMES_PATH}>{t('prog.open')}</Link>
      </Typography>
    </Box>
  );
};
