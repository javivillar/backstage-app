import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CheckCircle from '@mui/icons-material/CheckCircle';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { datahubUrns } from '../annotations';
import { TYPE_LABEL, useAssetSummary, useImpact } from '../api';
import { ClassificationChip, OwnerChips, ScoreBar } from './parts';

/** Why the card is empty: 403 = not in a datahub-* group, 503 = integration not configured, ... */
function ErrorNote({ message }: { message: string }) {
  return (
    <Typography variant="body2" color="error">
      {message}
    </Typography>
  );
}

function AssetCard({ urn }: { urn: string }) {
  const { loading, error, data } = useAssetSummary(urn);
  return (
    <InfoCard
      title={data ? `DataHub · ${TYPE_LABEL[data.type]}` : 'DataHub'}
      subheader={data?.name}
      action={
        data && (
          <Button size="small" href={data.url} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>
            Open in DataHub
          </Button>
        )
      }
    >
      {loading && <Progress />}
      {error && <ErrorNote message={error} />}
      {data && (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {data.deprecated && (
            <Chip color="warning" size="small" label={`Deprecated${data.deprecationNote ? `: ${data.deprecationNote}` : ''}`} />
          )}
          {data.description && <Typography variant="body2">{data.description}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <ClassificationChip value={data.classification} />
            {data.domain && <Chip size="small" variant="outlined" label={`Domain: ${data.domain.name}`} />}
            {data.retentionDays !== undefined && <Chip size="small" variant="outlined" label={`Retention: ${data.retentionDays} d`} />}
            {data.personalData && <Chip size="small" color="warning" variant="outlined" label="Personal data" />}
          </Box>
          <OwnerChips owners={data.owners} />
          <ScoreBar score={data.score} />
        </Box>
      )}
    </InfoCard>
  );
}

/** Overview card: one DataHub card per asset the entity is annotated with. Renders nothing for other entities. */
export function EntityDatahubCard() {
  const { entity } = useEntity();
  const urns = datahubUrns(entity);
  if (urns.length === 0) return null;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {urns.map(u => (
        <AssetCard key={u} urn={u} />
      ))}
    </Box>
  );
}

/**
 * "If I change this, who is affected?" -- downstream lineage from DataHub, with the owners to notify.
 * Shown for datasets (the only kind whose lineage matters for a schema change).
 */
function ImpactSection({ urn }: { urn: string }) {
  const { loading, error, data } = useImpact(urn, urn.startsWith('urn:li:dataset:'));
  if (!urn.startsWith('urn:li:dataset:')) return null;
  if (loading) return <Progress />;
  if (error) return <ErrorNote message={`Impact unavailable: ${error}`} />;
  if (!data) return null;
  if (data.total === 0) {
    return <Typography variant="body2">Impact: nothing downstream depends on this dataset (per DataHub lineage).</Typography>;
  }
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="subtitle2">Impact of changing this dataset</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip color="warning" label={`${data.total} downstream asset${data.total === 1 ? '' : 's'}`} />
        {Object.entries(data.byType).map(([t, n]) => (
          <Chip key={t} size="small" variant="outlined" label={`${n} ${t}`} />
        ))}
        {data.critical > 0 && <Chip size="small" color="error" label={`${data.critical} dq-critical`} />}
        <Chip size="small" variant="outlined" label={`${data.directConsumers} direct, up to ${data.maxDegree} hops`} />
      </Box>
      {data.owners.length > 0 && (
        <Typography variant="body2">
          <b>Tell them first:</b> {data.owners.map(o => o.split(':').pop()).join(', ')}
        </Typography>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Affected asset</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Hops</TableCell>
            <TableCell>Owners</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.items.map(i => (
            <TableRow key={i.urn}>
              <TableCell>
                {i.name}
                {i.critical && <Chip size="small" color="error" label="dq-critical" sx={{ ml: 1 }} />}
              </TableCell>
              <TableCell>{i.type}</TableCell>
              <TableCell>{i.degree}</TableCell>
              <TableCell>{i.owners.map(o => o.split(':').pop()).join(', ') || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.truncated && (
        <Typography variant="caption" color="text.secondary">
          Showing {data.items.length} of {data.total}; the list is capped, the counts above cover the first {data.fetched}.
        </Typography>
      )}
    </Box>
  );
}

function GovernanceCard({ urn }: { urn: string }) {
  const { loading, error, data } = useAssetSummary(urn);
  if (loading) return <Progress />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const gaps = data.score.checks.filter(c => c.applicable && !c.ok);
  return (
    <InfoCard title={`${TYPE_LABEL[data.type]}: ${data.name}`} subheader={data.urn}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box sx={{ maxWidth: 420 }}>
          <ScoreBar score={data.score} />
        </Box>
        {gaps.length === 0 ? (
          <Typography variant="body2">No governance gaps.</Typography>
        ) : (
          <Typography variant="body2">
            {gaps.length} gap{gaps.length > 1 ? 's' : ''} to close. Governance metadata is edited in DataHub, not here.
          </Typography>
        )}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              <TableCell>Check</TableCell>
              <TableCell>What to do</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.score.checks
              .filter(c => c.applicable)
              .map(c => (
                <TableRow key={c.id}>
                  <TableCell>{c.ok ? <CheckCircle color="success" fontSize="small" /> : <ErrorOutline color="warning" fontSize="small" />}</TableCell>
                  <TableCell>{c.label}</TableCell>
                  <TableCell>{c.ok ? '' : c.hint}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <Divider />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <ClassificationChip value={data.classification} />
          {data.lawfulBasis && <Chip size="small" variant="outlined" label={`Lawful basis: ${data.lawfulBasis}`} />}
          {data.freshnessSlaHours !== undefined && <Chip size="small" variant="outlined" label={`Freshness SLA: ${data.freshnessSlaHours} h`} />}
          {data.columns && <Chip size="small" variant="outlined" label={`Columns described: ${data.columns.described}/${data.columns.total}`} />}
          {data.tags.map(t => (
            <Chip key={t.urn} size="small" label={t.name} />
          ))}
          {data.terms.map(t => (
            <Chip key={t.urn} size="small" color="primary" variant="outlined" label={t.name} />
          ))}
        </Box>
        <OwnerChips owners={data.owners} />
        <Divider />
        <ImpactSection urn={data.urn} />
        <Box>
          <Button size="small" variant="outlined" href={data.url} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>
            Edit in DataHub
          </Button>
        </Box>
      </Box>
    </InfoCard>
  );
}

/** Entity tab: completeness and gaps for every linked asset. */
export function EntityDatahubContent() {
  const { entity } = useEntity();
  const urns = datahubUrns(entity);
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {urns.map(u => (
        <GovernanceCard key={u} urn={u} />
      ))}
    </Box>
  );
}
