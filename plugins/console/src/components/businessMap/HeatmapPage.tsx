import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { EmptyState, Pill, TitleRow } from '../ui';
import { BusinessMapTabs } from './BusinessMapTabs';
import { entityPathOf, Legend, NamespacePicker, Segmented, useHeat } from './DashboardParts';
import { useBusinessData, useHeatSources, useNamespaceParam } from './dashboardData';
import { heatTree, type Lens, LENSES, type Tile, tileOf, worstTile } from './heatmapModel';

/** the legend of each lens: [level, message key] */
const LEGEND: Record<Lens, Array<[0 | 1 | 2 | 3 | 'none', string]>> = {
  continuity: [[0, 'bmd.lg.meets'], [2, 'bmd.lg.rtoGap'], [3, 'bmd.lg.rpoGap'], ['none', 'bmd.lg.noCheck']],
  health: [[0, 'bmd.lg.healthy'], [1, 'bmd.lg.degraded'], [3, 'bmd.lg.down'], ['none', 'bmd.lg.noApp']],
  incidents: [[0, 'bmd.lg.inc0'], [1, 'bmd.lg.inc1'], [2, 'bmd.lg.inc2'], [3, 'bmd.lg.inc3']],
  vulns: [[0, 'bmd.lg.vul0'], [1, 'bmd.lg.vul1'], [2, 'bmd.lg.vul2'], [3, 'bmd.lg.vul3']],
  cost: [[0, 'bmd.lg.cost0'], [1, 'bmd.lg.cost1'], [2, 'bmd.lg.cost2'], [3, 'bmd.lg.cost3']],
  readiness: [[0, 'bmd.lg.ready0'], [1, 'bmd.lg.ready1'], [2, 'bmd.lg.ready2'], [3, 'bmd.lg.ready3']],
  framework: [[0, 'bmd.lg.fwOk'], [2, 'bmd.lg.fwEnding'], [3, 'bmd.lg.fwBad'], ['none', 'bmd.lg.noApp']],
};
/** the source of each lens, for the error line */
const SOURCE: Partial<Record<Lens, 'health' | 'incidents' | 'vulns' | 'cost'>> = { health: 'health', incidents: 'incidents', vulns: 'vulns', cost: 'cost' };

/**
 * Business map › Heat map: every process of a customer as a tile, grouped by domain and subdomain, coloured by one
 * lens at a time (a domain shows its worst process); the side panel shows the picked process under every lens.
 */
export const BusinessHeatmapPage = () => {
  const { t } = useI18n();
  const heat = useHeat();
  const [namespace, setNamespace] = useNamespaceParam();
  const data = useBusinessData(namespace);
  const heatData = useHeatSources(data);
  const [lens, setLens] = useState<Lens>('continuity');
  const [picked, setPicked] = useState<string | undefined>();
  const tree = useMemo(() => (data.map ? heatTree(data.map) : []), [data.map]);
  const { graph } = data;
  const { sources, money } = heatData;

  const text = (tile: Tile) => {
    const vars = { ...tile.vars, ...(tile.key === 'bmd.v.cost' ? { total: money(Number(tile.vars?.total ?? 0)) } : {}) };
    const main = t(tile.key, vars);
    return tile.parts?.length ? `${main} · ${tile.parts.map(k => t(k)).join(', ')}` : main;
  };

  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('bmd.crumb'), '/console/business-map'], [t('bmd.heat.title')]];
  const title = namespace ? `${t('bmd.heat.title')} · ${namespace}` : t('bmd.heat.title');
  if (data.loading) return <Progress />;
  if (!data.map || !graph) {
    return (
      <Box>
        <TitleRow crumbs={crumbs} title={title} />
        <BusinessMapTabs />
        <WarningPanel title={t('bmd.noMap')} message={data.error} />
      </Box>
    );
  }
  const first = tree[0]?.processes[0];
  const sel = picked && graph.processes.has(picked) ? picked : first;
  const selProcess = sel ? graph.processes.get(sel) : undefined;
  const sourceError = SOURCE[lens] ? heatData.errors[SOURCE[lens]!] : undefined;

  return (
    <Box>
      <TitleRow crumbs={crumbs} title={title} sub={t('bmd.heat.sub')} actions={<NamespacePicker namespaces={data.map.namespaces} value={namespace} onChange={setNamespace} />} />
      <BusinessMapTabs />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center', justifyContent: 'space-between', py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Segmented label={t('bmd.lens')} options={LENSES.map(k => [k, t(`bmd.lens.${k}`)])} value={lens} onChange={setLens} />
        <Legend items={LEGEND[lens].map(([level, key]) => ({ ...heat(level), text: t(key) }))} />
      </Box>
      {sourceError && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('bmd.sourceDown', { why: sourceError })}
        </Typography>
      )}
      {!tree.length ? (
        <EmptyState title={t('bmd.noProcesses')}>{t('bmd.noProcesses.hint')}</EmptyState>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Box sx={{ flex: '999 1 640px', minWidth: 0, py: 2, pr: { md: 2 }, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 1.75, alignItems: 'start' }}>
            {tree.map(d => {
              const worst = worstTile(d.processes.map(p => tileOf(lens, graph, p, sources)));
              const wc = heat(worst.level);
              return (
                <Box component="section" key={d.ref || 'none'} aria-label={d.title || t('bmd.noDomain')} sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.25, bgcolor: 'action.hover', display: 'grid', gap: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, px: 0.5 }}>
                    <Box component="b" sx={{ fontSize: 15 }}>
                      {d.title || t('bmd.noDomain')}
                    </Box>
                    <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: '6px', fontSize: 12, fontWeight: 500, bgcolor: wc.bg, color: wc.fg }}>
                      {t('bmd.worst', { v: text(worst) })}
                    </Box>
                  </Box>
                  {d.groups.map(gr => (
                    <Box key={gr.ref || 'none'}>
                      <Box sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', px: 0.5, pb: 0.5 }}>{gr.title || t('bmd.noDomain')}</Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75 }}>
                        {gr.processes.map(ref => {
                          const p = graph.processes.get(ref)!;
                          const tile = tileOf(lens, graph, ref, sources);
                          const c = heat(tile.level);
                          const on = ref === sel;
                          return (
                            <Box
                              key={ref}
                              component="button"
                              type="button"
                              aria-pressed={on}
                              aria-label={`${p.title}: ${text(tile)}`}
                              onClick={() => setPicked(ref)}
                              sx={{
                                all: 'unset',
                                boxSizing: 'border-box',
                                cursor: 'pointer',
                                borderRadius: '8px',
                                p: 1.25,
                                minHeight: 76,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                gap: 0.75,
                                bgcolor: c.bg,
                                color: c.fg,
                                border: tile.level === 'none' ? '1px dashed' : 0,
                                borderColor: 'divider',
                                outline: on ? '3px solid' : 'none',
                                outlineColor: 'secondary.main',
                                outlineOffset: 2,
                                '&:focus-visible': { outline: '3px solid', outlineColor: 'secondary.main' },
                              }}
                            >
                              <Box component="span" sx={{ fontWeight: 600, fontSize: 13, lineHeight: '17px' }}>
                                {p.title}
                              </Box>
                              <Box component="span" sx={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                                {text(tile)}
                              </Box>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
          {selProcess && sel && (
            <Box component="aside" aria-label={t('bmd.selected')} sx={{ flex: '1 0 300px', maxWidth: { md: 380 }, boxSizing: 'border-box', py: 2, pl: { md: 2.5 }, borderLeft: { md: 1 }, borderColor: 'divider', display: 'grid', gap: 1.5, alignContent: 'start' }}>
              <Box>
                <Box sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
                  {selProcess.pcfId ? `PCF ${selProcess.pcfId} · ` : ''}
                  {t(`bmd.crit.${selProcess.criticality}`)}
                </Box>
                <Typography variant="h6" component="h2">
                  {selProcess.title}
                </Typography>
              </Box>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, '& td': { py: 0.75, px: 0.5, borderBottom: 1, borderColor: 'divider' } }}>
                <tbody>
                  {LENSES.map(k => {
                    const tile = tileOf(k, graph, sel, sources);
                    const c = heat(tile.level);
                    return (
                      <Box component="tr" key={k} sx={{ fontWeight: k === lens ? 600 : 400 }}>
                        <td>{t(`bmd.lens.${k}`)}</td>
                        <td>
                          <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: '6px', bgcolor: c.bg, color: c.fg, display: 'inline-block' }}>
                            {text(tile)}
                          </Box>
                        </td>
                      </Box>
                    );
                  })}
                </tbody>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t(`bmd.note.${lens}`)}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button component={Link} to={entityPathOf(sel)} variant="outlined" size="small">
                  {t('bmd.openProcess')}
                </Button>
                <Button component={Link} to={`/console/business-map/glass?${new URLSearchParams({ ...(namespace ? { namespace } : {}), node: sel }).toString()}`} variant="outlined" size="small">
                  {t('bmd.inGlass')}
                </Button>
              </Box>
              {heatData.loading && <Pill tone="info">{t('bmd.reading')}</Pill>}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
