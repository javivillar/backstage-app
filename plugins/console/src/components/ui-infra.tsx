import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import Typography from '@mui/material/Typography';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { type ReactNode, useState } from 'react';
import { useRq } from '../theme/consoleTheme';
import { type Tone, choose } from './ui';

/** Pieces shared by the Platform and Cluster pages: plain tables, state tones, a requested/used meter, an Actions menu. */

/** Argo CD health and sync as pill tones. */
export const healthTone = (h: string): Tone => choose<Tone>([[h === 'Healthy', 'pos'], [h === 'Progressing', 'info'], [h === 'Degraded' || h === 'Missing', 'neg']], 'warn');
export const syncTone = (s: string): Tone => (s === 'Synced' ? 'pos' : 'warn');

/** A plain table in the console style: 12 px muted headers, light rules, numbers aligned. */
export const Table = ({ head, children, label }: { head: Array<ReactNode | [ReactNode, 'r']>; children: ReactNode; label?: string }) => {
  const t = useRq();
  return (
    <Box component="table" aria-label={label} sx={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', '& td': { px: 1.5, py: 1.25, borderTop: `1px solid ${t.rule}`, verticalAlign: 'top', textAlign: 'left' }, '& td.r': { textAlign: 'right' }, '& tbody tr:hover td': { bgcolor: t.raised } }}>
      <thead>
        <tr>
          {head.map((h, i) => {
            const [label2, align] = Array.isArray(h) ? h : [h, undefined];
            return (
              <Box component="th" key={i} sx={{ px: 1.5, py: 1, fontSize: 12, fontWeight: 500, color: 'text.secondary', textAlign: align === 'r' ? 'right' : 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${t.border}` }}>
                {label2}
              </Box>
            );
          })}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </Box>
  );
};

/** Secondary line under a value in a cell. */
export const Sub = ({ children }: { children: ReactNode }) => (
  <Typography variant="caption" color="text.secondary" component="div">
    {children}
  </Typography>
);

/** Requested (bar) against a capacity, with the real use (marker) when it is known. */
export const UseMeter = ({ requested, capacity, used, label }: { requested: number; capacity: number; used?: number; label?: ReactNode }) => {
  const t = useRq();
  const r = capacity ? requested / capacity : 0;
  const colour = choose([[r > 0.9, t.negative], [r > 0.75, t.warning]], t.data);
  return (
    <Box sx={{ minWidth: 150 }}>
      <Box sx={{ position: 'relative', height: 6, borderRadius: 3, bgcolor: t.rule, overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(r, 1) * 100}%`, bgcolor: colour }} />
        {used !== undefined && <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${Math.min(used, 1) * 100}% - 1px)`, width: 2, bgcolor: t.ink }} />}
      </Box>
      {label && <Sub>{label}</Sub>}
    </Box>
  );
};

/** "Actions ▾": the dangerous or rare actions of a page, out of the way of the primary one. */
export const ActionsMenu = ({ label = 'Actions', children }: { label?: string; children: ReactNode }) => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button variant="outlined" aria-haspopup="menu" endIcon={<ExpandMore />} onClick={e => setEl(e.currentTarget)}>
        {label}
      </Button>
      <Menu anchorEl={el} open={!!el} onClose={() => setEl(null)} slotProps={{ paper: { sx: { p: 1.5, minWidth: 320, maxWidth: 520 } } }}>
        <Box onClick={e => e.stopPropagation()}>{children}</Box>
      </Menu>
    </>
  );
};
