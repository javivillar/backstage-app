import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from './Badge';
import { ClassicLink } from './ClassicLink';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { useI18n } from '../i18n';
import { Id, Kpis, Pill, TitleRow, choose, type Tone } from './ui';

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
/** The steps of the supply chain every image should carry: a missing one shows in red. */
const CHAIN = ['provenance', 'sbom-cyclonedx', 'sbom-spdx', 'vex'];
/** The template "Request a curated image" (backstage-templates harbor-request-image), in the console's Create page:
 * it opens a pull request in opennebula (harbor/catalog.d) and the image arrives through the quarantine. */
const REQUEST_IMAGE = '/console/create/templates/default/harbor-request-image';
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
  const { t: tr } = useI18n();
  const filters: Array<[typeof filter, string]> = [
    ['all', tr('img.all')],
    ['problems', tr('img.problems')],
    ['apps', tr('img.apps')],
    ['platform', tr('img.platform')],
  ];
  const critical = rows.filter(r => (r.scan?.critical ?? 0) > 0).length;
  const eolSoon = rows.filter(r => (eolDays(r.eol) ?? 999) < 90).length;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[tr('cluster.crumb'), '/console/cluster'], [tr('page.images')]]}
        title={tr('img.title')}
        pills={state.data && <Pill plain>{tr('img.approvedN', { n: rows.filter(r => r.state === 'approved').length })}</Pill>}
        sub={tr('img.sub')}
        finding={state.data && (critical || eolSoon ? tr('img.finding', { c: critical, e: eolSoon }) : tr('img.findingOk'))}
        findingTone={choose<Tone>([[critical, 'neg'], [eolSoon, 'warn']], 'pos')}
        actions={
          <>
            <ClassicLink path="/images">{tr('cisn.classic')}</ClassicLink>
            <Button variant="outlined" component={Link} to={REQUEST_IMAGE}>
              {tr('img.request')}
            </Button>
            {state.data?.harbor && (
              <Button variant="contained" href={state.data.harbor} target="_blank" rel="noreferrer">
                {tr('img.harbor')}
              </Button>
            )}
          </>
        }
      />
      {state.loading && <Progress />}
      {state.error && <WarningPanel title="The image catalog could not be read" message={state.error} />}
      {state.data?.errors?.length ? <WarningPanel severity="info" title="Part of the catalog could not be read" message={state.data.errors.join(' · ')} /> : null}
      {state.data && (
        <>
          <Kpis
            items={[
              { label: tr('img.approved'), value: rows.filter(r => r.state === 'approved').length },
              { label: tr('img.deprecated'), value: rows.filter(r => r.state === 'deprecated' || r.state === 'retired').length },
              { label: tr('img.critical'), value: critical, tone: critical ? 'bad' : undefined },
              { label: tr('img.eol'), value: eolSoon, tone: eolSoon ? 'bad' : undefined },
            ]}
          />
          <Card title={tr('img.count', { n: shown.length })}>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField size="small" label={tr('img.find')} value={text} onChange={e => setText(e.target.value)} sx={{ minWidth: 240 }} />
              <Box role="group" aria-label="Filter" sx={{ display: 'inline-flex', p: '2px', gap: '2px', borderRadius: '6px', bgcolor: 'action.hover', border: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
                {filters.map(([id, label]) => (
                  <Button key={id} size="small" variant="text" onClick={() => setFilter(id)} aria-pressed={filter === id} sx={{ px: 1.5, height: 28, color: filter === id ? 'text.primary' : 'text.secondary', bgcolor: filter === id ? 'background.paper' : 'transparent', boxShadow: filter === id ? 1 : 0 }}>
                    {label}
                  </Button>
                ))}
              </Box>
            </Box>
            <Table
              head={[tr('img.image'), tr('img.version'), tr('img.state'), tr('img.eolCol'), tr('img.license'), tr('img.findings'), tr('img.chain')]}
              rows={shown.map(r => {
                const days = eolDays(r.eol);
                let eolTone = TONES.off;
                if (days !== undefined && days < 0) eolTone = TONES.bad;
                else if (days !== undefined && days < 90) eolTone = TONES.warn;
                return [
                  <span>
                    <Id>
                      {r.repository}:{r.tag}
                    </Id>
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
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxWidth: 280 }}>
                    {r.sourceSignatureVerified ? <Pill plain>signed</Pill> : <Pill tone="neg" plain>{tr('img.no', { what: 'signed' })}</Pill>}
                    {r.attestations.map(a => (
                      <Pill key={a} plain>
                        {a}
                      </Pill>
                    ))}
                    {CHAIN.filter(c => !r.attestations.includes(c)).map(c => (
                      <Pill key={c} tone="neg" plain>
                        {tr('img.no', { what: c })}
                      </Pill>
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
