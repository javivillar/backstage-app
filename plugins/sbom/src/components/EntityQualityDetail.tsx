import { useMemo, useState } from 'react';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { sbomImages } from '../annotations';
import { FileCoverage, QualityPart, TestCase, useQuality } from '../api';

const STATUS_COLOR: Record<TestCase['status'], string> = {
  passed: '#2e7d32',
  failed: '#c62828',
  error: '#c62828',
  skipped: '#757575',
};
const STATUS_ORDER: Record<TestCase['status'], number> = { failed: 0, error: 0, skipped: 1, passed: 2 };

/** red under 50 %, amber under 80 % (the gate of the CI), green from there */
function pctColor(value?: number) {
  if (value === undefined) return undefined;
  if (value < 50) return '#c62828';
  if (value < 80) return '#ef6c00';
  return '#2e7d32';
}
const pct = (v?: number) => (v === undefined ? '' : `${Math.round(v * 10) / 10} %`);
const seconds = (t: number) => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`);

function Tests({ tests }: { tests: TestCase[] }) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const rows = useMemo(
    () =>
      tests
        .filter(t => status === 'all' || (status === 'failed' ? t.status === 'failed' || t.status === 'error' : t.status === status))
        .filter(t => !query || t.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name)),
    [tests, status, query],
  );
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="subtitle2">Tests</Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          select
          size="small"
          label="Result"
          value={status}
          onChange={e => {
            setStatus(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
          <MenuItem value="skipped">Skipped</MenuItem>
          <MenuItem value="passed">Passed</MenuItem>
        </TextField>
        <TextField
          size="small"
          label="Search"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 260 }}
        />
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Test</TableCell>
            <TableCell>Result</TableCell>
            <TableCell align="right">Time</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.slice(page * size, page * size + size).map(t => (
            <TableRow key={t.name} hover>
              <TableCell>
                <code>{t.name}</code>
                {t.message && (
                  <Typography component="pre" variant="caption" sx={{ m: 0, mt: 0.5, whiteSpace: 'pre-wrap', color: STATUS_COLOR[t.status] }}>
                    {t.message}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ color: STATUS_COLOR[t.status], fontWeight: 600 }}>{t.status}</TableCell>
              <TableCell align="right">{seconds(t.time)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        rowsPerPage={size}
        rowsPerPageOptions={[25, 50, 100]}
        onPageChange={(_e, p) => setPage(p)}
        onRowsPerPageChange={e => {
          setSize(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Box>
  );
}

function Coverage({ files }: { files: FileCoverage[] }) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const branches = files.some(f => f.branches !== undefined);
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="subtitle2">Coverage by file (least covered first)</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>File</TableCell>
            <TableCell align="right">Lines</TableCell>
            {branches && <TableCell align="right">Branches</TableCell>}
            <TableCell align="right">Statements</TableCell>
            <TableCell>Lines no test runs</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {files.slice(page * size, page * size + size).map(f => (
            <TableRow key={f.file} hover>
              <TableCell>
                <code>{f.file}</code>
              </TableCell>
              <TableCell align="right" sx={{ color: pctColor(f.lines), fontWeight: 600 }}>
                {pct(f.lines)}
              </TableCell>
              {branches && (
                <TableCell align="right" sx={{ color: pctColor(f.branches), fontWeight: 600 }}>
                  {pct(f.branches)}
                </TableCell>
              )}
              <TableCell align="right">{f.statements ?? ''}</TableCell>
              <TableCell>
                {f.missing ? <code>{f.missing}</code> : <span style={{ opacity: 0.6 }}>none</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={files.length}
        page={page}
        rowsPerPage={size}
        rowsPerPageOptions={[25, 50, 100]}
        onPageChange={(_e, p) => setPage(p)}
        onRowsPerPageChange={e => {
          setSize(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Box>
  );
}

function Part({ part }: { part: QualityPart }) {
  const t = part.tests;
  const c = part.coverage;
  const tests = part.detail?.tests;
  const files = part.detail?.coverage;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {t && <Chip size="small" label={`${t.total - t.failures - t.errors - t.skipped} passed`} sx={{ bgcolor: STATUS_COLOR.passed, color: '#fff' }} />}
        {t && t.failures + t.errors > 0 && <Chip size="small" label={`${t.failures + t.errors} failed`} sx={{ bgcolor: STATUS_COLOR.failed, color: '#fff' }} />}
        {t && t.skipped > 0 && <Chip size="small" label={`${t.skipped} skipped`} variant="outlined" />}
        {c?.lines !== undefined && <Chip size="small" variant="outlined" label={`lines ${pct(c.lines)}`} sx={{ color: pctColor(c.lines), borderColor: pctColor(c.lines) }} />}
        {c?.branches !== undefined && <Chip size="small" variant="outlined" label={`branches ${pct(c.branches)}`} sx={{ color: pctColor(c.branches), borderColor: pctColor(c.branches) }} />}
      </Box>
      {!tests && !files && (
        <Typography variant="body2">
          This report has only the totals: it was made before the CI of the application wrote the detail of each test and
          file. The next image its CI publishes (a merge in <code>main</code>) will have it.
        </Typography>
      )}
      {tests && <Tests tests={tests} />}
      {files && <Coverage files={files} />}
    </Box>
  );
}

/**
 * Tests & coverage of an application: every test of its last CI run and the coverage of each file, from the quality
 * report its CI attaches to its images (the same report on each image: the first one is read).
 */
export function EntityQualityDetailContent() {
  const { entity } = useEntity();
  const image = sbomImages(entity)[0];
  const { loading, error, data } = useQuality(image);
  const [current, setCurrent] = useState(0);
  if (!image) return null;
  if (loading) return <Progress />;
  const title = 'Tests & coverage';
  if (error) {
    return (
      <InfoCard title={title}>
        <Typography variant="body2" color="error">
          The quality report could not be read: {error}
        </Typography>
      </InfoCard>
    );
  }
  const report = data?.report;
  if (!report) {
    return (
      <InfoCard title={title}>
        <Typography variant="body2">
          The image <code>{image}</code> has no quality report attached: it was built before its CI made them.
        </Typography>
      </InfoCard>
    );
  }
  const parts = (['backend', 'frontend'] as const).filter(p => report[p]);
  const index = Math.min(current, parts.length - 1);
  const revision = report.revision || data?.attached?.revision;
  return (
    <InfoCard
      title={title}
      subheader={`The last CI run of the image${revision ? ` · commit ${revision.slice(0, 7)}` : ''}${report.generated ? ` · ${new Date(report.generated).toLocaleString()}` : ''}`}
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        {parts.length > 1 && (
          <Tabs value={index} onChange={(_e, v) => setCurrent(v)}>
            {parts.map(p => (
              <Tab key={p} label={p === 'backend' ? 'Backend' : 'Frontend'} />
            ))}
          </Tabs>
        )}
        {parts.length > 0 ? <Part key={parts[index]} part={report[parts[index]]!} /> : <Typography variant="body2">The report has no parts.</Typography>}
      </Box>
    </InfoCard>
  );
}
