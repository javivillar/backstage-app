import { type Entity, parseEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode, useEffect, useState } from 'react';
import { useClusterGet } from '../namespace';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Table } from './NetworkPage';

/* ------------------------------------------------------------------ shared */

const Card = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.25, minWidth: 0 }}>
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
    {children}
  </Box>
);

const Kpi = ({ label, value, tone }: { label: string; value: string; tone?: keyof typeof TONES }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.5, bgcolor: 'background.paper' }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 22, fontWeight: 600, color: tone ? TONES[tone].fg : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
);

const ago = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/** GET through the GitHub proxy of Backstage (/api/proxy/github). */
function useGithub<T>(path?: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: !!path });
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl('proxy')}/github${path}`);
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      return (await r.json()) as T;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, path]);
  return state;
}

/** owner/repo of an entity: github.com/project-slug, or refresquito.io/repository (a slug or a GitHub URL). */
export function repoSlug(e: Entity): string | undefined {
  const a = e.metadata.annotations ?? {};
  const v = a['github.com/project-slug'] ?? a['refresquito.io/repository'];
  if (!v) return undefined;
  const m = v.match(/github\.com[/:]([^/]+\/[^/.#?]+)/);
  return m ? m[1] : v.replace(/^\/+|\/+$/g, '');
}

/* ------------------------------------------------------------------ CI/CD */

type Run = { id: number; name: string; display_title: string; head_sha: string; head_branch: string; event: string; status: string; conclusion: string | null; html_url: string; created_at: string; run_started_at?: string; updated_at: string };
type ArgoApp = {
  name: string;
  sync?: string;
  revision?: string;
  health?: string;
  operation?: { phase?: string; message?: string; finishedAt?: string };
  history: Array<{ id: number; revision?: string; deployedAt?: string; took?: number; by?: string }>;
  resources: Array<{ kind: string; name: string; sync?: string; health?: string }>;
};

const runTone = (r: Run): keyof typeof TONES => {
  if (r.status !== 'completed') return 'info';
  if (r.conclusion === 'success') return 'ok';
  if (r.conclusion === 'failure' || r.conclusion === 'timed_out') return 'bad';
  return 'off';
};
const took = (r: Run) => {
  const s = (Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)) / 1000;
  return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
};

/** Run statistics of the last runs: success rate and median duration (seconds) of the completed ones. */
export function runStats(runs: Run[]): { rate?: number; median?: number } {
  const done = runs.filter(r => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  if (!done.length) return {};
  const secs = done.map(r => (Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)) / 1000).sort((a, b) => a - b);
  return { rate: Math.round((done.filter(r => r.conclusion === 'success').length / done.length) * 100), median: secs[Math.floor(secs.length / 2)] };
}

const seconds = (s?: number) => {
  if (s === undefined) return '—';
  return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
};
const argoTone = (a?: ArgoApp): keyof typeof TONES | undefined => {
  if (!a) return undefined;
  return a.sync === 'Synced' && a.health === 'Healthy' ? 'ok' : 'warn';
};

/** The entity page › CI/CD: GitHub Actions of its repository and the deployments of its Argo CD application. */
export const EntityCicdContent = () => {
  const { entity } = useEntity();
  const slug = repoSlug(entity);
  const runs = useGithub<{ workflow_runs: Run[] }>(slug ? `/repos/${slug}/actions/runs?per_page=20` : undefined);
  const appName = entity.metadata.annotations?.['argocd/app-name'] ?? entity.metadata.name;
  const argo = useClusterGet<ArgoApp>(`/apps/${encodeURIComponent(appName)}`, 60_000);
  const list = runs.data?.workflow_runs ?? [];
  const stats = runStats(list);
  const last = argo.data?.history[0];
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
        <Kpi label="Runs that pass (last 20)" value={stats.rate !== undefined ? `${stats.rate} %` : '—'} tone={stats.rate === undefined || stats.rate >= 80 ? 'ok' : 'warn'} />
        <Kpi label="Usual duration" value={seconds(stats.median)} />
        <Kpi label="Last deployment" value={last?.deployedAt ? ago(last.deployedAt) : '—'} />
        <Kpi label="Argo CD" value={argo.data ? `${argo.data.sync ?? '?'} · ${argo.data.health ?? '?'}` : '—'} tone={argoTone(argo.data)} />
      </Box>
      <Card title="Pipeline" sub={slug ? <>GitHub Actions of <a href={`https://github.com/${slug}/actions`} target="_blank" rel="noreferrer">{slug}</a>, newest first.</> : 'The catalog does not say its repository (github.com/project-slug).'}>
        {runs.loading && <Progress />}
        {runs.error && <WarningPanel severity="warning" title="The runs could not be read" message={runs.error} />}
        {list.length > 0 && (
          <>
            <Box aria-label="Last runs, oldest left" sx={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: 40 }}>
              {[...list].reverse().map(r => (
                <Box key={r.id} title={`${r.name} #${r.id}: ${r.conclusion ?? r.status}`} sx={{ flex: 1, minWidth: 5, height: runTone(r) === 'bad' ? '45%' : '100%', borderRadius: '3px 3px 0 0', bgcolor: TONES[runTone(r)].fg, opacity: runTone(r) === 'off' ? 0.4 : 0.85 }} />
              ))}
            </Box>
            <Table
              head={['Workflow', 'Commit', 'Result', 'Took', 'When']}
              rows={list.slice(0, 12).map(r => [
                <a href={r.html_url} target="_blank" rel="noreferrer">
                  {r.name}
                </a>,
                <span>
                  <code>{r.head_sha.slice(0, 7)}</code> {r.display_title}
                </span>,
                <Badge label={r.status === 'completed' ? r.conclusion ?? 'done' : r.status} {...TONES[runTone(r)]} />,
                took(r),
                ago(r.created_at),
              ])}
            />
          </>
        )}
      </Card>
      <Card title="Deployments" sub={`Argo CD application ${appName}: what it synced from git, newest first.`}>
        {argo.loading && !argo.data && <Progress />}
        {argo.error && <Typography color="text.secondary">{argo.error}</Typography>}
        {argo.data && (
          <>
            {argo.data.operation?.phase && argo.data.operation.phase !== 'Succeeded' && (
              <WarningPanel severity="warning" title={`Last operation: ${argo.data.operation.phase}`} message={argo.data.operation.message ?? ''} />
            )}
            <Table
              head={['Revision', 'Deployed', 'Took', 'By']}
              rows={argo.data.history.map(h => [<code>{(h.revision ?? '').slice(0, 7)}</code>, h.deployedAt ? `${new Date(h.deployedAt).toLocaleString()} · ${ago(h.deployedAt)}` : '', h.took !== undefined ? `${h.took} s` : '', h.by ?? ''])}
            />
            <Typography variant="body2" color="text.secondary">
              {argo.data.resources.length} resources ·{' '}
              {argo.data.resources.filter(r => r.health && r.health !== 'Healthy').length ? `not healthy: ${argo.data.resources.filter(r => r.health && r.health !== 'Healthy').map(r => `${r.kind} ${r.name}`).join(', ')}` : 'all healthy'}
            </Typography>
          </>
        )}
      </Card>
    </Box>
  );
};

/* ------------------------------------------------------------------ API */

export type Operation = { method: string; path: string; summary?: string; open: boolean };

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/**
 * The operations of an OpenAPI definition (JSON or YAML), without a YAML library: paths at two spaces, methods at
 * four, their summary and whether they declare `security: []` (no authentication).
 */
export function openApiOperations(definition: string): Operation[] {
  const text = definition.trim();
  if (text.startsWith('{')) {
    try {
      const doc = JSON.parse(text) as { paths?: Record<string, Record<string, { summary?: string; security?: unknown[] }>>; security?: unknown[] };
      return Object.entries(doc.paths ?? {}).flatMap(([path, ops]) =>
        Object.entries(ops)
          .filter(([m]) => METHODS.includes(m))
          .map(([m, op]) => ({ method: m.toUpperCase(), path, summary: op.summary, open: Array.isArray(op.security) && op.security.length === 0 })),
      );
    } catch {
      return [];
    }
  }
  const out: Operation[] = [];
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^paths:\s*$/.test(l));
  if (start < 0) return out;
  let path = '';
  let current: Operation | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key
    const p = line.match(/^ {2}(['"]?)(\/[^'":]*)\1:\s*$/);
    if (p) {
      path = p[2];
      continue;
    }
    const m = line.match(/^ {4}([a-z]+):\s*$/);
    if (m && METHODS.includes(m[1]) && path) {
      current = { method: m[1].toUpperCase(), path, open: false };
      out.push(current);
      continue;
    }
    const s = line.match(/^ {6}summary:\s*['"]?(.*?)['"]?\s*$/);
    if (s && current) current.summary = s[1];
    if (/^ {6}security:\s*\[\s*\]\s*$/.test(line) && current) current.open = true;
  }
  return out;
}

const VERB: Record<string, keyof typeof TONES> = { GET: 'info', POST: 'ok', PUT: 'warn', PATCH: 'warn', DELETE: 'bad' };

/** The entity page › API: the APIs it provides (operations, who consumes them) and the ones it consumes. */
export const EntityApiContent = () => {
  const { entity } = useEntity();
  const catalog = useApi(catalogApiRef);
  const [apis, setApis] = useState<{ provided: Entity[]; consumed: Entity[] } | undefined>();
  useEffect(() => {
    let alive = true;
    const provided = (entity.relations ?? []).filter(r => r.type === 'providesApi').map(r => r.targetRef);
    const consumed = (entity.relations ?? []).filter(r => r.type === 'consumesApi').map(r => r.targetRef);
    const refs = [...provided, ...consumed];
    (refs.length ? catalog.getEntitiesByRefs({ entityRefs: refs }) : Promise.resolve({ items: [] as Array<Entity | undefined> })).then(
      r => {
        if (!alive) return;
        const items = r.items;
        setApis({ provided: items.slice(0, provided.length).filter((x): x is Entity => !!x), consumed: items.slice(provided.length).filter((x): x is Entity => !!x) });
      },
      () => alive && setApis({ provided: [], consumed: [] }),
    );
    return () => {
      alive = false;
    };
  }, [catalog, entity]);
  if (!apis) return <Progress />;
  const link = (ref: string) => {
    const r = parseEntityRef(ref);
    return <Link to={`/console/entity/${r.namespace}/${r.kind.toLowerCase()}/${r.name}`}>{r.name}</Link>;
  };
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {apis.provided.length === 0 && apis.consumed.length === 0 && <Typography color="text.secondary">The catalog says no API it provides or consumes.</Typography>}
      {apis.provided.map(api => {
        const sp = (api.spec ?? {}) as { type?: string; definition?: string; lifecycle?: string };
        const ops = typeof sp.definition === 'string' ? openApiOperations(sp.definition) : [];
        const consumers = (api.relations ?? []).filter(r => r.type === 'apiConsumedBy').map(r => r.targetRef);
        return (
          <Box key={api.metadata.name} sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', alignItems: 'start' }}>
            <Card title={api.metadata.title ?? api.metadata.name} sub={`${sp.type ?? 'API'} · ${sp.lifecycle ?? ''} · ${ops.length} operations${ops.some(o => o.open) ? ` · ${ops.filter(o => o.open).length} without authentication` : ''}`}>
              {ops.length === 0 ? (
                <Typography color="text.secondary">Its definition has no operations the console can read.</Typography>
              ) : (
                <Box sx={{ display: 'grid' }}>
                  {ops.map(o => (
                    <Box key={`${o.method} ${o.path}`} sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.75, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', fontSize: 14 }}>
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, minWidth: 56, textAlign: 'center', borderRadius: '4px', px: 0.75, py: 0.25, bgcolor: TONES[VERB[o.method] ?? 'off'].bg, color: TONES[VERB[o.method] ?? 'off'].fg }}>
                        {o.method}
                      </Box>
                      <code>{o.path}</code>
                      <Typography component="span" variant="body2" color="text.secondary">
                        {o.summary}
                      </Typography>
                      {o.open && <Badge label="no auth" {...TONES.warn} />}
                    </Box>
                  ))}
                </Box>
              )}
              <Link to={`/console/entity/${api.metadata.namespace ?? 'default'}/api/${api.metadata.name}`}>Full definition</Link>
            </Card>
            <Card title="Who uses it" sub="Components that say they consume it (catalog).">
              {consumers.length ? (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {consumers.map(c => (
                    <Box key={c}>{link(c)}</Box>
                  ))}
                </Box>
              ) : (
                <Typography color="text.secondary">No consumer is declared.</Typography>
              )}
            </Card>
          </Box>
        );
      })}
      {apis.consumed.length > 0 && (
        <Card title="APIs it consumes">
          <Table
            head={['API', 'Type', 'Provided by']}
            rows={apis.consumed.map(api => [
              link(`api:${api.metadata.namespace ?? 'default'}/${api.metadata.name}`),
              String((api.spec as { type?: string } | undefined)?.type ?? ''),
              (api.relations ?? []).filter(r => r.type === 'apiProvidedBy').map(r => parseEntityRef(r.targetRef).name).join(', ') || '—',
            ])}
          />
        </Card>
      )}
    </Box>
  );
};
