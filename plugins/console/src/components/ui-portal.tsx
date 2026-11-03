import Box from '@mui/material/Box';
import { useRq } from '../theme/consoleTheme';

/** Segmented filter with counts (one choice), the console's filter control. */
export function Seg<T extends string>({ items, value, onChange, label }: { items: Array<[T, string, number?]>; value: T; onChange: (v: T) => void; label: string }) {
  const t = useRq();
  return (
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px', p: '2px', bgcolor: t.raised, border: `1px solid ${t.border}`, borderRadius: '6px', maxWidth: '100%' }}>
      {items.map(([v, text, n]) => {
        const on = v === value;
        return (
          <Box
            key={v}
            component="button"
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            sx={{ border: 0, font: 'inherit', fontSize: 14, cursor: 'pointer', px: 1.5, py: 0.5, borderRadius: '4px', whiteSpace: 'nowrap', bgcolor: on ? t.sheet : 'transparent', color: on ? t.ink : t.muted, fontWeight: on ? 500 : 400, boxShadow: on ? `0 0 0 1px ${t.border}` : 'none' }}
          >
            {text}
            {n !== undefined && (
              <Box component="span" sx={{ ml: 0.75, color: t.muted, fontVariantNumeric: 'tabular-nums' }}>
                {n}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** HTTP method badge: one colour per verb, from the state tokens (GET info, POST pos, PUT/PATCH warn, DELETE neg). */
export const Method = ({ method }: { method: string }) => {
  const t = useRq();
  const m = method.toUpperCase();
  const c = ({ GET: t.info, POST: t.pos, PUT: t.warn, PATCH: t.warn, DELETE: t.neg } as Record<string, { bg: string; fg: string }>)[m] ?? t.neu;
  return (
    <Box component="span" sx={{ display: 'inline-block', minWidth: 58, textAlign: 'center', fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 12, fontWeight: 500, lineHeight: '20px', px: 0.75, borderRadius: '4px', bgcolor: c.bg, color: c.fg }}>
      {m}
    </Box>
  );
};
