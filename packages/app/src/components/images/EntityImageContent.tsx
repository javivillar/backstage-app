import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Entity } from '@backstage/catalog-model';
import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

export const HARBOR_REPOSITORY_ANNOTATION = 'refresquito.io/harbor-repository';
const TAGS_ANNOTATION = 'refresquito.io/image-tags';

/** The tab Image is shown on the entities of the image catalog (Resource, type container-image). */
export const isImageAvailable = (entity: Entity) => Boolean(entity.metadata.annotations?.[HARBOR_REPOSITORY_ANNOTATION]);

/** GET /api/sbom/images/detail (plugins/sbom-backend/src/imageDetail.ts). */
export type Finding = {
  id: string;
  package: string;
  version: string;
  fixVersion: string;
  severity: string;
  score?: number;
  description: string;
  link?: string;
  coveredByVex: boolean;
  platforms: string[];
};
export type ImageDetail = {
  repository: string;
  tag: string;
  digest: string;
  platforms: { platform: string; digest: string }[];
  scan: { status: string; scanner?: string; generatedAt?: string } | null;
  findings: Finding[];
  allowlist: { count: number; expiresAt?: string };
  signatureAttached: boolean;
  attestations: { predicateType: string; digest: string }[];
  sbom: {
    total: number;
    generator?: string;
    ecosystems: Record<string, number>;
    licenses: Record<string, number>;
    components: { name: string; version?: string; ecosystem: string; licenses: string[] }[];
  } | null;
  provenance: { predicateType: string; builder?: string; buildType?: string; source?: string; revision?: string; startedOn?: string; finishedOn?: string } | null;
  history: { digest: string; tags: string[]; pushedAt: string; critical: number; high: number; scanned: boolean }[];
  errors: string[];
};

const SEVERITY_COLOR: Record<string, string> = { Critical: '#c62828', High: '#ed6c02', Medium: '#f9a825', Low: '#757575' };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');
const short = (digest: string) => digest.replace('sha256:', '').slice(0, 12);
function kindOf(predicateType: string): string {
  if (predicateType.includes('cyclonedx')) return 'SBOM CycloneDX';
  if (predicateType.includes('spdx')) return 'SBOM SPDX';
  if (predicateType.includes('openvex')) return 'VEX';
  if (predicateType.includes('slsa.dev/provenance')) return `SLSA provenance ${predicateType.split('/').pop()}`;
  return predicateType || 'attestation';
}

function useDetail(repository: string, tag: string | undefined) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ImageDetail; error?: string }>({ loading: true });
  useEffect(() => {
    if (!tag) return undefined;
    let alive = true;
    setState({ loading: true });
    (async () => {
      const q = new URLSearchParams({ repository, tag });
      const res = await fetch(`${await discovery.getBaseUrl('sbom')}/images/detail?${q}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as ImageDetail;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, repository, tag]);
  return state;
}

function Findings({ detail }: { detail: ImageDetail }) {
  const [hideCovered, setHideCovered] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const counts = (covered: boolean) =>
    ['Critical', 'High', 'Medium', 'Low'].map(s => [s, detail.findings.filter(f => f.severity === s && f.coveredByVex === covered).length] as const);
  const shown = detail.findings.filter(f => !hideCovered || !f.coveredByVex).filter(f => showAll || f.severity === 'Critical' || f.severity === 'High');
  return (
    <InfoCard title="Vulnerabilities" subheader={detail.scan ? `${detail.scan.scanner ?? 'Harbor'} · ${when(detail.scan.generatedAt)}` : 'not scanned'}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
        {counts(false).map(([s, n]) => (
          <Chip key={s} size="small" label={`${s} ${n}`} sx={n && SEVERITY_COLOR[s] ? { bgcolor: SEVERITY_COLOR[s], color: '#fff' } : {}} variant={n ? 'filled' : 'outlined'} />
        ))}
        {counts(true).some(([, n]) => n > 0) && (
          <Tooltip title={`Declared not affected (or fixed) in the VEX of the image: in the CVE allowlist of the project, they do not block the pull${detail.allowlist.expiresAt ? ` (allowlist until ${when(detail.allowlist.expiresAt)})` : ''}`}>
            <Chip size="small" color="success" label={`covered by the VEX: ${counts(true).filter(([, n]) => n).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ')}`} />
          </Tooltip>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <FormControlLabel control={<Switch size="small" checked={hideCovered} onChange={e => setHideCovered(e.target.checked)} />} label="Hide covered by the VEX" />
        <FormControlLabel control={<Switch size="small" checked={showAll} onChange={e => setShowAll(e.target.checked)} />} label="Also medium and low" />
      </Box>
      {shown.length === 0 ? (
        <Typography variant="body2" sx={{ p: 1 }}>
          Nothing to show with these filters.
        </Typography>
      ) : (
        <Table size="small" aria-label="findings">
          <TableHead>
            <TableRow>
              <TableCell>Vulnerability</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Package</TableCell>
              <TableCell>Fixed in</TableCell>
              <TableCell>VEX</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map(f => (
              <TableRow key={`${f.id} ${f.package} ${f.version}`} hover>
                <TableCell>
                  <Tooltip title={f.description}>
                    <span>{f.link ? <Link to={f.link}>{f.id}</Link> : f.id}</span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {f.severity}
                  {f.score ? ` ${f.score}` : ''}
                </TableCell>
                <TableCell>
                  {f.package} <Typography component="span" variant="caption" color="text.secondary">{f.version}</Typography>
                </TableCell>
                <TableCell>{f.fixVersion || '—'}</TableCell>
                <TableCell>{f.coveredByVex ? <Chip size="small" color="success" label="not affected" /> : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </InfoCard>
  );
}

function Sbom({ detail }: { detail: ImageDetail }) {
  const [all, setAll] = useState(false);
  const sbom = detail.sbom;
  if (!sbom) {
    return (
      <InfoCard title="SBOM">
        <Typography variant="body2">The maker of this image attached no CycloneDX SBOM.</Typography>
      </InfoCard>
    );
  }
  const licenses = Object.entries(sbom.licenses).sort((a, b) => b[1] - a[1]);
  const components = all ? sbom.components : sbom.components.slice(0, 15);
  return (
    <InfoCard title="SBOM" subheader={`${sbom.total} components${sbom.generator ? ` · ${sbom.generator}` : ''} (attached by the maker, linux/amd64)`}>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
        {Object.entries(sbom.ecosystems).map(([e, n]) => (
          <Chip key={e} size="small" variant="outlined" label={`${e} ${n}`} />
        ))}
      </Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        <b>Licenses:</b> {licenses.slice(0, 12).map(([l, n]) => `${l} (${n})`).join(', ')}
        {licenses.length > 12 ? ` and ${licenses.length - 12} more` : ''}
      </Typography>
      <Table size="small" aria-label="components">
        <TableHead>
          <TableRow>
            <TableCell>Component</TableCell>
            <TableCell>Version</TableCell>
            <TableCell>License</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {components.map(c => (
            <TableRow key={`${c.ecosystem} ${c.name} ${c.version}`}>
              <TableCell>{c.name}</TableCell>
              <TableCell>{c.version ?? ''}</TableCell>
              <TableCell>{c.licenses.join(', ')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {sbom.components.length > 15 && (
        <FormControlLabel control={<Switch size="small" checked={all} onChange={e => setAll(e.target.checked)} />} label={`All ${sbom.components.length} components`} />
      )}
    </InfoCard>
  );
}

function SupplyChain({ detail }: { detail: ImageDetail }) {
  const p = detail.provenance;
  const row = (k: string, v?: ReactNode) => (
    <TableRow>
      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</TableCell>
      <TableCell>{v ?? '—'}</TableCell>
    </TableRow>
  );
  return (
    <InfoCard title="Supply chain">
      <Table size="small" aria-label="supply chain">
        <TableBody>
          {row('Digest', <code>{detail.digest}</code>)}
          {row('Platforms', detail.platforms.map(x => x.platform).join(', '))}
          {row('Signature', detail.signatureAttached ? <Chip size="small" color="success" label="attached (cosign, verified by the Harbor sync)" /> : 'none attached')}
          {row('Attestations', detail.attestations.length ? detail.attestations.map(a => kindOf(a.predicateType)).join(' · ') : 'none')}
          {row('Built by', p?.builder ? <Link to={p.builder}>{p.builder.replace(/^https:\/\/github.com\//, '')}</Link> : undefined)}
          {row('Source', p?.source ? `${p.source}${p.revision ? ` @ ${p.revision.slice(0, 12)}` : ''}` : undefined)}
          {row('Built', p?.finishedOn ? when(p.finishedOn) : undefined)}
        </TableBody>
      </Table>
    </InfoCard>
  );
}

function History({ detail }: { detail: ImageDetail }) {
  return (
    <InfoCard title="History" subheader="Every version of this repository in Harbor, newest first (a tag rebuilt by its maker leaves the old one untagged)">
      <Table size="small" aria-label="history">
        <TableHead>
          <TableRow>
            <TableCell>Digest</TableCell>
            <TableCell>Tags</TableCell>
            <TableCell>Pushed</TableCell>
            <TableCell>Critical / high</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {detail.history.map(h => (
            <TableRow key={h.digest} selected={h.digest === detail.digest}>
              <TableCell>
                <code>{short(h.digest)}</code>
              </TableCell>
              <TableCell>{h.tags.join(', ') || <Typography variant="caption" color="text.secondary">untagged</Typography>}</TableCell>
              <TableCell>{when(h.pushedAt)}</TableCell>
              <TableCell>{h.scanned ? `${h.critical} / ${h.high}` : 'not scanned'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </InfoCard>
  );
}

export function EntityImageContent() {
  const { entity } = useEntity();
  const repository = entity.metadata.annotations?.[HARBOR_REPOSITORY_ANNOTATION] ?? '';
  const tags = useMemo(
    () => (entity.metadata.annotations?.[TAGS_ANNOTATION] ?? '').split(',').map(t => t.trim()).filter(Boolean),
    [entity],
  );
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') && tags.includes(params.get('tag') as string) ? (params.get('tag') as string) : tags[0];
  const { loading, data, error } = useDetail(repository, tag);
  if (!tag) return <WarningPanel severity="info" title="No tag of this image is in the catalog" />;
  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' }, alignItems: 'start' }}>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="subtitle2">{repository}</Typography>
          {tags.map(t => (
            <Chip
              key={t}
              label={t}
              clickable
              color={t === tag ? 'primary' : 'default'}
              variant={t === tag ? 'filled' : 'outlined'}
              onClick={() => setParams({ tag: t }, { replace: true })}
            />
          ))}
        </Box>
      </Box>
      {loading && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Progress />
        </Box>
      )}
      {error && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <WarningPanel severity="error" title="The image could not be read from Harbor" message={error} />
        </Box>
      )}
      {data && (
        <>
          {data.errors.length > 0 && (
            <Box sx={{ gridColumn: '1 / -1' }}>
              <WarningPanel severity="warning" title="Part of the image could not be read" message={data.errors.join(' · ')} />
            </Box>
          )}
          <Box>
            <Findings detail={data} />
          </Box>
          <Box>
            <SupplyChain detail={data} />
          </Box>
          <Box>
            <Sbom detail={data} />
          </Box>
          <Box>
            <History detail={data} />
          </Box>
        </>
      )}
    </Box>
  );
}
