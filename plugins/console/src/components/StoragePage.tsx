import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useConsoleConfig } from '../config';
import { useClusterOverview, type VolumeOverview } from '../overview';
import { Badge } from './Badge';
import { bytes } from './ClusterOverviewPage';
import { TONES } from './Flow';
import { Table } from './NetworkPage';

const Used = ({ v }: { v: VolumeOverview }) => {
  if (v.usedBytes === undefined || !v.capacityBytes) return <Typography variant="body2" color="text.secondary">not mounted now</Typography>;
  const share = v.usedBytes / v.capacityBytes;
  let t = TONES.info;
  if (share >= 0.9) t = TONES.bad;
  else if (share >= 0.8) t = TONES.warn;
  return (
    <Box sx={{ minWidth: 160 }}>
      <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(share, 1) * 100}%`, bgcolor: t.fg }} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {Math.round(share * 100)}% · {bytes(v.usedBytes)} of {bytes(v.capacityBytes)}
      </Typography>
    </Box>
  );
};

/** Cluster layer › Storage: every volume of the cluster, the fullest first. */
export const StoragePage = () => {
  const cfg = useConsoleConfig();
  const { loading, data, error, reload } = useClusterOverview();
  const [all, setAll] = useState(false);
  const volumes = (data?.volumes ?? []).filter(v => all || v.usedBytes !== undefined);
  const full = (data?.volumes ?? []).filter(v => v.usedBytes !== undefined && v.capacityBytes && v.usedBytes / v.capacityBytes >= 0.8).length;
  const total = (data?.volumes ?? []).reduce((t, v) => t + v.requestedBytes, 0);
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            Storage of {cfg.cluster.id}
          </Typography>
          <Typography color="text.secondary">
            {data ? `${data.volumes?.length ?? 0} volumes · ${bytes(total)} requested · ${full} at 80% or more` : 'Volumes of the cluster (Longhorn)'}
          </Typography>
        </Box>
        <Button variant="text" onClick={reload} disabled={loading} sx={{ textTransform: 'none' }}>
          Refresh
        </Button>
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title="The volumes could not be read" message={error} />}
      {data && (
        <Paper variant="outlined" component="section" sx={{ borderRadius: 2, p: 2, display: 'grid', gap: 1 }}>
          <FormControlLabel control={<Switch size="small" checked={all} onChange={e => setAll(e.target.checked)} />} label="Show the volumes not mounted now" />
          <Table
            head={['Volume', 'Namespace', 'Size', 'Used', 'Storage class']}
            rows={volumes.map(v => [
              <b>{v.pvc}</b>,
              <Link to={`/console/namespaces/${v.namespace}`}>{v.namespace}</Link>,
              bytes(v.requestedBytes),
              <Used v={v} />,
              v.storageClass ? <Badge outlined label={v.storageClass} /> : '—',
            ])}
          />
        </Paper>
      )}
    </Box>
  );
};
