import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Content, ContentHeader, Header, Link, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopy from '@mui/icons-material/ContentCopy';

/** GET /api/sbom/images (plugins/sbom-backend/src/imageCatalog.ts). */
export type ImageTag = {
  tag: string;
  pull: string;
  category: string;
  summary: string;
  audience: 'apps' | 'platform' | 'unknown';
  state: 'approved' | 'deprecated' | 'retired' | 'unknown';
  replacedBy: string;
  owner: string;
  note: string;
  inHarbor: boolean;
  digest: string;
  pushedAt: string;
  version: string;
  title: string;
  license: string;
  eol: string;
  distro: string;
  compliance: string;
  scan?: { status: string; severity: string; critical: number; high: number; medium: number; low: number; scannedAt?: string };
  sourceSignatureVerified: boolean;
  attestations: string[];
};
export type Image = { repository: string; project: string; name: string; source: string; harborUrl: string; tags: ImageTag[] };
export type ImageCatalog = {
  configured: boolean;
  harbor?: string;
  catalog?: { published: boolean; generatedAt?: string; commit?: string; error?: string };
  categories: Record<string, string>;
  images: Image[];
  errors: string[];
};

type Row = ImageTag & { image: Image };
type Audience = 'apps' | 'platform' | 'all';

function useImageCatalog() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ImageCatalog; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('sbom')}/images`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as ImageCatalog;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  return state;
}

/** Days from today to an ISO date (negative: past). */
export function daysUntil(date: string, today = new Date()): number | undefined {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return undefined;
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((t - now) / 86400000);
}

export function EolChip({ eol }: { eol: string }) {
  if (!eol) return <Typography variant="body2" color="text.secondary">—</Typography>;
  const days = daysUntil(eol);
  let sx = {};
  let title = `${days} days left`;
  if (days !== undefined && days < 0) {
    sx = { bgcolor: '#c62828', color: '#fff' };
    title = `ended ${-days} days ago`;
  } else if (days !== undefined && days < 180) {
    sx = { bgcolor: '#ed6c02', color: '#fff' };
  }
  return (
    <Tooltip title={title}>
      <Chip size="small" label={eol} variant={Object.keys(sx).length ? 'filled' : 'outlined'} sx={sx} />
    </Tooltip>
  );
}

function VulnChips({ scan }: { scan?: ImageTag['scan'] }) {
  if (!scan) return <Typography variant="body2" color="text.secondary">not scanned</Typography>;
  if (scan.status !== 'Success') return <Chip size="small" variant="outlined" label={`scan ${scan.status.toLowerCase()}`} />;
  return (
    <Tooltip title={`medium ${scan.medium} · low ${scan.low}${scan.scannedAt ? ` · scanned ${new Date(scan.scannedAt).toLocaleString()}` : ''}`}>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Chip size="small" label={`C ${scan.critical}`} sx={scan.critical ? { bgcolor: '#c62828', color: '#fff' } : {}} variant={scan.critical ? 'filled' : 'outlined'} />
        <Chip size="small" label={`H ${scan.high}`} sx={scan.high ? { bgcolor: '#ed6c02', color: '#fff' } : {}} variant={scan.high ? 'filled' : 'outlined'} />
      </Box>
    </Tooltip>
  );
}

function SupplyChain({ row }: { row: Row }) {
  const has = (k: string) => row.attestations.some(a => a.startsWith(k));
  const items: [string, boolean, string][] = [
    ['signed', row.sourceSignatureVerified, 'signature of the source verified by the Harbor sync'],
    ['SBOM', has('sbom'), 'SBOM of the source (CycloneDX / SPDX)'],
    ['VEX', has('vex'), 'VEX of the source: findings declared not affected'],
    ['provenance', has('provenance'), 'SLSA provenance of the build'],
  ];
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {items.map(([label, ok, why]) => (
        <Tooltip key={label} title={`${why}: ${ok ? 'yes' : 'no'}`}>
          <Chip size="small" label={label} color={ok ? 'success' : 'default'} variant={ok ? 'filled' : 'outlined'} sx={ok ? {} : { opacity: 0.5 }} />
        </Tooltip>
      ))}
    </Box>
  );
}

function StateChip({ row }: { row: Row }) {
  if (row.state === 'approved' || row.state === 'unknown') return null;
  return (
    <Chip
      size="small"
      label={row.replacedBy ? `${row.state} → ${row.replacedBy}` : row.state}
      sx={{ bgcolor: row.state === 'retired' ? '#c62828' : '#ed6c02', color: '#fff', ml: 1 }}
    />
  );
}

function CopyPull({ row }: { row: Row }) {
  const ref = row.digest ? `${row.pull}@${row.digest}` : row.pull;
  const [done, setDone] = useState(false);
  return (
    <Tooltip title={done ? 'copied' : `copy ${ref}`}>
      <IconButton
        size="small"
        aria-label={`copy pull reference of ${row.image.repository}:${row.tag}`}
        onClick={() => {
          navigator.clipboard?.writeText(ref).then(() => setDone(true), () => undefined);
        }}
      >
        <ContentCopy fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

const entityPath = (repository: string) =>
  `/catalog/default/resource/${`image-${repository.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 63).replace(/-+$/, '')}`;

export function ImagesPage() {
  const { loading, data, error } = useImageCatalog();
  const [params] = useSearchParams();
  const [text, setText] = useState(params.get('repository') ?? '');
  const [project, setProject] = useState('all');
  const [category, setCategory] = useState('all');
  const [audience, setAudience] = useState<Audience | undefined>(undefined);
  // with the catalog published, start with what a system may use; without it nobody knows the audience
  const shownAudience: Audience = audience ?? (data?.catalog?.published ? 'apps' : 'all');

  const rows: Row[] = useMemo(
    () => (data?.images ?? []).flatMap(image => image.tags.map(t => ({ ...t, image }))),
    [data],
  );
  const categories = useMemo(() => [...new Set(rows.map(r => r.category))].sort(), [rows]);
  const projects = useMemo(() => [...new Set(rows.map(r => r.image.project))].sort(), [rows]);
  const visible = rows
    .filter(r => project === 'all' || r.image.project === project)
    .filter(r => category === 'all' || r.category === category)
    .filter(r => shownAudience === 'all' || r.audience === shownAudience)
    .filter(r => {
      const q = text.trim().toLowerCase();
      return !q || `${r.image.repository}:${r.tag} ${r.summary} ${r.title} ${r.version}`.toLowerCase().includes(q);
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.image.repository.localeCompare(b.image.repository) || a.tag.localeCompare(b.tag));

  return (
    <Page themeId="tool">
      <Header title="Images" subtitle="Container images of Harbor that a system may use: curated, scanned, with their supply chain" />
      <Content>
        <ContentHeader title="Image catalog" />
        {loading && <Progress />}
        {error && <WarningPanel severity="error" title="The image catalog could not be read" message={error} />}
        {data && !data.configured && (
          <WarningPanel severity="info" title="Not configured" message="sbom.imageCatalog.harborUrl is not set in this Backstage." />
        )}
        {data?.configured && (
          <>
            {!data.catalog?.published && (
              <WarningPanel
                severity="warning"
                title="The catalog of the host is not published yet"
                message={`The list comes straight from Harbor: category, audience and summary appear after the next Harbor sync on the host (common/image-catalog).${data.catalog?.error ? ` ${data.catalog.error}` : ''}`}
              />
            )}
            {data.errors.length > 0 && (
              <WarningPanel severity="warning" title="Some data could not be read from Harbor" message={data.errors.join(' · ')} />
            )}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', my: 2 }}>
              <ToggleButtonGroup size="small" exclusive value={shownAudience} onChange={(_e, v) => v && setAudience(v)} aria-label="audience">
                <ToggleButton value="apps">For systems</ToggleButton>
                <ToggleButton value="platform">Platform only</ToggleButton>
                <ToggleButton value="all">All</ToggleButton>
              </ToggleButtonGroup>
              <TextField size="small" select label="Project" value={project} onChange={e => setProject(e.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="all">All projects</MenuItem>
                {projects.map(p => (
                  <MenuItem key={p} value={p}>{p}</MenuItem>
                ))}
              </TextField>
              <TextField size="small" select label="Category" value={category} onChange={e => setCategory(e.target.value)} sx={{ minWidth: 200 }}>
                <MenuItem value="all">All categories</MenuItem>
                {categories.map(c => (
                  <MenuItem key={c} value={c}>{data.categories[c] ?? c}</MenuItem>
                ))}
              </TextField>
              <TextField size="small" label="Search" value={text} onChange={e => setText(e.target.value)} sx={{ minWidth: 240 }} />
              <Typography variant="body2" color="text.secondary">
                {visible.length} of {rows.length} images
                {data.catalog?.generatedAt ? ` · catalog of ${new Date(data.catalog.generatedAt).toLocaleString()}` : ''}
              </Typography>
            </Box>
            <Table size="small" aria-label="images">
              <TableHead>
                <TableRow>
                  <TableCell>Image</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>License</TableCell>
                  <TableCell>End of life</TableCell>
                  <TableCell>Vulnerabilities</TableCell>
                  <TableCell>Supply chain</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map(r => (
                  <TableRow key={`${r.image.repository}:${r.tag}`} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Link to={entityPath(r.image.repository)}>
                          <b>{r.image.repository}</b>:{r.tag}
                        </Link>
                        {r.audience === 'platform' && <Chip size="small" variant="outlined" label="platform" sx={{ ml: 1 }} />}
                        <StateChip row={r} />
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {r.summary || r.title}
                      </Typography>
                    </TableCell>
                    <TableCell>{data.categories[r.category] ?? r.category}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {r.version || '—'}
                      {r.distro && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {r.distro}
                          {r.compliance ? ` · ${r.compliance.toUpperCase()}` : ''}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{r.license || '—'}</TableCell>
                    <TableCell>
                      <EolChip eol={r.eol} />
                    </TableCell>
                    <TableCell>
                      <VulnChips scan={r.scan} />
                    </TableCell>
                    <TableCell>
                      <SupplyChain row={r} />
                    </TableCell>
                    <TableCell padding="checkbox">
                      <CopyPull row={r} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
              Vulnerabilities: Harbor's scan (Trivy). A critical declared not affected in the VEX of the image does not block its pull
              (allowlist of the project, rebuilt by every sync). The copy button gives the reference pinned by digest. Source:{' '}
              <Link to={data.harbor ?? '#'}>{data.harbor}</Link>
              {data.catalog?.commit ? ` · catalog.toml ${data.catalog.commit.slice(0, 7)}` : ''}
            </Typography>
          </>
        )}
      </Content>
    </Page>
  );
}
