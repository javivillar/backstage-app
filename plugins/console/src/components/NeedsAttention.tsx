import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { needsAttention } from '../attention';
import { useClusterNetwork } from '../network';
import { useClusterOverview } from '../overview';
import { TONES } from './Flow';

const LABEL = { bad: 'Problem', warn: 'Warning', info: 'Notice' } as const;

/** The problems of this cluster in one list, worst first; each one links to the page that shows it. */
export const NeedsAttention = ({ limit = 8 }: { limit?: number }) => {
  const o = useClusterOverview();
  const n = useClusterNetwork();
  if (o.loading && n.loading) return null;
  const items = needsAttention(o.data, n.data);
  return (
    <Paper variant="outlined" component="section" aria-label="Needs attention" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'baseline' }}>
        <Typography variant="h6" component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
          Needs attention
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {items.length}
        </Typography>
      </Box>
      {items.length === 0 && (
        <Typography sx={{ p: 2 }} color="text.secondary">
          Nothing: nodes ready, applications healthy, certificate and volumes fine.
        </Typography>
      )}
      {items.slice(0, limit).map((a, i) => {
        const t = TONES[a.severity];
        return (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
            <Box component="span" sx={{ fontSize: 12, fontWeight: 600, px: 1, borderRadius: 999, bgcolor: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
              {LABEL[a.severity]}
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Link to={a.to} style={{ fontWeight: 600 }}>
                {a.title}
              </Link>
              {a.detail && (
                <Typography variant="body2" color="text.secondary">
                  {a.detail}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
      {items.length > limit && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
          and {items.length - limit} more
        </Typography>
      )}
    </Paper>
  );
};
