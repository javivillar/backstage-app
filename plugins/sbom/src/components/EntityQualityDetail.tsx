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
import { CodeFinding, Endpoint, FileCoverage, QualityPart, QualityReport, TestCase, useQuality } from '../api';

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

const AUTH_COLOR: Record<Endpoint['auth'], string> = {
  none: '#c62828',
  custom: '#ef6c00',
  public: '#ef6c00',
  flow: '#2e7d32',
  user: '#2e7d32',
  roles: '#2e7d32',
};
const AUTH_TEXT: Record<Endpoint['auth'], string> = {
  none: 'none',
  custom: 'own scheme',
  public: 'public (declared)',
  flow: 'flows of the app',
  user: 'any signed-in user',
  roles: 'roles',
};
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#c62828', HIGH: '#c62828', MEDIUM: '#ef6c00', LOW: '#757575' };

/** Every finding of the report: Bandit and eslint (code), gitleaks and Trivy (secrets), the worst first. */
export function allFindings(report: QualityReport): Array<CodeFinding & { part: string }> {
  const parts: Array<[string, CodeFinding[] | undefined]> = [
    ['backend', report.backend?.detail?.findings],
    ['frontend', report.frontend?.detail?.findings],
    ['secrets', report.secrets?.detail?.findings],
  ];
  return parts
    .flatMap(([part, list]) => (list ?? []).map(f => ({ ...f, part })))
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity ?? ''] ?? 9) - (SEVERITY_ORDER[b.severity ?? ''] ?? 9) ||
        (a.file ?? '').localeCompare(b.file ?? '') ||
        (a.line ?? 0) - (b.line ?? 0),
    );
}

function Endpoints({ endpoints }: { endpoints: Endpoint[] }) {
  const [framework, setFramework] = useState(false);
  const rows = endpoints
    .filter(e => framework || e.owner === 'app')
    .sort((a, b) => Number(a.auth !== 'none') - Number(b.auth !== 'none') || a.path.localeCompare(b.path));
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Typography variant="subtitle2">Who can call each operation</Typography>
        <TextField
          select
          size="small"
          label="Operations"
          value={framework ? 'all' : 'app'}
          onChange={e => setFramework(e.target.value === 'all')}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="app">Of the application</MenuItem>
          <MenuItem value="all">Also of the framework</MenuItem>
        </TextField>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Operation</TableCell>
            <TableCell>Authentication</TableCell>
            <TableCell>Roles / why public</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(e => (
            <TableRow key={`${e.method} ${e.path}`} hover>
              <TableCell>
                <code>
                  {e.method} {e.path}
                </code>
                {e.owner === 'framework' && <span style={{ opacity: 0.6 }}> · framework</span>}
              </TableCell>
              <TableCell sx={{ color: e.owner === 'app' ? AUTH_COLOR[e.auth] : undefined, fontWeight: 600 }}>
                {AUTH_TEXT[e.auth] ?? e.auth}
              </TableCell>
              <TableCell>{e.roles?.length ? e.roles.join(', ') : e.reason ?? ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function Findings({ findings }: { findings: Array<CodeFinding & { part: string }> }) {
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="subtitle2">Findings (the worst first; never the secret itself)</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Severity</TableCell>
            <TableCell>Tool</TableCell>
            <TableCell>Rule</TableCell>
            <TableCell>Where</TableCell>
            <TableCell>What</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {findings.map((f, i) => (
            <TableRow key={`${f.tool}-${f.file}-${f.line}-${i}`} hover>
              <TableCell sx={{ color: SEVERITY_COLOR[f.severity ?? ''], fontWeight: 600 }}>{(f.severity ?? '').toLowerCase()}</TableCell>
              <TableCell>{f.tool}</TableCell>
              <TableCell>
                <code>{f.rule}</code>
              </TableCell>
              <TableCell>
                {f.where && f.where !== 'repository' ? `${f.where}: ` : ''}
                <code>
                  {f.file}
                  {f.line ? `:${f.line}` : ''}
                </code>
                {f.commit ? <span style={{ opacity: 0.7 }}> · commit {f.commit.slice(0, 7)}</span> : ''}
              </TableCell>
              <TableCell>{f.message ?? (f.tool === 'gitleaks' || f.tool === 'trivy' ? 'a secret: revoke it where it was issued' : '')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/** Code findings of the report: endpoints without authentication, static analysis, secrets. */
export function CodeFindings({ report }: { report: QualityReport }) {
  const endpoints = report.backend?.detail?.endpoints;
  const counts = report.backend?.endpoints;
  const findings = allFindings(report);
  const bandit = report.backend?.bandit;
  const security = report.frontend?.security;
  const secrets = report.secrets;
  const sast = bandit ? bandit.high + bandit.medium + (security?.errors ?? 0) : undefined;
  const leaks = secrets && typeof secrets.repo === 'number' ? secrets.repo + (secrets.images ?? 0) : undefined;
  const chip = (label: string, bad: boolean) => (
    <Chip key={label} size="small" label={label} sx={bad ? { bgcolor: STATUS_COLOR.failed, color: '#fff' } : { bgcolor: STATUS_COLOR.passed, color: '#fff' }} />
  );
  if (!counts && !bandit && !secrets) {
    return (
      <Typography variant="body2">
        This report has no code findings: it was made before the CI of the application looked at its endpoints, its code
        and its secrets (template line 3.1, <code>.github/endpoints.py</code>). The next image its CI publishes will have them.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {counts && chip(`${counts.unauthenticated} operations without authentication`, counts.unauthenticated > 0)}
        {counts && counts.public > 0 && <Chip size="small" variant="outlined" label={`${counts.public} declared public`} />}
        {sast !== undefined && chip(`${sast} static analysis findings`, sast > 0)}
        {bandit && bandit.low > 0 && <Chip size="small" variant="outlined" label={`${bandit.low} low (not counted)`} />}
        {leaks !== undefined && chip(`${leaks} secrets`, leaks > 0)}
        {secrets && typeof secrets.images !== 'number' && <Chip size="small" variant="outlined" label="images not scanned for secrets" />}
      </Box>
      {endpoints && <Endpoints endpoints={endpoints} />}
      {findings.length > 0 && <Findings findings={findings} />}
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
  const title = 'Tests, coverage & code findings';
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
  // a last tab with the code findings (endpoints, static analysis, secrets)
  const tabs = [...parts.map(p => (p === 'backend' ? 'Backend' : 'Frontend')), 'Code findings'];
  const index = Math.min(current, tabs.length - 1);
  const revision = report.revision || data?.attached?.revision;
  return (
    <InfoCard
      title={title}
      subheader={`The last CI run of the image${revision ? ` · commit ${revision.slice(0, 7)}` : ''}${report.generated ? ` · ${new Date(report.generated).toLocaleString()}` : ''}`}
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Tabs value={index} onChange={(_e, v) => setCurrent(v)}>
          {tabs.map(t => (
            <Tab key={t} label={t} />
          ))}
        </Tabs>
        {index < parts.length ? <Part key={parts[index]} part={report[parts[index]]!} /> : <CodeFindings report={report} />}
      </Box>
    </InfoCard>
  );
}
