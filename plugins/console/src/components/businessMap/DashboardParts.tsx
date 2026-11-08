import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import type { Level } from './heatmapModel';

/** The pieces the three dashboards share: the customer picker, the lens buttons, the legend and their colours. */

/** heat scale of the mock-up: the levels differ in lightness, not only in hue; text keeps 4.5:1 on each */
const HEAT = {
  light: { 0: ['#d7f0df', '#0b2e17'], 1: ['#fbe6b0', '#3a2600'], 2: ['#f1a466', '#2b1200'], 3: ['#9e2530', '#ffffff'], none: ['#eef1f4', '#3d4651'] },
  dark: { 0: ['#1d4a2e', '#d9f7e4'], 1: ['#6b5216', '#fff3d6'], 2: ['#b8682a', '#1f0c00'], 3: ['#ff9a96', '#2a0508'], none: ['#232b34', '#b9c2cc'] },
} as const;

/** the background and text colour of a heat level in the current theme */
export function useHeat(): (level: Level) => { bg: string; fg: string } {
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  return level => {
    const [bg, fg] = HEAT[mode][level];
    return { bg, fg };
  };
}

/** the dot colours of the glass: state (ok / warn / bad / none) and criticality (critical / important / standard) */
const DOTS = {
  light: { ok: '#2f8f5b', warn: '#c98a1b', bad: '#b3242f', none: '#c3cad2', critical: '#7a1d27', important: '#e3a24a', standard: '#aab4bf' },
  dark: { ok: '#4cc488', warn: '#f0b35a', bad: '#ff7a70', none: '#4a5562', critical: '#ff9c9c', important: '#d79a46', standard: '#6c7784' },
} as const;
export type Dot = keyof (typeof DOTS)['light'];
export function useDots(): Record<Dot, string> {
  return DOTS[useTheme().palette.mode === 'dark' ? 'dark' : 'light'];
}

/** The customer (namespace) of the map: a select when there is more than one. */
export const NamespacePicker = ({ namespaces, value, onChange }: { namespaces: string[]; value?: string; onChange: (ns: string) => void }) => {
  const { t } = useI18n();
  if (namespaces.length < 2) return null;
  return (
    <TextField select size="small" label={t('bmd.customer')} value={value ?? ''} onChange={e => onChange(e.target.value)} sx={{ minWidth: 220 }}>
      <MenuItem value="">{t('bmd.allCustomers')}</MenuItem>
      {namespaces.map(ns => (
        <MenuItem key={ns} value={ns}>
          {ns}
        </MenuItem>
      ))}
    </TextField>
  );
};

/** One choice of several (the lens): a group of toggle buttons. */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Array<[T, string]>; value: T; onChange: (v: T) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        {label}
      </Box>
      <Box role="group" aria-label={label} sx={{ display: 'inline-flex', flexWrap: 'wrap', border: 1, borderColor: 'divider', borderRadius: '8px', overflow: 'hidden' }}>
        {options.map(([k, text], i) => (
          <Button
            key={k}
            size="small"
            aria-pressed={value === k}
            onClick={() => onChange(k)}
            sx={{ borderRadius: 0, minHeight: 34, px: 1.5, color: 'text.primary', fontWeight: value === k ? 600 : 400, bgcolor: value === k ? 'action.selected' : 'transparent', borderLeft: i ? 1 : 0, borderColor: 'divider' }}
          >
            {text}
          </Button>
        ))}
      </Box>
    </Box>
  );
}

/** A legend: swatches with their meaning. */
export const Legend = ({ items, note }: { items: Array<{ bg: string; fg?: string; text: string; round?: boolean }>; note?: ReactNode }) => (
  <Box aria-label="Legend" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', fontSize: 12 }}>
    {items.map(x =>
      x.round ? (
        <Box key={x.text} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
          <Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: x.bg }} />
          {x.text}
        </Box>
      ) : (
        <Box key={x.text} component="span" sx={{ px: 1, py: 0.25, borderRadius: '6px', fontWeight: 500, bgcolor: x.bg, color: x.fg }}>
          {x.text}
        </Box>
      ),
    )}
    {note && (
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {note}
      </Box>
    )}
  </Box>
);

/** the console page of an entity ref (businessprocess:ns/name → /console/entity/ns/businessprocess/name) */
export function entityPathOf(ref: string): string {
  const m = /^([^:]+):([^/]+)\/(.+)$/.exec(ref);
  return m ? `/console/entity/${m[2]}/${m[1].toLowerCase()}/${m[3]}` : '/console/business-map';
}
