import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusinessMap } from '../../businessMap';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { Id, TitleRow } from '../ui';
import { BusinessMapTabs, useCustomer } from './BusinessMapTabs';
import { pageOf, PAGE_SIZES } from './businessMapFormsModel';
import { consolePath, CRITICALITIES } from './businessMapModel';
import { NamespacePicker } from './DashboardParts';
import {
  explorerCsv,
  type ExplorerFilter,
  explorerRows,
  filtering,
  filterOptions,
  filterRows,
  NO_EXPLORER_FILTER,
  openAll,
  openFor,
  openToLevel,
  visibleRows,
} from './explorerModel';
import { CritPill, ResultPill } from './parts';

const RESULTS = ['meets', 'gap', 'unknown'] as const;

/**
 * Business continuity › Explorer: the whole model of a customer as a tree-table (level-1 domains → subdomains →
 * processes → sub-processes), searchable (each match with its ancestors) and filtered by level, level-1 domain,
 * criticality, check and owner; open to level 3 or all, in pages, and as a CSV of the rows of the filters.
 */
export const BusinessExplorerPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const [ns, setNs] = useCustomer();
  const map = useBusinessMap(ns);
  const rows = useMemo(() => (map.data ? explorerRows(map.data) : []), [map.data]);
  const options = useMemo(() => filterOptions(rows), [rows]);
  const [filter, setFilter] = useState<ExplorerFilter>(NO_EXPLORER_FILTER);
  const filtered = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  // a new customer opens to level 3; a search opens what leads to its matches
  useEffect(() => setOpen(openToLevel(rows, 3)), [rows]);
  useEffect(() => {
    if (filtering(filter)) setOpen(openFor(filtered));
  }, [filter, filtered]);
  const visible = useMemo(() => visibleRows(filtered, open), [filtered, open]);
  const shown = pageOf(visible, page, size);
  const refine = (f: Partial<ExplorerFilter>) => {
    setFilter(x => ({ ...x, ...f }));
    setPage(0);
  };
  const toggle = (key: string) =>
    setOpen(o => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([explorerCsv(filtered)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-model-${map.data?.namespace ?? 'customer'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('bmd.crumb'), '/console/business-map'], [t('bmx.title')]];
  const title = map.data?.namespace ? `${t('bmx.title')} · ${map.data.namespace}` : t('bmx.title');
  if (map.loading && !map.data) return <Progress />;
  if (!map.data) {
    return (
      <Box>
        <TitleRow crumbs={crumbs} title={title} />
        <BusinessMapTabs />
        <WarningPanel title={t('bmd.noMap')} message={map.error} />
      </Box>
    );
  }
  const matches = filtered.filter(r => r.match).length;
  return (
    <Box>
      <TitleRow
        crumbs={crumbs}
        title={title}
        sub={t('bmx.sub')}
        actions={<NamespacePicker namespaces={map.data.namespaces} value={map.data.namespace} onChange={setNs} />}
      />
      <BusinessMapTabs />
      <Box role="search" aria-label={t('bmx.filters')} sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.25, py: 1.5 }}>
        <TextField size="small" type="search" label={t('bmx.search')} value={filter.text} onChange={e => refine({ text: e.target.value })} sx={{ gridColumn: { md: 'span 2' } }} />
        <TextField select size="small" label={t('bmx.level')} value={filter.level} onChange={e => refine({ level: e.target.value })}>
          <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
          {options.levels.map(l => (
            <MenuItem key={l} value={String(l)}>
              {t('bmx.levelN', { n: l })}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label={t('bmf.filter.root')} value={filter.root} onChange={e => refine({ root: e.target.value })}>
          <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
          {options.roots.map(r => (
            <MenuItem key={r.key} value={r.key}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label={t('bmx.criticality')} value={filter.criticality} onChange={e => refine({ criticality: e.target.value as ExplorerFilter['criticality'] })}>
          <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
          {CRITICALITIES.map(c => (
            <MenuItem key={c} value={c}>
              {t(`bm.crit.${c}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label={t('bmx.check')} value={filter.result} onChange={e => refine({ result: e.target.value as ExplorerFilter['result'] })}>
          <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
          {RESULTS.map(r => (
            <MenuItem key={r} value={r}>
              {t(`bmx.result.${r}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label={t('bm.owner')} value={filter.owner} onChange={e => refine({ owner: e.target.value })} disabled={!options.owners.length}>
          <MenuItem value="">{t('bmf.filter.all')}</MenuItem>
          {options.owners.map(o => (
            <MenuItem key={o} value={o}>
              {o}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {filtering(filter) ? t('bmx.count.matches', { n: matches, total: rows.length }) : t('bmx.count.all', { total: rows.length })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" onClick={() => setOpen(openAll(filtered))}>
            {t('bmx.expandAll')}
          </Button>
          <Button size="small" variant="outlined" onClick={() => setOpen(openToLevel(filtered, 3))}>
            {t('bmx.collapse3')}
          </Button>
          <Button size="small" variant="outlined" onClick={exportCsv} disabled={!filtered.length}>
            {t('bmx.export')}
          </Button>
          {filtering(filter) && (
            <Button size="small" onClick={() => refine(NO_EXPLORER_FILTER)}>
              {t('bmx.clear')}
            </Button>
          )}
        </Box>
      </Box>
      {visible.length ? (
        <Box sx={{ overflowX: 'auto', border: `1px solid ${rq.border}`, borderRadius: '8px' }}>
          <Table size="small" aria-label={t('bmx.title')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('bmx.col.process')}</TableCell>
                <TableCell>{t('bmx.level')}</TableCell>
                <TableCell>{t('bmx.criticality')}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>RPO · RTO</TableCell>
                <TableCell>{t('bmx.check')}</TableCell>
                <TableCell>{t('bmx.col.apps')}</TableCell>
                <TableCell>{t('bm.owner')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.rows.map(r => {
                const isOpen = open.has(r.key);
                const highlight = filtering(filter) && r.match;
                const apps = r.applications.length > 3 ? `${r.applications.slice(0, 3).join(', ')} +${r.applications.length - 3}` : r.applications.join(', ');
                return (
                  <TableRow key={r.key} sx={{ bgcolor: highlight ? rq.dataSoft : undefined }}>
                    <TableCell sx={{ minWidth: 320 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, pl: `${(r.level - 1) * 20}px` }}>
                        {r.children > 0 ? (
                          <IconButton size="small" onClick={() => toggle(r.key)} aria-expanded={isOpen} aria-label={isOpen ? t('bmx.collapse', { title: r.title }) : t('bmx.expand', { title: r.title })} sx={{ mt: -0.5 }}>
                            {isOpen ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
                          </IconButton>
                        ) : (
                          <Box component="span" sx={{ width: 34, flex: 'none' }} />
                        )}
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            {r.id && <Id>{r.id}</Id>}
                            <Link to={consolePath(r.key)} style={{ color: rq.ink, fontWeight: r.level < 3 ? 600 : 500 }}>
                              {r.title}
                            </Link>
                          </Box>
                          {r.description && (
                            <Typography variant="caption" color="text.secondary" component="div" title={r.description} sx={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: 560 }}>
                              {r.description}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{t(`bmf.type.${r.type}`)} · {r.level}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {r.criticality && <CritPill value={r.criticality} />}
                      {r.criticalityInherited && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('bmx.inherited')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.rpo || r.rto ? `${r.rpo ?? '—'} · ${r.rto ?? '—'}` : ''}</TableCell>
                    <TableCell>{r.result && <ResultPill result={r.result} />}</TableCell>
                    <TableCell>
                      {apps}
                      {r.applicationsInherited && apps && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {t('bmx.inherited')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{r.owner}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={visible.length}
            page={shown.page}
            rowsPerPage={size}
            rowsPerPageOptions={PAGE_SIZES}
            onPageChange={(_e, n) => setPage(n)}
            onRowsPerPageChange={e => {
              setSize(Number(e.target.value));
              setPage(0);
            }}
            labelRowsPerPage={t('bmf.page.size')}
            labelDisplayedRows={({ from, to, count }) => t('bmf.page.shown', { from, to, count })}
          />
        </Box>
      ) : (
        <Typography color="text.secondary">{rows.length ? t('bmf.filter.none') : t('bmx.empty')}</Typography>
      )}
    </Box>
  );
};
