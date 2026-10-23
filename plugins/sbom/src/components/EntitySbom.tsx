import { useMemo, useState } from 'react';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import Download from '@mui/icons-material/Download';
import { SbomSource, sbomSources } from '../annotations';
import { Component, Feed, ImageSbom, Vulnerability, useDownload, useSbom, useVulnerabilities } from '../api';

const ECOSYSTEM_LABEL: Record<string, string> = {
  pypi: 'Python',
  npm: 'npm',
  maven: 'Java (Maven)',
  nuget: '.NET (NuGet)',
  golang: 'Go',
  deb: 'Debian',
  apk: 'Alpine',
  rpm: 'RPM',
  generic: 'Other',
};

const label = (ecosystem: string) => ECOSYSTEM_LABEL[ecosystem] ?? ecosystem;
const shortDigest = (d?: string) => (d ? `${d.slice(0, 19)}…` : '');
/** the part of the image a person reads: app-api:abc1234; a release as repo@tag */
const sourceName = ({ kind, ref }: SbomSource) => {
  if (kind === 'release') return ref.split('/').pop() ?? ref;
  const last = ref.split('/').pop() ?? ref;
  const [name, tag] = last.split(/[:@]/);
  return tag ? `${name}:${tag.replace(/^sha256-?/, '').slice(0, 7)}` : name;
};

function Summary({ data }: { data: ImageSbom }) {
  const download = useDownload();
  const [error, setError] = useState<string>();
  const s = data.summary!;
  return (
    <InfoCard
      title="SBOM"
      subheader={`${s.total} components · CycloneDX ${s.specVersion ?? ''}${s.generator ? ` · ${s.generator}` : ''}`}
      action={
        <Button size="small" startIcon={<Download fontSize="small" />} onClick={() => download(data.kind, data.image).catch(e => setError((e as Error).message))}>
          CycloneDX JSON
        </Button>
      }
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {error && <Typography color="error" variant="body2">{error}</Typography>}
        {data.kind === 'release' ? (
          <Typography variant="body2">
            Release{' '}
            <a href={data.url} target="_blank" rel="noopener">
              <code>{data.image}</code>
            </a>
            <br />
            File <code>{data.asset}</code>
            {data.created && <> · published {new Date(data.created).toLocaleString()}</>}
          </Typography>
        ) : (
          <Typography variant="body2">
            Image <code>{data.image}</code>
            <br />
            Digest <code title={data.digest}>{shortDigest(data.digest)}</code>
            {data.created && <> · SBOM attached {new Date(data.created).toLocaleString()}</>}
            {data.revision && <> · commit <code>{data.revision.slice(0, 7)}</code></>}
          </Typography>
        )}
        {s.frameworks.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Framework
            </Typography>
            {s.frameworks.map(c => (
              <Chip key={`${c.ecosystem}/${c.name}`} color="primary" size="small" label={`${c.name} ${c.version ?? ''}`} />
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Ecosystems
          </Typography>
          {Object.entries(s.ecosystems)
            .sort((a, b) => b[1] - a[1])
            .map(([eco, n]) => (
              <Chip key={eco} size="small" variant="outlined" label={`${label(eco)} ${n}`} />
            ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Licenses
          </Typography>
          {Object.entries(s.licenses)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([lic, n]) => (
              <Chip key={lic} size="small" variant="outlined" label={`${lic} ${n}`} />
            ))}
        </Box>
      </Box>
    </InfoCard>
  );
}

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#c62828', HIGH: '#e65100', MEDIUM: '#b28704', LOW: '#607d8b', UNKNOWN: '#9e9e9e' };
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const when = (iso?: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '');
/** where to read about it: GitHub for its advisories, Aqua's database (the one Trivy uses) for the rest */
const advisory = (id: string) =>
  id.startsWith('GHSA-') ? `https://github.com/advisories/${id}` : `https://avd.aquasec.com/nvd/${id.toLowerCase()}`;

const KEV_COLOR = '#b71c1c';
const kevUrl = (id: string) => `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${id}`;
/** EPSS as a percentage: 0.27775 -> "27.8 %", tiny ones "< 0.1 %" */
export function epssText(epss?: number) {
  if (epss === undefined) return '';
  if (epss < 0.001) return '< 0.1 %';
  return `${(epss * 100).toFixed(epss < 0.1 ? 1 : 0)} %`;
}

/** the KEV cell: a red chip to CISA's entry, "no", or nothing when the KEV feed was not available */
function KevCell({ v }: { v: Vulnerability }) {
  if (v.kev === undefined) return null;
  if (!v.kev) return <span style={{ opacity: 0.5 }}>no</span>;
  return (
    <a href={kevUrl(v.id)} target="_blank" rel="noopener" title={`In CISA KEV since ${v.kev_added ?? '?'}`}>
      <Chip
        size="small"
        label={v.kev_ransomware ? 'KEV · ransomware' : 'KEV'}
        sx={{ bgcolor: KEV_COLOR, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
      />
    </a>
  );
}
/** most urgent first: known exploited, severity, probability of exploitation, then the id */
export const byUrgency = (a: Vulnerability, b: Vulnerability) =>
  Number(!!b.kev) - Number(!!a.kev) ||
  SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev) ||
  (b.epss ?? -1) - (a.epss ?? -1) ||
  a.id.localeCompare(b.id);

/** "KEV catalogue 2026.10.21 · EPSS of 2026-10-22", with what is wrong with a feed */
function feedText(name: string, f?: Feed) {
  if (!f || f.status === 'disabled') return `${name}: not used`;
  if (f.status === 'missing') return `${name}: not available${f.error ? ` (${f.error})` : ''}`;
  const what = f.version ? `${name} ${f.version}` : `${name} of ${f.date ?? '?'}`;
  const age = (f.age_days ?? 0) > 3 ? `, ${f.age_days} days old` : '';
  return `${what}${f.status === 'cached' ? ' (cached copy: the last download failed)' : ''}${age}`;
}

/** The vulnerabilities of the image, as Wazuh's daily image scan (Trivy) found them, with the context Wazuh adds. */
export function Vulnerabilities({ image }: { image: string }) {
  const { loading, error, data } = useVulnerabilities(image);
  const [severity, setSeverity] = useState('all');
  const [fixable, setFixable] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const vulns = useMemo(() => data?.scan?.vulns ?? [], [data]);
  const rows = useMemo(
    () =>
      vulns
        .filter(v => (severity === 'all' || (severity === 'KEV' ? !!v.kev : v.sev === severity)) && (!fixable || !!v.fix))
        .sort(byUrgency),
    [vulns, severity, fixable],
  );
  const title = 'Vulnerabilities';
  if (loading) return <InfoCard title={title}><Progress /></InfoCard>;
  if (error) return <InfoCard title={title}><Typography color="error" variant="body2">{error}</Typography></InfoCard>;
  if (!data?.configured) {
    return (
      <InfoCard title={title}>
        <Typography variant="body2">This Backstage does not read Wazuh's image scan (sbom.vulnerabilitiesUrl).</Typography>
      </InfoCard>
    );
  }
  const scan = data.scan;
  if (!scan) {
    return (
      <InfoCard title={title} subheader="Wazuh image scan (Trivy)">
        <Typography variant="body2">
          The last image scan did not see this image: Wazuh scans the images that are running once a day (03:10 UTC), so
          an image deployed after it shows up the next day.
        </Typography>
      </InfoCard>
    );
  }
  if (scan.status === 'scan_error') {
    return (
      <InfoCard title={title} subheader={`Wazuh image scan (Trivy) · ${when(scan.run)}`}>
        <Typography variant="body2" color="error">
          Wazuh could not scan this image{scan.message ? `: ${scan.message}` : ''}. A private image needs the pull
          credentials of the image scan (wazuh-oneke 0.19.0, USE-CASES.md I5).
        </Typography>
      </InfoCard>
    );
  }
  const unique = (sev: string) => new Set(vulns.filter(v => v.sev === sev).map(v => v.id)).size;
  const withFix = new Set(vulns.filter(v => v.fix).map(v => v.id)).size;
  const ctx = scan.context;
  const kevKnown = !!ctx && ctx.kev !== null && ctx.kev !== undefined;
  const kevIds = new Set(vulns.filter(v => v.kev).map(v => v.id));
  const days = (n?: number) => (n === undefined || n < 0 ? 'none' : `${n} days`);
  return (
    <InfoCard
      title={title}
      subheader={`Wazuh image scan (Trivy) · scanned ${when(scan.run)}${scan.db ? ` · database ${when(scan.db)}` : ''}${scan.os ? ` · ${scan.os}` : ''}`}
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {SEVERITIES.filter(s => s !== 'UNKNOWN' || (scan.counts[s] ?? 0) > 0).map(s => (
            <Chip
              key={s}
              size="small"
              label={`${s.toLowerCase()} ${scan.counts[s] ?? 0}`}
              sx={(scan.counts[s] ?? 0) > 0 ? { bgcolor: SEVERITY_COLOR[s], color: '#fff', fontWeight: 600 } : { opacity: 0.6 }}
              variant={(scan.counts[s] ?? 0) > 0 ? 'filled' : 'outlined'}
            />
          ))}
          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            findings (one CVE in several packages counts several times) · {unique('CRITICAL')} critical and{' '}
            {unique('HIGH')} high CVEs, {withFix} with a fix
          </Typography>
        </Box>
        {ctx ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip
              size="small"
              label={kevKnown ? `known exploited (CISA KEV) ${kevIds.size}` : 'known exploited: unknown'}
              sx={kevIds.size > 0 ? { bgcolor: KEV_COLOR, color: '#fff', fontWeight: 600 } : { opacity: 0.7 }}
              variant={kevIds.size > 0 ? 'filled' : 'outlined'}
            />
            {(ctx.kev_ransomware ?? 0) > 0 && (
              <Chip size="small" label={`used by ransomware ${ctx.kev_ransomware}`} sx={{ bgcolor: KEV_COLOR, color: '#fff' }} />
            )}
            <Typography variant="body2" sx={{ opacity: 0.75 }}>
              highest EPSS {ctx.epss_max !== null && ctx.epss_max !== undefined ? `${epssText(ctx.epss_max)} (${ctx.epss_max_id})` : 'none'} ·
              oldest fixable critical open {days(ctx.critical_fix_max_days)}, high {days(ctx.high_fix_max_days)}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ opacity: 0.6 }}>
            No context (EPSS, CISA KEV, age) in this scan: it needs wazuh-oneke 0.20.0.
          </Typography>
        )}
        {scan.feeds && (
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            Context by Wazuh: {feedText('CISA KEV', scan.feeds.kev)} · {feedText('EPSS', scan.feeds.epss)}
            {scan.feeds.tracking_since ? ` · days counted since ${scan.feeds.tracking_since}` : ''}
          </Typography>
        )}
        {vulns.length === 0 ? (
          <Typography variant="body2">No CRITICAL or HIGH vulnerabilities.</Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                select
                size="small"
                label="Severity"
                value={severity}
                onChange={e => {
                  setSeverity(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 240 }}
              >
                <MenuItem value="all">Critical, high and known exploited</MenuItem>
                <MenuItem value="KEV">Known exploited (KEV)</MenuItem>
                <MenuItem value="CRITICAL">Critical</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="Fix"
                value={fixable ? 'yes' : 'all'}
                onChange={e => {
                  setFixable(e.target.value === 'yes');
                  setPage(0);
                }}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="yes">With a fix</MenuItem>
              </TextField>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Vulnerability</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell title="CISA Known Exploited Vulnerabilities: exploited in the wild">KEV</TableCell>
                  <TableCell title="FIRST EPSS: probability of exploitation in the next 30 days">EPSS</TableCell>
                  <TableCell title="Days since its image repository first had it (Wazuh)">Open</TableCell>
                  <TableCell>Package</TableCell>
                  <TableCell>Installed</TableCell>
                  <TableCell>Fixed in</TableCell>
                  <TableCell>Title</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.slice(page * size, page * size + size).map((v: Vulnerability) => (
                  <TableRow key={`${v.id}/${v.pkg}/${v.ver}`} hover>
                    <TableCell>
                      <a href={advisory(v.id)} target="_blank" rel="noopener">
                        {v.id}
                      </a>
                    </TableCell>
                    <TableCell sx={{ color: SEVERITY_COLOR[v.sev], fontWeight: 600 }}>{v.sev.toLowerCase()}</TableCell>
                    <TableCell>
                      <KevCell v={v} />
                    </TableCell>
                    <TableCell title={v.epss_pct !== undefined ? `percentile ${(v.epss_pct * 100).toFixed(1)}` : undefined}>
                      {epssText(v.epss)}
                    </TableCell>
                    <TableCell title={v.first_seen ? `first seen ${v.first_seen}` : undefined}>
                      {v.age_days !== undefined ? `${v.age_days} d` : ''}
                    </TableCell>
                    <TableCell>{v.pkg}</TableCell>
                    <TableCell>{v.ver}</TableCell>
                    <TableCell>{v.fix || <span style={{ opacity: 0.6 }}>no fix yet</span>}</TableCell>
                    <TableCell>{v.title}</TableCell>
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
          </>
        )}
      </Box>
    </InfoCard>
  );
}

function Components({ components }: { components: Component[] }) {
  const [query, setQuery] = useState('');
  const [ecosystem, setEcosystem] = useState('all');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const ecosystems = useMemo(() => [...new Set(components.map(c => c.ecosystem))].sort(), [components]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return components.filter(
      c =>
        (ecosystem === 'all' || c.ecosystem === ecosystem) &&
        (!q || c.name.toLowerCase().includes(q) || (c.version ?? '').includes(q) || c.licenses.some(l => l.toLowerCase().includes(q))),
    );
  }, [components, query, ecosystem]);
  return (
    <InfoCard title="Components" subheader={`${rows.length} of ${components.length}`}>
      <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
        <TextField
          size="small"
          label="Search name, version or license"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setPage(0);
          }}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          size="small"
          label="Ecosystem"
          value={ecosystem}
          onChange={e => {
            setEcosystem(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="all">All</MenuItem>
          {ecosystems.map(e => (
            <MenuItem key={e} value={e}>
              {label(e)}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Version</TableCell>
            <TableCell>Ecosystem</TableCell>
            <TableCell>License</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.slice(page * size, page * size + size).map(c => (
            <TableRow key={`${c.purl ?? c.name}@${c.version}`} hover>
              <TableCell title={c.purl}>
                {c.group ? `${c.group}/` : ''}
                {c.name}
              </TableCell>
              <TableCell>{c.version}</TableCell>
              <TableCell>{label(c.ecosystem)}</TableCell>
              <TableCell>{c.licenses.join(', ')}</TableCell>
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
    </InfoCard>
  );
}

function SbomView({ source }: { source: SbomSource }) {
  const { loading, error, data } = useSbom(source.kind, source.ref);
  if (loading) return <Progress />;
  if (error) {
    return (
      <Typography color="error" variant="body2">
        {error}
      </Typography>
    );
  }
  if (!data?.summary) {
    return (
      <Box sx={{ display: 'grid', gap: 2 }}>
        <InfoCard title="SBOM">
          <Typography variant="body2">
            {source.kind === 'release' ? (
              <>
                The release <code>{source.ref}</code> has no SBOM file: it was published before its release workflow made
                SBOMs.
              </>
            ) : (
              <>
                The image <code>{source.ref}</code> has no SBOM attached: it was built before its CI made SBOMs. The next
                image its CI publishes (a merge in <code>main</code>) will have one.
              </>
            )}
          </Typography>
        </InfoCard>
        {source.kind === 'image' && <Vulnerabilities image={source.ref} />}
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Summary data={data} />
      {source.kind === 'image' && <Vulnerabilities image={source.ref} />}
      <Components components={data.summary.components} />
    </Box>
  );
}

/**
 * The SBOM tab of a component: one view per image it runs (annotation refresquito.io/sbom-images) and per release of
 * a library it is made of (refresquito.io/sbom-releases).
 */
export function EntitySbomContent() {
  const { entity } = useEntity();
  const sources = sbomSources(entity);
  const [current, setCurrent] = useState(0);
  if (!sources.length) {
    return <Typography variant="body2">This component says no images or releases (refresquito.io/sbom-images, refresquito.io/sbom-releases).</Typography>;
  }
  const index = Math.min(current, sources.length - 1);
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {sources.length > 1 && (
        <Tabs value={index} onChange={(_e, v) => setCurrent(v)}>
          {sources.map(source => (
            <Tab key={`${source.kind}:${source.ref}`} label={sourceName(source)} />
          ))}
        </Tabs>
      )}
      <SbomView key={`${sources[index].kind}:${sources[index].ref}`} source={sources[index]} />
    </Box>
  );
}
