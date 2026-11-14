import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../i18n';
import { matches, type ProgrammeRow, programmeRows, rowTexts } from '../programmes';
import { useRq } from '../theme/consoleTheme';
import { InfraFrame } from './InfraPages';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ProgrammeState } from './ProgrammeParts';
import { EmptyState, Id, Kpis, Pill, type Tone } from './ui';

const MARKET = '/console/infrastructure/marketplace';
const ALL = 'all';
const TEST = 'test';

/** Platform › Programmes: the programme catalogue of the host with what this platform has of each programme. */
export const ProgrammesPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const [zone, setZone] = useState(ALL);
  const [industry, setIndustry] = useState(ALL);
  // typed text matches anywhere; a value clicked in the table matches as a whole word
  const [search, setSearch] = useState({ text: '', whole: false });
  const find = (text: string) => {
    setZone(ALL);
    setIndustry(ALL);
    setSearch({ text, whole: true });
  };
  /** A value of the table: click it to search by it, in any column. */
  const value = (text: string | undefined, pill?: Tone): ReactNode => {
    if (!text) return '—';
    return (
      <Box
        component="button"
        type="button"
        key={text}
        title={t('prog.searchFor', { value: text })}
        onClick={() => find(text)}
        sx={{ all: 'unset', cursor: 'pointer', overflowWrap: 'anywhere', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2, borderRadius: '4px' } }}
      >
        {pill ? (
          <Pill tone={pill} plain>
            {text}
          </Pill>
        ) : (
          text
        )}
      </Box>
    );
  };
  return (
    <InfraFrame
      title={t('nav.programmes')}
      crumb={t('nav.programmes')}
      sub={t('prog.sub')}
      actions={
        <Button variant="outlined" component={Link as any} to={MARKET}>
          {t('ic.createInMarket')}
        </Button>
      }
    >
      {view => {
        const catalog = view.catalog ?? [];
        const label = (z: string) => catalog.find(c => c.name === z)?.label ?? z;
        const rows = programmeRows(view);
        const listed = rows.filter(r => !r.test);
        const tests = rows.length - listed.length;
        if (!view.programmeCatalogue) {
          return (
            <Card title={t('prog.title')}>
              <EmptyState title={t('prog.none')}>{t('prog.noneWhy')}</EmptyState>
            </Card>
          );
        }
        const industries = view.programmeCatalogue.industries;
        const texts = (r: ProgrammeRow) => [
          ...rowTexts(r, label(r.zone)),
          ...(r.test ? [t('prog.test'), t('prog.testCustomer')] : [t(r.spain ? 'prog.yes' : 'prog.no'), t(`prog.confidence.${r.confidence}`)]),
        ];
        const shown = rows.filter(r => (zone === ALL || r.zone === zone) && (industry === ALL || (industry === TEST ? r.test : r.industry === industry)) && matches(texts(r), search.text, search.whole));
        const own = listed.filter(r => r.placed).length;
        const other = listed.filter(r => !r.placed && r.elsewhere).length;
        const to = (r: ProgrammeRow) => `${MARKET}?${r.placed ? 'tab=clusters&' : ''}zone=${encodeURIComponent(r.zone)}&programme=${encodeURIComponent(r.name)}`;
        return (
          <>
            <Kpis
              items={[
                { label: t('prog.kpi.catalogue'), value: listed.length, note: t('prog.kpi.zones', { n: catalog.length }) },
                { label: t('prog.kpi.industries'), value: industries.length, note: industries.join(' · ') },
                { label: t('prog.kpi.created'), value: own + other + tests, note: t('prog.kpi.createdNote', { own, other, test: tests }) },
              ]}
            />
            <Card title={t('prog.title')} sub={t('prog.tableSub')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                {[ALL, ...catalog.map(c => c.name)].map(z => {
                  const on = zone === z;
                  return (
                    <Box
                      component="button"
                      type="button"
                      key={z}
                      aria-pressed={on}
                      onClick={() => setZone(z)}
                      sx={{ all: 'unset', cursor: 'pointer', height: 24, px: 1.25, borderRadius: 999, fontSize: 12, fontWeight: 500, lineHeight: '24px', whiteSpace: 'nowrap', bgcolor: on ? rq.data : rq.info.bg, color: on ? rq.sheet : rq.info.fg, '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 } }}
                    >
                      {z === ALL ? t('prog.allZones') : `${label(z)} · ${rows.filter(r => r.zone === z).length}`}
                    </Box>
                  );
                })}
                <TextField select size="small" aria-label={t('prog.col.industry')} value={industry} onChange={e => setIndustry(e.target.value)} sx={{ minWidth: 200 }} SelectProps={{ inputProps: { 'aria-label': t('prog.col.industry') } }}>
                  <MenuItem value={ALL}>{t('prog.allIndustries')}</MenuItem>
                  {industries.map(i => (
                    <MenuItem key={i} value={i}>
                      {i}
                    </MenuItem>
                  ))}
                  {tests > 0 && <MenuItem value={TEST}>{t('prog.test')}</MenuItem>}
                </TextField>
                <TextField
                  size="small"
                  type="search"
                  placeholder={t('prog.search')}
                  value={search.text}
                  onChange={e => setSearch({ text: e.target.value, whole: false })}
                  inputProps={{ 'aria-label': t('prog.searchLabel') }}
                  sx={{ flex: '1 1 280px', maxWidth: 420 }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" role="status">
                {t('prog.count', { shown: shown.length, all: rows.length, catalogue: listed.length, test: tests })}
              </Typography>
              {shown.length === 0 ? (
                <EmptyState title={t('prog.empty')} />
              ) : (
                <Table
                  head={[t('prog.col.programme'), t('shell.zone'), t('prog.col.industry'), t('prog.col.customer'), t('prog.col.nations'), t('prog.col.body'), t('prog.col.prime'), t('prog.col.spain'), t('prog.col.confidence'), t('prog.col.platform')]}
                  rows={shown.map(r => [
                    <Box key="p" sx={{ minWidth: 240, maxWidth: 360, display: 'grid', gap: 0.25 }}>
                      <Box sx={{ fontWeight: 600 }}>{r.title}</Box>
                      <Id>{`${r.zone}/${r.name}`}</Id>
                      <Typography variant="caption" color="text.secondary">
                        {r.test ? t('prog.testDesc') : r.description}
                      </Typography>
                    </Box>,
                    value(label(r.zone), 'neu'),
                    value(r.test ? t('prog.test') : r.industry, r.test ? 'warn' : 'info'),
                    <Box key="c" sx={{ minWidth: 180 }}>
                      {value(r.test ? t('prog.testCustomer') : r.customer)}
                      <Typography variant="caption" color="text.secondary" component="div">
                        {r.test ? t('prog.testDetail') : r.customerDetail}
                      </Typography>
                    </Box>,
                    <Box key="n" sx={{ minWidth: 100 }}>
                      {r.nations.length === 0 && '—'}
                      {r.nations.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          {value(n)}
                        </span>
                      ))}
                    </Box>,
                    <Box key="b" sx={{ minWidth: 140 }}>{value(r.test ? t('prog.testCustomer') : r.managingBody)}</Box>,
                    <Box key="pc" sx={{ minWidth: 150 }}>{value(r.primeContractor)}</Box>,
                    r.test ? '—' : value(t(r.spain ? 'prog.yes' : 'prog.no'), r.spain ? 'pos' : 'neu'),
                    r.test ? '—' : value(t(`prog.confidence.${r.confidence}`), r.confidence === 'verify' ? 'warn' : 'neu'),
                    <Box key="s" sx={{ minWidth: 170, display: 'grid', gap: 0.75, justifyItems: 'start' }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                        <ProgrammeState row={r} />
                      </Box>
                      {!r.placed?.cluster && <Link to={to(r)}>{t(r.placed ? 'prog.createCluster' : 'prog.create')}</Link>}
                    </Box>,
                  ])}
                />
              )}
            </Card>
          </>
        );
      }}
    </InfraFrame>
  );
};
