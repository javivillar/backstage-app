import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useConsoleConfig } from '../config';
import { useClusterOverview, type VolumeOverview } from '../overview';
import { bytes } from './ClusterOverviewPage';
import { TONES } from './Flow';
import { Table } from './NetworkPage';
import { useI18n } from '../i18n';
import { Id, Kpis, Pill, Section, TitleRow } from './ui';

const Used = ({ v }: { v: VolumeOverview }) => {
  if (v.usedBytes === undefined || !v.capacityBytes) return <Typography variant="body2" color="text.secondary">not mounted now</Typography>;
  const share = v.usedBytes / v.capacityBytes;
  let t = TONES.info;
  if (share >= 0.9) t = TONES.bad;
  else if (share >= 0.8) t = TONES.warn;
  return (
    <Box sx={{ minWidth: 160 }}>
      <Box sx={{ position: 'relative', height: 6, borderRadius: 3, bgcolor: 'action.selected', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(share, 1) * 100}%`, bgcolor: t === TONES.info ? '#0c4595' : t.fg }} />
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
  const { t } = useI18n();
  // the fullest first; volumes not mounted now at the end
  const share = (v: VolumeOverview) => (v.usedBytes !== undefined && v.capacityBytes ? v.usedBytes / v.capacityBytes : -1);
  const sorted = [...volumes].sort((a, b) => share(b) - share(a));
  return (
    <Box sx={{ maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[cfg.cluster.id, '/console/cluster'], [t('nav.storage')]]}
        title={t('storage.title', { cluster: cfg.cluster.id })}
        sub={t('storage.sub')}
        finding={data && (full ? t('storage.finding', { n: full }) : t('storage.findingOk'))}
        findingTone={full ? 'warn' : 'pos'}
        actions={
          <Button variant="text" onClick={reload} disabled={loading}>
            {t('cluster.refresh')}
          </Button>
        }
      />
      {loading && !data && <Progress />}
      {error && <WarningPanel title={t('storage.unreadable')} message={error} />}
      {data && (
        <>
          <Kpis
            items={[
              { label: t('storage.count'), value: data.volumes?.length ?? 0 },
              { label: t('storage.requested'), value: bytes(total) },
              { label: t('storage.full'), value: full, tone: full ? 'bad' : undefined },
            ]}
          />
          <Section flush>
            <Box sx={{ px: 2.25, py: 1 }}>
              <FormControlLabel control={<Switch size="small" checked={all} onChange={e => setAll(e.target.checked)} />} label={t('storage.showAll')} />
            </Box>
            <Table
              head={['Volume', t('cluster.namespace'), t('cluster.size'), t('cluster.used'), 'Storage class']}
              rows={sorted.map(v => [
                <Id>{v.pvc}</Id>,
                <Link to={`/console/namespaces/${v.namespace}`}>
                  <Id>{v.namespace}</Id>
                </Link>,
                bytes(v.requestedBytes),
                <Used v={v} />,
                v.storageClass ? <Pill plain>{v.storageClass}</Pill> : '—',
              ])}
            />
          </Section>
        </>
      )}
    </Box>
  );
};
