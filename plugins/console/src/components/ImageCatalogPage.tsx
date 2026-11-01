import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from './Badge';
import { ClassicLink } from './ClassicLink';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';

/** GET /api/sbom/images: the curated images of Harbor (common, framework-*) a system may use. */
type Tag = {
  tag: string;
  pull: string;
  category: string;
  audience: 'apps' | 'platform' | 'unknown';
  state: 'approved' | 'deprecated' | 'retired' | 'unknown';
  replacedBy: string;
  version: string;
  title: string;
  license: string;
  eol: string;
  scan?: { critical: number; high: number };
  sourceSignatureVerified: boolean;
  attestations: string[];
};
type Image = { repository: string; name: string; harborUrl: string; tags: Tag[] };
export type ImageCatalog = { configured: boolean; harbor?: string; images: Image[]; errors: string[] };
type Row = Tag & { repository: string };

const DAY = 86_400_000;
export function eolDays(eol: string, now = Date.now()): number | undefined {
  const t = Date.parse(eol);
  return Number.isNaN(t) ? undefined : Math.floor((t - now) / DAY);
}
const findingsTone = (s: { critical: number; high: number }) => {
  if (s.critical) return TONES.bad;
  return s.high ? TONES.warn : TONES.ok;
};
const stateTone = { approved: TONES.ok, deprecated: TONES.warn, retired: TONES.bad, unknown: TONES.off };

/** Cluster layer › Images, in the console: what a system may run, its state, end of life, findings and supply chain. */
export const ImageCatalogPage = () => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ImageCatalog; error?: string }>({ loading: true });
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'all' | 'problems' | 'apps' | 'platform'>('all');
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl('sbom')}/images`);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return (await r.json()) as ImageCatalog;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  const rows: Row[] = useMemo(() => (state.data?.images ?? []).flatMap(i => i.tags.map(t => ({ ...t, repository: i.repository }))), [state.data]);
  const problem = (r: Row) => r.state !== 'approved' || (r.scan?.critical ?? 0) > 0 || (eolDays(r.eol) ?? 999) < 90;
  const t = text.trim().toLowerCase();
  const shown = rows
    .filter(r => filter === 'all' || (filter === 'problems' ? problem(r) : r.audience === filter))
    .filter(r => !t || `${r.repository}:${r.tag} ${r.title} ${r.category}`.toLowerCase().includes(t));
  const kpi = (label: string, value: number, tone?: keyof typeof TONES) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone && value ? TONES[tone].fg : undefined }}>{value}</Typography>
    </Paper>
  );
  const filters: Array<[typeof filter, string]> = [
    ['all', 'All'],
    ['problems', 'Needs attention'],
    ['apps', 'For applications'],
    ['platform', 'Platform'],
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            Image catalog
          </Typography>
          <Typography color="text.secondary">The curated images of Harbor a system may use: scanned, signed, with their SBOM. Nothing is pulled from the internet at run time.</Typography>
        </Box>
        {state.data?.harbor && (
          <a href={state.data.harbor} target="_blank" rel="noreferrer" style={{ fontWeight: 500 }}>
            Open Harbor
          </a>
        )}
        <ClassicLink path="/images">Details in the classic portal</ClassicLink>
      </Box>
      {state.loading && <Progress />}
      {state.error && <WarningPanel title="The image catalog could not be read" message={state.error} />}
      {state.data?.errors?.length ? <WarningPanel severity="info" title="Part of the catalog could not be read" message={state.data.errors.join(' · ')} /> : null}
      {state.data && (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {kpi('Approved', rows.filter(r => r.state === 'approved').length)}
            {kpi('Deprecated or retired', rows.filter(r => r.state === 'deprecated' || r.state === 'retired').length, 'warn')}
            {kpi('With critical findings', rows.filter(r => (r.scan?.critical ?? 0) > 0).length, 'bad')}
            {kpi('End of life in < 90 days', rows.filter(r => (eolDays(r.eol) ?? 999) < 90).length, 'warn')}
          </Box>
          <Card title={`${shown.length} images`}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField size="small" label="Find an image" value={text} onChange={e => setText(e.target.value)} sx={{ minWidth: 240 }} />
              {filters.map(([id, label]) => (
                <Button key={id} variant="text" onClick={() => setFilter(id)} aria-pressed={filter === id} sx={{ textTransform: 'none', border: '1px solid', borderColor: filter === id ? 'primary.main' : 'divider' }}>
                  {label}
                </Button>
              ))}
            </Box>
            <Table
              head={['Image', 'Version', 'State', 'End of life', 'License', 'Findings', 'Supply chain']}
              rows={shown.map(r => {
                const days = eolDays(r.eol);
                let eolTone = TONES.off;
                if (days !== undefined && days < 0) eolTone = TONES.bad;
                else if (days !== undefined && days < 90) eolTone = TONES.warn;
                return [
                  <span>
                    <b style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
                      {r.repository}:{r.tag}
                    </b>
                    <br />
                    <Typography component="span" variant="caption" color="text.secondary">
                      {r.category} · {r.audience}
                    </Typography>
                  </span>,
                  r.title || r.version || '—',
                  <span>
                    <Badge label={r.state} {...stateTone[r.state]} />
                    {r.replacedBy && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        → {r.replacedBy}
                      </Typography>
                    )}
                  </span>,
                  r.eol ? <Badge label={r.eol} {...eolTone} /> : '—',
                  r.license || '—',
                  r.scan ? <Badge label={`${r.scan.critical} C · ${r.scan.high} H`} {...findingsTone(r.scan)} /> : '—',
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {r.sourceSignatureVerified && <Badge outlined label="signed" />}
                    {r.attestations.map(a => (
                      <Badge key={a} outlined label={a} />
                    ))}
                  </Box>,
                ];
              })}
            />
          </Card>
        </>
      )}
    </Box>
  );
};
