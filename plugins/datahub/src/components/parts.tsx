import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { Score, Summary } from '../api';

export function ScoreBar({ score }: { score: Score }) {
  let color: 'success' | 'warning' | 'error' = 'error';
  if (score.governed) color = 'success';
  else if (score.score >= 50) color = 'warning';
  return (
    <Box sx={{ minWidth: 120 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <LinearProgress variant="determinate" value={score.score} color={color} sx={{ height: 8, borderRadius: 4 }} />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 40 }}>
          {score.score}%
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {score.governed ? 'Governed' : `Below ${score.threshold}%`}
      </Typography>
    </Box>
  );
}

export function OwnerChips({ owners }: { owners: Summary['owners'] }) {
  if (owners.length === 0) return <Typography variant="body2" color="text.secondary">No owner</Typography>;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {owners.map(o => (
        <Chip key={`${o.urn}-${o.type}`} size="small" variant="outlined" label={`${o.name} · ${o.type}`} />
      ))}
    </Box>
  );
}

export function ClassificationChip({ value }: { value?: string }) {
  if (!value) return <Typography variant="body2" color="text.secondary">Unclassified</Typography>;
  const colors: Record<string, 'error' | 'warning'> = { Restricted: 'error', Confidential: 'warning' };
  const color = colors[value] ?? 'default';
  return <Chip size="small" color={color} label={value} />;
}
