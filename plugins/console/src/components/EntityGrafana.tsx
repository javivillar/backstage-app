import { useEntity } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import OpenInNew from '@mui/icons-material/OpenInNew';
import Refresh from '@mui/icons-material/Refresh';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useRq, MONO } from '../theme/consoleTheme';
import { Pill } from './ui';

/** Annotations the catalog writes on a deployment with the block monitoring (refresquito-services app-of-apps). */
export const GRAFANA_URL = 'refresquito.io/grafana-url';
export const GRAFANA_LOGS = 'refresquito.io/grafana-logs';
export const GRAFANA_PERFORMANCE = 'refresquito.io/grafana-performance';
export const GRAFANA_FOLDER = 'refresquito.io/grafana-folder';

export type GrafanaKind = 'logs' | 'performance';
export const RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;
export type Range = (typeof RANGES)[number];
/** Values of the variables `level` and `container` of the standard Logs dashboard (python-app-oneke). */
export const LEVELS = ['error', 'warning', 'info'] as const;
export const CONTAINERS = ['api', 'web'] as const;
const ALL = '$__all';

const uidOf = (entity: Entity, kind: GrafanaKind) =>
  entity.metadata.annotations?.[kind === 'logs' ? GRAFANA_LOGS : GRAFANA_PERFORMANCE];

/** Whether the entity has that dashboard (the tab shows only then). */
export const hasGrafanaDashboard = (kind: GrafanaKind) => (entity: Entity) =>
  Boolean(entity.metadata.annotations?.[GRAFANA_URL] && uidOf(entity, kind));

/** The URL of the dashboard: in kiosk mode without Grafana's bars for the frame, full for "Open in Grafana". */
export function grafanaUrl(
  base: string,
  uid: string,
  opts: { range: Range; theme?: 'light' | 'dark'; kiosk?: boolean; level?: string; container?: string; search?: string },
): string {
  const q = new URLSearchParams();
  q.set('from', `now-${opts.range}`);
  q.set('to', 'now');
  if (opts.theme) q.set('theme', opts.theme);
  if (opts.level !== undefined) q.set('var-level', opts.level || ALL);
  if (opts.container !== undefined) q.set('var-container', opts.container || ALL);
  if (opts.search) q.set('var-search', opts.search);
  // in the frame the console's own controls (range, level, container, search) replace Grafana's bars: kiosk hides its
  // navigation, and _dash.hide* (Grafana 11.3) its time picker, variables and dashboard links
  const kiosk = opts.kiosk ? 'kiosk&_dash.hideTimePicker&_dash.hideVariables&_dash.hideLinks&' : '';
  return `${base.replace(/\/+$/, '')}/d/${encodeURIComponent(uid)}?${kiosk}${q.toString()}`;
}

/** Entity tab (console only): the Grafana dashboard of this deployment, Logging or Performance, only its environment. */
export const EntityGrafanaContent = ({ kind }: { kind: GrafanaKind }) => {
  const { entity } = useEntity();
  const { t } = useI18n();
  const rq = useRq();
  const theme = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const [range, setRange] = useState<Range>('1h');
  const [level, setLevel] = useState('');
  const [container, setContainer] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [bump, setBump] = useState(0);
  const ann = entity.metadata.annotations ?? {};
  const base = ann[GRAFANA_URL];
  const uid = uidOf(entity, kind);
  if (!base || !uid) return <Typography color="text.secondary">{t('graf.none')}</Typography>;
  const logs = kind === 'logs';
  const vars = logs ? { level, container, search: applied } : {};
  const frame = grafanaUrl(base, uid, { range, theme, kiosk: true, ...vars });
  const full = grafanaUrl(base, uid, { range, ...vars });
  const stage = ann['refresquito.io/stage'] || 'pro';
  const small = { fontSize: 13 };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', color: 'text.secondary', ...small }} title={t('graf.fixed')}>
            <span>{t('graf.environment')}</span>
            <Pill tone={stage === 'pro' ? 'pos' : 'warn'} plain>{stage}</Pill>
            {ann[GRAFANA_FOLDER] && (
              <>
                <span>· {t('graf.folder')}</span>
                <Box component="span" sx={{ fontFamily: MONO, fontSize: 12.5, color: 'text.primary' }}>{ann[GRAFANA_FOLDER]}</Box>
              </>
            )}
          </Box>
          {logs && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField select size="small" label={t('graf.level')} value={level} onChange={e => setLevel(e.target.value)} sx={{ minWidth: 130 }}>
                <MenuItem value="">{t('graf.allLevels')}</MenuItem>
                {LEVELS.map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={t('graf.container')} value={container} onChange={e => setContainer(e.target.value)} sx={{ minWidth: 140 }}>
                <MenuItem value="">{t('graf.allContainers')}</MenuItem>
                {CONTAINERS.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
              <TextField
                size="small"
                type="search"
                label={t('graf.search')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setApplied(search); }}
                onBlur={() => setApplied(search)}
                sx={{ width: 220 }}
              />
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <ToggleButtonGroup size="small" exclusive value={range} onChange={(_, v) => v && setRange(v)} aria-label={t('graf.range')}>
            {RANGES.map(r => <ToggleButton key={r} value={r} sx={{ px: 1.25, py: 0.25, textTransform: 'none' }}>{r}</ToggleButton>)}
          </ToggleButtonGroup>
          <Button size="small" variant="outlined" startIcon={<Refresh fontSize="small" />} onClick={() => setBump(b => b + 1)}>{t('graf.refresh')}</Button>
          <Button size="small" variant="outlined" href={full} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>{t('graf.open')}</Button>
        </Box>
      </Box>
      <Box
        key={bump}
        component="iframe"
        title={`${entity.metadata.name} ${kind}`}
        src={frame}
        sx={{ width: '100%', height: 'calc(100vh - 280px)', minHeight: 560, border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.raised }}
      />
      <Typography variant="caption" color="text.secondary">{t('graf.hint', { app: ann['refresquito.io/application'] || entity.metadata.name })}</Typography>
    </Box>
  );
};

export const EntityLoggingContent = () => <EntityGrafanaContent kind="logs" />;
export const EntityPerformanceContent = () => <EntityGrafanaContent kind="performance" />;
