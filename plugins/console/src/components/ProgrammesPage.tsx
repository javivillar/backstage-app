import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../i18n';
import { matches, type ProgrammeRow, programmeRows, rowTexts } from '../programmes';
import { useRq } from '../theme/consoleTheme';
import { pageOf } from './businessMap/businessMapFormsModel';
import { InfraFrame } from './InfraPages';
import { Card } from './NamespaceSections';
import { ProgrammeState } from './ProgrammeParts';
import { EmptyState, Id, Kpis, Pill, type Tone } from './ui';

const MARKET = '/console/infrastructure/marketplace';
const ALL = 'all';
const TEST = 'test';
/** programmes on a page: few by default, so the catalogue is read a screen at a time */
const PAGE_SIZES = [10, 25, 50];
/** the width of each column: the table always fits its card, a long text wraps inside its cell */
const WIDTHS: Array<[string, string]> = [['programme', '27%'], ['zone', '12%'], ['customer', '17%'], ['nations', '9%'], ['body', '15%'], ['spain', '9%'], ['platform', '11%']];

/** Platform › Programmes: the programme catalogue of the host with what this platform has of each programme. */
export const ProgrammesPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const [zone, setZone] = useState(ALL);
  const [industry, setIndustry] = useState(ALL);
  // typed text matches anywhere; a value clicked in the table matches as a whole word
  const [search, setSearch] = useState({ text: '', whole: false });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  // a new filter starts again at the first page
  const pickZone = (z: string) => {
    setZone(z);
    setPage(0);
  };
  const find = (text: string) => {
    setZone(ALL);
    setIndustry(ALL);
    setSearch({ text, whole: true });
    setPage(0);
  };
  const caption = (text: string | undefined) =>
    text ? (
      <Typography variant="caption" color="text.secondary" component="div">
        {text}
      </Typography>
    ) : null;
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
        const paged = pageOf(shown, page, size);
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
                      onClick={() => pickZone(z)}
                      sx={{ all: 'unset', cursor: 'pointer', height: 24, px: 1.25, borderRadius: 999, fontSize: 12, fontWeight: 500, lineHeight: '24px', whiteSpace: 'nowrap', bgcolor: on ? rq.data : rq.info.bg, color: on ? rq.sheet : rq.info.fg, '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 } }}
                    >
                      {z === ALL ? t('prog.allZones') : `${label(z)} · ${rows.filter(r => r.zone === z).length}`}
                    </Box>
                  );
                })}
                <TextField select size="small" aria-label={t('prog.col.industry')} value={industry} onChange={e => { setIndustry(e.target.value); setPage(0); }} sx={{ minWidth: 200 }} SelectProps={{ inputProps: { 'aria-label': t('prog.col.industry') } }}>
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
                  onChange={e => { setSearch({ text: e.target.value, whole: false }); setPage(0); }}
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
                <>
                  <Box
                    component="table"
                    sx={{
                      width: '100%',
                      tableLayout: 'fixed',
                      borderCollapse: 'collapse',
                      fontVariantNumeric: 'tabular-nums',
                      '& th, & td': { px: 1.25, py: 1.25, textAlign: 'left', verticalAlign: 'top', overflowWrap: 'anywhere' },
                      '& th': { py: 1, fontWeight: 500, fontSize: 12, lineHeight: '16px', color: 'text.secondary', borderBottom: `1px solid ${rq.border}` },
                      '& tbody tr + tr td': { borderTop: `1px solid ${rq.rule}` },
                      '& tbody tr:hover td': { bgcolor: rq.raised },
                      // a narrow screen: each programme a block, its values one under another
                      '@media (max-width: 899.95px)': {
                        display: 'block',
                        '& thead, & colgroup': { display: 'none' },
                        '& tbody, & tr, & td': { display: 'block' },
                        '& td': { py: 0.5, px: 0 },
                        '& tbody tr + tr td': { borderTop: 0 },
                        '& tbody tr': { py: 1.25 },
                        '& tbody tr + tr': { borderTop: `1px solid ${rq.rule}` },
                      },
                    }}
                  >
                    <colgroup>
                      {WIDTHS.map(([column, width]) => (
                        <col key={column} style={{ width }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {[
                          t('prog.col.programme'),
                          `${t('shell.zone')} · ${t('prog.col.industry')}`,
                          t('prog.col.customer'),
                          t('prog.col.nations'),
                          `${t('prog.col.body')} · ${t('prog.col.prime')}`,
                          `${t('prog.col.spain')} · ${t('prog.col.confidence')}`,
                          t('prog.col.platform'),
                        ].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paged.rows.map(r => (
                        <tr key={`${r.zone}/${r.name}`}>
                          <td>
                            <Box sx={{ display: 'grid', gap: 0.25 }}>
                              <Box sx={{ fontWeight: 600 }}>{r.title}</Box>
                              <Id>{`${r.zone}/${r.name}`}</Id>
                              {caption(r.test ? t('prog.testDesc') : r.description)}
                            </Box>
                          </td>
                          <td>
                            <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
                              {value(label(r.zone), 'neu')}
                              {value(r.test ? t('prog.test') : r.industry, r.test ? 'warn' : 'info')}
                            </Box>
                          </td>
                          <td>
                            {value(r.test ? t('prog.testCustomer') : r.customer)}
                            {caption(r.test ? t('prog.testDetail') : r.customerDetail)}
                          </td>
                          <td>
                            {r.nations.length === 0 && '—'}
                            {r.nations.map((n, i) => (
                              <span key={n}>
                                {i > 0 && ', '}
                                {value(n)}
                              </span>
                            ))}
                          </td>
                          <td>
                            <Box sx={{ display: 'grid', gap: 0.75 }}>
                              <Box>
                                {caption(t('prog.col.body'))}
                                {value(r.test ? t('prog.testCustomer') : r.managingBody)}
                              </Box>
                              <Box>
                                {caption(t('prog.col.prime'))}
                                {value(r.primeContractor)}
                              </Box>
                            </Box>
                          </td>
                          <td>
                            {r.test ? (
                              '—'
                            ) : (
                              <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
                                {value(t(r.spain ? 'prog.yes' : 'prog.no'), r.spain ? 'pos' : 'neu')}
                                {value(t(`prog.confidence.${r.confidence}`), r.confidence === 'verify' ? 'warn' : 'neu')}
                              </Box>
                            )}
                          </td>
                          <td>
                            <Box sx={{ display: 'grid', gap: 0.75, justifyItems: 'start' }}>
                              {/* a long state ("Segregation occar/a400m · no cluster") wraps inside its column */}
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, minWidth: 0, '& > span': { whiteSpace: 'normal', height: 'auto', lineHeight: '16px', py: '3px', borderRadius: '11px' } }}>
                                <ProgrammeState row={r} />
                              </Box>
                              {!r.placed?.cluster && <Link to={to(r)}>{t(r.placed ? 'prog.createCluster' : 'prog.create')}</Link>}
                            </Box>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Box>
                  {shown.length > PAGE_SIZES[0] && (
                    <TablePagination
                      component="div"
                      count={shown.length}
                      page={paged.page}
                      rowsPerPage={size}
                      rowsPerPageOptions={PAGE_SIZES}
                      onPageChange={(_e, n) => setPage(n)}
                      onRowsPerPageChange={e => {
                        setSize(Number(e.target.value));
                        setPage(0);
                      }}
                      labelRowsPerPage={t('prog.page.size')}
                      labelDisplayedRows={({ from, to: last, count }) => t('prog.page.shown', { from, to: last, count })}
                    />
                  )}
                </>
              )}
            </Card>
          </>
        );
      }}
    </InfraFrame>
  );
};
