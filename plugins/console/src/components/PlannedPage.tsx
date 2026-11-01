import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { classicUrl, useConsoleConfig } from '../config';
import { Badge } from './Badge';

type Props = { title: string; phase: string; summary: string; classic: Array<{ label: string; path: string }> };

/** A layer the console will cover in a later phase: says what it will show and where it is today. */
export const PlannedPage = ({ title, phase, summary, classic }: Props) => {
  const cfg = useConsoleConfig();
  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 820 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Badge label={`phase ${phase}`} outlined />
      </Box>
      <Typography color="text.secondary">{summary}</Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, display: 'grid', gap: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>Today, in the classic portal</Typography>
        {classic.map(c => (
          <a key={c.path} href={classicUrl(cfg, c.path)}>
            {c.label}
          </a>
        ))}
      </Paper>
    </Box>
  );
};
