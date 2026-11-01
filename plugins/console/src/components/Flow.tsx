import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Fragment } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'off';
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: '#E3F4E8', fg: '#1E6B34' },
  warn: { bg: '#FFF0DD', fg: '#8A4300' },
  bad: { bg: '#FDECEA', fg: '#B3261E' },
  info: { bg: '#E5F0FC', fg: '#0B5CAD' },
  off: { bg: '#EEF1F4', fg: '#5A6878' },
};

export type FlowNode = {
  title: string;
  sub?: string;
  /** label of the state badge */
  state?: string;
  tone?: Tone;
  /** dashed: blocked by a policy, or outside what this cluster can see */
  dashed?: boolean;
  href?: string;
};
export type FlowLane = { label: string; nodes: FlowNode[]; grow?: number };

const Node = ({ n }: { n: FlowNode }) => {
  const t = TONES[n.tone ?? 'off'];
  const strong = n.tone === 'bad' || n.tone === 'warn';
  const title = n.href ? (
    <a href={n.href} style={{ color: 'inherit' }}>
      {n.title}
    </a>
  ) : (
    n.title
  );
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: '10px 12px',
        borderRadius: '10px',
        bgcolor: strong ? t.bg : 'background.paper',
        border: `1px ${n.dashed ? 'dashed' : 'solid'}`,
        borderColor: strong ? t.fg : 'divider',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: t.fg }} />
        <Typography component="span" sx={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
      </Box>
      {n.sub && (
        <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', overflowWrap: 'anywhere' }}>
          {n.sub}
        </Typography>
      )}
      {n.state && (
        <Box
          component="span"
          sx={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, px: 1, borderRadius: 999, bgcolor: t.bg, color: t.fg, whiteSpace: 'nowrap' }}
        >
          {n.state}
        </Box>
      )}
    </Box>
  );
};

const Arrow = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7A8796" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, alignSelf: 'center' }}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

/** Lanes of nodes joined by arrows, coloured by state; wraps to the next line on narrow screens. */
export const Flow = ({ lanes, label }: { lanes: FlowLane[]; label: string }) => (
  <Box role="group" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 1 }}>
    {lanes.map((l, i) => (
      <Box key={`${l.label}-${i}`} sx={{ display: 'flex', alignItems: 'stretch', gap: 1, flex: `${l.grow ?? 1} 1 ${i ? 168 : 140}px`, minWidth: 0 }}>
        {i > 0 && <Arrow />}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography component="span" sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {l.label}
          </Typography>
          {l.nodes.map((n, j) => (
            <Fragment key={`${n.title}-${j}`}>
              <Node n={n} />
            </Fragment>
          ))}
        </Box>
      </Box>
    ))}
  </Box>
);
