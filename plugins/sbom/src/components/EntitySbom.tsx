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
import { Component, ImageSbom, useDownload, useSbom } from '../api';

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
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Summary data={data} />
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
