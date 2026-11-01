import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Content, ContentHeader, Header, Link, LinkButton, Page, Progress, WarningPanel } from '@backstage/core-components';
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
  /** signed in Harbor with the key of Refresquito: it passed the gate of the quarantine */
  refresquitoSigned?: boolean;
  /** a newer version held in the quarantine (the project keeps serving `digest`) */
  quarantine?: { digest: string; reasons: string[] };
};
export type Image = { repository: string; project: string; name: string; source: string; harborUrl: string; tags: ImageTag[] };
export type ImageCatalog = {
  configured: boolean;
  harbor?: string;
  catalog?: { published: boolean; generatedAt?: string; commit?: string; error?: string };
  categories: Record<string, string>;
  images: Image[];
  /** facts of the supply chain of the Harbor of this zone (vulnerability database, air-gapped, last bundle) */
  supplyChain?: {
    airgapped: boolean;
    vulnerabilityDb?: { updatedAt?: string; nextUpdate?: string; javaUpdatedAt?: string; source?: string };
    lastBundle?: { direction: 'import' | 'export'; id: string; createdAt?: string; importedAt?: string; exportedAt?: string } | null;
  };
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

/** What needs a look: past (or within 90 days of) its end of life, critical CVEs, an update held, not signed, not copied. */
export function needsAttention(r: Pick<ImageTag, 'eol' | 'scan' | 'quarantine' | 'inHarbor' | 'refresquitoSigned'>): string[] {
  const why: string[] = [];
  const days = r.eol ? daysUntil(r.eol) : undefined;
  if (days !== undefined && days < 0) why.push('past its end of life');
  else if (days !== undefined && days <= 90) why.push(`end of life in ${days} days`);
  if (r.scan?.status === 'Success' && r.scan.critical > 0) why.push(`${r.scan.critical} critical`);
  if (r.quarantine) why.push('update held in the quarantine');
  if (!r.inHarbor) why.push('not in Harbor yet');
  else if (r.refresquitoSigned === false) why.push('not signed by Refresquito');
  return why;
}

function SupplyChain({ row }: { row: Row }) {
  const has = (k: string) => row.attestations.some(a => a.startsWith(k));
  const items: [string, boolean, string][] = [
    ['Refresquito', !!row.refresquitoSigned, 'signed by Refresquito in Harbor: it passed the gate of the quarantine (scan + VEX)'],
    ['source signed', row.sourceSignatureVerified, 'signature of the source (Docker) verified by the Harbor sync'],
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
      {row.quarantine && (
        <Tooltip
          title={`A newer version (${row.quarantine.digest.slice(7, 19)}) did not pass the gate; Harbor keeps serving this one. ${row.quarantine.reasons.join(' · ')}`}
        >
          <Chip size="small" label="update held" sx={{ bgcolor: '#ed6c02', color: '#fff' }} />
        </Tooltip>
      )}
    </Box>
  );
}

/** The vulnerability database, air-gapped or not, the last bundle, and what needs a look: one line over the table. */
function SupplyChainStatus({ data, rows }: { data: ImageCatalog; rows: Row[] }) {
  const sc = data.supplyChain;
  const parts: { text: string; warn?: boolean; tip?: string }[] = [];
  if (sc?.vulnerabilityDb?.updatedAt) {
    const age = Math.floor((Date.now() - Date.parse(sc.vulnerabilityDb.updatedAt)) / 86400000);
    const limit = sc.airgapped ? 8 : 2;
    parts.push({
      text: `Vulnerability database of ${new Date(sc.vulnerabilityDb.updatedAt).toLocaleDateString()}${age >= 1 ? ` (${age} days old)` : ''}`,
      warn: age > limit,
      tip: sc.airgapped
        ? 'Air-gapped: it arrives with each bundle; scans miss every CVE published since. Import a bundle at least weekly.'
        : 'Harbor (Trivy) downloads it daily.',
    });
  }
  if (sc?.airgapped) {
    const b = sc.lastBundle;
    parts.push({
      text: b ? `air-gapped zone · last bundle ${b.id}${b.importedAt ? `, imported ${new Date(b.importedAt).toLocaleDateString()}` : ''}` : 'air-gapped zone · no bundle imported yet',
      warn: !b,
    });
  } else if (sc?.lastBundle?.direction === 'export') {
    parts.push({ text: `last bundle exported for air-gapped zones: ${sc.lastBundle.id}` });
  }
  const inHarbor = rows.filter(r => r.inHarbor);
  parts.push({ text: `${inHarbor.filter(r => r.refresquitoSigned).length} of ${inHarbor.length} signed by Refresquito` });
  const held = rows.filter(r => r.quarantine).length;
  if (held) parts.push({ text: `${held} update(s) held in the quarantine`, warn: true });
  const eol = rows.filter(r => r.eol && (daysUntil(r.eol) ?? 1) < 0).length;
  if (eol) parts.push({ text: `${eol} past their end of life`, warn: true });
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }} aria-label="supply chain status">
      {parts.map(p => (
        <Tooltip key={p.text} title={p.tip ?? ''}>
          <Chip size="small" label={p.text} variant={p.warn ? 'filled' : 'outlined'} sx={p.warn ? { bgcolor: '#ed6c02', color: '#fff' } : {}} />
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

/** The Backstage template "Request a curated image" (backstage-templates harbor-request-image). */
export const REQUEST_IMAGE_TEMPLATE = '/create/templates/default/harbor-request-image';

export function ImagesPage() {
  const { loading, data, error } = useImageCatalog();
  const [params] = useSearchParams();
  const [text, setText] = useState(params.get('repository') ?? '');
  const [project, setProject] = useState('all');
  const [category, setCategory] = useState('all');
  const [audience, setAudience] = useState<Audience | undefined>(undefined);
  const [attention, setAttention] = useState(false);
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
    .filter(r => !attention || needsAttention(r).length > 0)
    .filter(r => {
      const q = text.trim().toLowerCase();
      return !q || `${r.image.repository}:${r.tag} ${r.summary} ${r.title} ${r.version}`.toLowerCase().includes(q);
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.image.repository.localeCompare(b.image.repository) || a.tag.localeCompare(b.tag));

  return (
    <Page themeId="tool">
      <Header title="Images" subtitle="Container images of Harbor that a system may use: curated, scanned, with their supply chain" />
      <Content>
        <ContentHeader title="Image catalog">
          {/* the template opens a pull request in opennebula (harbor/catalog.d); the image arrives through the quarantine */}
          <LinkButton to={REQUEST_IMAGE_TEMPLATE} variant="outlined" color="primary">
            Request an image
          </LinkButton>
        </ContentHeader>
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
            <SupplyChainStatus data={data} rows={rows} />
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
              <ToggleButton size="small" value="attention" selected={attention} onChange={() => setAttention(!attention)} aria-label="needs attention">
                Needs attention ({rows.filter(r => needsAttention(r).length > 0).length})
              </ToggleButton>
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
                        <Link to={`${entityPath(r.image.repository)}/image?tag=${encodeURIComponent(r.tag)}`}>
                          <b>{r.image.repository}</b>:{r.tag}
                        </Link>
                        {r.audience === 'platform' && <Chip size="small" variant="outlined" label="platform" sx={{ ml: 1 }} />}
                        <StateChip row={r} />
                        {!r.inHarbor && (
                          <Tooltip title="In the catalog (requested) but not copied yet: the next sync of Harbor brings it through the quarantine; version, licence, end of life and scan come with it.">
                            <Chip size="small" variant="outlined" label="requested, not in Harbor yet" sx={{ ml: 1 }} />
                          </Tooltip>
                        )}
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
              (allowlist of the project, rebuilt by every sync). Refresquito: the image passed the gate of the quarantine of Harbor
              and carries the signature of Refresquito; source signed: the signature of its maker (Docker) was verified. The copy button gives the reference pinned by digest. Source:{' '}
              <Link to={data.harbor ?? '#'}>{data.harbor}</Link>
              {data.catalog?.commit ? ` · catalog.toml ${data.catalog.commit.slice(0, 7)}` : ''}
            </Typography>
          </>
        )}
      </Content>
    </Page>
  );
}
