import { Progress } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { sbomImages } from '../annotations';
import { type QualityPart, type QualityReport, useQuality } from '../api';
import { EntityQualityDetailContent } from './EntityQualityDetail';

const TONE = { ok: '#1E6B34', warn: '#8A4300', bad: '#B3261E', off: '#5A6878' };

/** The figures of a quality report: tests, coverage of lines, code findings, endpoints without authentication. */
export function qualityFigures(report: QualityReport) {
  const parts = [report.backend, report.frontend].filter((p): p is QualityPart => !!p);
  const tests = parts.reduce(
    (t, p) => ({
      total: t.total + (p.tests?.total ?? 0),
      failed: t.failed + (p.tests?.failures ?? 0) + (p.tests?.errors ?? 0),
      skipped: t.skipped + (p.tests?.skipped ?? 0),
    }),
    { total: 0, failed: 0, skipped: 0 },
  );
  const cov = parts.map(p => p.coverage?.lines).filter((x): x is number => typeof x === 'number');
  const coverage = cov.length ? Math.round(cov.reduce((a, b) => a + b, 0) / cov.length) : undefined;
  const findings =
    parts.reduce((t, p) => t + (p.detail?.findings?.length ?? 0), 0) + (report.secrets?.detail?.findings?.length ?? 0);
  const unauthenticated = parts.reduce((t, p) => t + (p.endpoints?.unauthenticated ?? 0), 0);
  const files = parts
    .flatMap(p => p.detail?.coverage ?? [])
    .sort((a, b) => a.lines - b.lines)
    .slice(0, 8);
  return { tests, coverage, findings, unauthenticated, files };
}

const Kpi = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: keyof typeof TONE }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.5, bgcolor: 'background.paper' }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 22, fontWeight: 600, color: tone ? TONE[tone] : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    )}
  </Box>
);

const Card = ({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.25, minWidth: 0 }}>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
          {title}
        </Typography>
        {sub && (
          <Typography variant="body2" color="text.secondary">
            {sub}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
    {children}
  </Box>
);

/**
 * The Quality & Security tab inside the console: the figures of the quality report its CI attaches to the image, the
 * scorecard (passed in by the app: Tech Insights), the files with the least coverage, and every test on demand.
 */
export const EntityQualityConsoleContent = ({ scorecard, ask }: { scorecard?: ReactNode; ask?: ReactNode }) => {
  const { entity } = useEntity();
  const image = sbomImages(entity)[0];
  const { loading, error, data } = useQuality(image);
  const [all, setAll] = useState(false);
  const report = data?.report ?? undefined;
  const f = report ? qualityFigures(report) : undefined;
  let note: string | undefined;
  if (!image) note = 'The catalog says no image of it (refresquito.io/sbom-images).';
  else if (error) note = `The quality report could not be read: ${error}`;
  else if (!loading && !report) note = `The image ${image} has no quality report attached: it was built before its CI made them.`;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {loading && <Progress />}
      {f && (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
          <Kpi label="Tests" value={`${f.tests.total - f.tests.failed - f.tests.skipped} passed`} sub={`${f.tests.failed} failed · ${f.tests.skipped} skipped`} tone={f.tests.failed ? 'bad' : 'ok'} />
          <Kpi label="Coverage of lines" value={f.coverage !== undefined ? `${f.coverage} %` : '—'} sub="objective 80 %" tone={f.coverage === undefined || f.coverage >= 80 ? 'ok' : 'warn'} />
          <Kpi label="Code findings" value={String(f.findings)} sub="static analysis and secrets" tone={f.findings ? 'warn' : 'ok'} />
          <Kpi label="Endpoints without authentication" value={String(f.unauthenticated)} tone={f.unauthenticated ? 'warn' : 'ok'} />
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Card title="Scorecard" sub="What an application of the platform must have, checked every hour (Tech Insights)." action={ask}>
          {scorecard ?? <Typography color="text.secondary">Not available in this portal.</Typography>}
        </Card>
        <Card
          title="Tests and coverage"
          sub={image ? `From the quality report attached to ${image.split('/').pop()}.` : undefined}
          action={
            report ? (
              <Button variant="outlined" size="small" onClick={() => setAll(x => !x)} sx={{ textTransform: 'none' }}>
                {all ? 'Hide the tests' : 'View the tests'}
              </Button>
            ) : undefined
          }
        >
          {note && <Typography color="text.secondary">{note}</Typography>}
          {f && f.files.length > 0 && (
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              <Typography variant="body2" color="text.secondary">
                Files with the least coverage
              </Typography>
              {f.files.map(x => (
                <Box key={x.file} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px 48px', gap: 1, alignItems: 'center', fontSize: 13 }}>
                  <Box component="code" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.file}>
                    {x.file}
                  </Box>
                  <Box sx={{ height: 8, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${Math.min(100, x.lines)}%`, bgcolor: x.lines < 60 ? TONE.warn : TONE.ok }} />
                  </Box>
                  <Box sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(x.lines)} %</Box>
                </Box>
              ))}
            </Box>
          )}
        </Card>
      </Box>
      {/* every test, the coverage of each file, the code findings and the exceptions: the full report */}
      {all && <EntityQualityDetailContent />}
    </Box>
  );
};
