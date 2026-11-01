import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useConsoleConfig } from '../config';
import { Badge } from './Badge';

/** Every cluster this portal knows: this one and the ones of console.clusters (their console opens in a frame). */
export const ClustersPage = () => {
  const cfg = useConsoleConfig();
  const rows = [
    { id: cfg.cluster.id, kind: cfg.cluster.kind, url: '', own: true },
    ...cfg.clusters.map(c => ({ ...c, own: false })),
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 980 }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
        Clusters
      </Typography>
      <Typography color="text.secondary">
        A zone cluster (e.g. nato) holds the infrastructure and the marketplace of its zone; a programme cluster (e.g.
        nato-sirtap) runs the applications of one programme. Each has its own portal.
      </Typography>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {rows.map(r => (
          <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
            <Link to={r.own ? '/console' : `/console/clusters/${encodeURIComponent(r.id)}`} style={{ fontWeight: 600 }}>
              {r.id}
            </Link>
            <Badge outlined label={r.kind === 'zone' ? 'zone cluster' : 'programme cluster'} />
            {r.own && <Badge label="this cluster" />}
            <Box sx={{ flex: 1 }} />
            {!r.own && (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {r.url}
              </Typography>
            )}
          </Box>
        ))}
      </Paper>
      {cfg.clusters.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No other cluster is configured (console.clusters).
        </Typography>
      )}
    </Box>
  );
};
