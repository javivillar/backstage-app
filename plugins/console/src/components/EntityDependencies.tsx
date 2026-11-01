import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { Link, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import { type AppOverview, useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { rq } from './tokens';

export type DepNode = { ref: string; name: string; kind: string; title: string; sub: string; via: string; side: 'up' | 'down'; owner?: string; description?: string };
type Health = 'ok' | 'warn' | 'bad' | 'off';

/**
 * Who uses the entity (left) and what it uses (right), from the catalog: dependsOn / dependencyOf, and the APIs it
 * consumes (their providers) or provides (their consumers). `related` holds the entities of the refs.
 */
export function dependencyNodes(e: Entity, related: Map<string, Entity>): DepNode[] {
  const out: DepNode[] = [];
  const seen = new Set<string>();
  const add = (ref: string, side: 'up' | 'down', via: string) => {
    const key = `${side}:${ref}`;
    if (seen.has(key) || ref === stringifyEntityRef(e)) return;
    seen.add(key);
    const r = parseEntityRef(ref);
    const x = related.get(ref);
    const sp = (x?.spec ?? {}) as { type?: string; owner?: string };
    out.push({
      ref,
      name: r.name,
      kind: r.kind.toLowerCase(),
      title: x?.metadata.title ?? r.name,
      sub: [sp.type ?? r.kind.toLowerCase(), x?.metadata.annotations?.['refresquito.io/namespace']].filter(Boolean).join(' · '),
      via,
      side,
      owner: sp.owner,
      description: x?.metadata.description,
    });
  };
  for (const rel of e.relations ?? []) {
    if (rel.type === 'dependsOn') add(rel.targetRef, 'down', 'depends on');
    if (rel.type === 'dependencyOf') add(rel.targetRef, 'up', 'depends on it');
    if (rel.type === 'consumesApi') {
      const api = related.get(rel.targetRef);
      const providers = (api?.relations ?? []).filter(r => r.type === 'apiProvidedBy').map(r => r.targetRef);
      if (providers.length) providers.forEach(p => add(p, 'down', `API ${parseEntityRef(rel.targetRef).name}`));
      else add(rel.targetRef, 'down', 'API');
    }
    if (rel.type === 'providesApi') {
      const api = related.get(rel.targetRef);
      for (const c of (api?.relations ?? []).filter(r => r.type === 'apiConsumedBy').map(r => r.targetRef)) add(c, 'up', `API ${parseEntityRef(rel.targetRef).name}`);
    }
  }
  return out;
}

/** The state of an entity from its Argo CD application (same name, with or without -oneke). */
export function healthOf(name: string, apps: AppOverview[]): { tone: Health; label: string } {
  const a = apps.find(x => x.name === name || x.name === `${name}-oneke` || name === `${x.name}-oneke`);
  if (!a) return { tone: 'off', label: 'no Argo CD application' };
  if (a.health === 'Healthy' && a.sync === 'Synced') return { tone: 'ok', label: 'Healthy · Synced' };
  if (a.health === 'Degraded' || a.health === 'Missing') return { tone: 'bad', label: `${a.health} · ${a.sync}` };
  return { tone: 'warn', label: `${a.health} · ${a.sync}` };
}

const FILL: Record<Health, string> = { ok: TONES.ok.fg, warn: TONES.warn.fg, bad: TONES.bad.fg, off: TONES.off.fg };

/** The entity page › Dependencies: a map of who uses it and what it uses, with their state; click one for the detail. */
export const EntityDependenciesContent = () => {
  const { entity } = useEntity();
  const catalog = useApi(catalogApiRef);
  const ov = useClusterOverview();
  const paper = useTheme().palette.background.paper;
  const [related, setRelated] = useState<Map<string, Entity> | undefined>();
  const [sel, setSel] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    (async () => {
      const first = [...new Set((entity.relations ?? []).map(r => r.targetRef))];
      const a = first.length ? (await catalog.getEntitiesByRefs({ entityRefs: first })).items : [];
      const map = new Map<string, Entity>();
      a.forEach((x, i) => x && map.set(first[i], x));
      // the providers and consumers of the APIs, one hop further
      const second = [...new Set(a.flatMap(x => (x?.kind === 'API' ? (x.relations ?? []).filter(r => r.type === 'apiProvidedBy' || r.type === 'apiConsumedBy').map(r => r.targetRef) : [])))].filter(r => !map.has(r));
      if (second.length) {
        const b = (await catalog.getEntitiesByRefs({ entityRefs: second })).items;
        b.forEach((x, i) => x && map.set(second[i], x));
      }
      return map;
    })().then(
      m => alive && setRelated(m),
      () => alive && setRelated(new Map()),
    );
    return () => {
      alive = false;
    };
  }, [catalog, entity]);
  const nodes = useMemo(() => (related ? dependencyNodes(entity, related) : []), [entity, related]);
  const apps = ov.data?.apps ?? [];
  if (!related) return <Progress />;
  const up = nodes.filter(n => n.side === 'up');
  const down = nodes.filter(n => n.side === 'down');
  const selected = nodes.find(n => `${n.side}:${n.ref}` === sel) ?? down.find(n => healthOf(n.name, apps).tone !== 'ok') ?? nodes[0];
  const self = healthOf(entity.metadata.name, apps);

  const W = 980;
  const rowH = 62;
  const nodeW = 250;
  const nodeH = 46;
  const X = { up: 20, center: 365, down: 710 };
  const H = Math.max(up.length, down.length, 1) * rowH + 70;
  const cy = H / 2 + 6;
  const y = (i: number, n: number) => 46 + (H - 56 - n * rowH) / 2 + i * rowH;
  const edge = (x1: number, y1: number, x2: number, y2: number, n: DepNode) => {
    const mx = (x1 + x2) / 2;
    const on = selected && n.ref === selected.ref && n.side === selected.side;
    return (
      <g key={`e-${n.side}-${n.ref}`}>
        <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={on ? rq.blue : 'currentColor'} strokeOpacity={on ? 1 : 0.28} strokeWidth={on ? 2.2 : 1.5} />
        <text x={mx} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize={10.5} fill="currentColor" opacity={0.65} fontFamily="monospace">
          {n.via}
        </text>
      </g>
    );
  };
  const box = (n: DepNode, x: number, yy: number) => {
    const h = healthOf(n.name, apps);
    const on = selected && n.ref === selected.ref && n.side === selected.side;
    const pick = () => setSel(`${n.side}:${n.ref}`);
    return (
      <g
        key={`n-${n.side}-${n.ref}`}
        role="button"
        tabIndex={0}
        aria-label={`${n.title}: ${h.label}`}
        onClick={pick}
        onKeyDown={ev => (ev.key === 'Enter' || ev.key === ' ') && pick()}
        style={{ cursor: 'pointer' }}
      >
        <rect x={x} y={yy} width={nodeW} height={nodeH} rx={10} fill={paper} stroke={on ? rq.blue : 'currentColor'} strokeOpacity={on ? 1 : 0.25} strokeWidth={on ? 2 : 1.2} />
        <circle cx={x + 16} cy={yy + nodeH / 2} r={5} fill={FILL[h.tone]} />
        <text x={x + 30} y={yy + 19} fontSize={13} fontWeight={600} fill="currentColor">
          {n.title.length > 30 ? `${n.title.slice(0, 29)}…` : n.title}
        </text>
        <text x={x + 30} y={yy + 35} fontSize={11} fill="currentColor" opacity={0.65}>
          {n.sub.length > 36 ? `${n.sub.slice(0, 35)}…` : n.sub}
        </text>
      </g>
    );
  };
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.5 }}>
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
            Dependency map
          </Typography>
          <Typography variant="body2" color="text.secondary">
            From the catalog (dependencies and APIs), with the state of each one in Argo CD. Click a box to see the link.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Badge label="healthy" {...TONES.ok} />
          <Badge label="out of sync / progressing" {...TONES.warn} />
          <Badge label="degraded" {...TONES.bad} />
          <Badge label="not in Argo CD" {...TONES.off} />
        </Box>
        {nodes.length === 0 ? (
          <Typography color="text.secondary">The catalog says nothing it uses or that uses it (relations dependsOn, consumesApi, providesApi).</Typography>
        ) : (
          <Box sx={{ overflowX: 'auto', color: 'text.primary' }}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Dependency map of ${entity.metadata.name}`} style={{ display: 'block', minWidth: 860, width: '100%' }}>
              {[['Who uses it', X.up], ['Application', X.center], ['What it uses', X.down]].map(([t, x]) => (
                <text key={String(t)} x={Number(x)} y={22} fontSize={11} letterSpacing="0.08em" fill="currentColor" opacity={0.6}>
                  {String(t).toUpperCase()}
                </text>
              ))}
              {up.map((n, i) => edge(X.up + nodeW, y(i, up.length) + nodeH / 2, X.center, cy, n))}
              {down.map((n, i) => edge(X.center + nodeW, cy, X.down, y(i, down.length) + nodeH / 2, n))}
              {up.map((n, i) => box(n, X.up, y(i, up.length)))}
              {down.map((n, i) => box(n, X.down, y(i, down.length)))}
              <g>
                <rect x={X.center} y={cy - 34} width={nodeW} height={68} rx={12} fill="rgba(26,141,255,0.10)" stroke={rq.blue} strokeWidth={2} />
                <circle cx={X.center + 18} cy={cy} r={6} fill={FILL[self.tone]} />
                <text x={X.center + 34} y={cy - 5} fontSize={15} fontWeight={600} fill="currentColor">
                  {entity.metadata.title ?? entity.metadata.name}
                </text>
                <text x={X.center + 34} y={cy + 15} fontSize={11.5} fill="currentColor" opacity={0.65}>
                  {self.label}
                </text>
              </g>
            </svg>
          </Box>
        )}
      </Box>
      {selected && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 2 }}>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              <Link to={`/console/entity/${parseEntityRef(selected.ref).namespace}/${selected.kind}/${selected.name}`}>{selected.title}</Link>
            </Typography>
            <Box>
              <Badge label={healthOf(selected.name, apps).label} {...TONES[healthOf(selected.name, apps).tone]} />
            </Box>
            <Typography variant="body2">
              {selected.side === 'down' ? `${entity.metadata.name} ${selected.via} ${selected.name}.` : `${selected.name} uses ${entity.metadata.name} (${selected.via}).`}
            </Typography>
            {selected.description && (
              <Typography variant="body2" color="text.secondary">
                {selected.description}
              </Typography>
            )}
            {selected.owner && (
              <Typography variant="body2" color="text.secondary">
                Owner: {selected.owner.replace(/^group:(default\/)?/, '')}
              </Typography>
            )}
          </Box>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              If {entity.metadata.title ?? entity.metadata.name} fails
            </Typography>
            <Typography variant="body2">
              {up.length ? `It stops or degrades: ${up.map(n => n.title).join(', ')}.` : 'Nothing in the catalog uses it.'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {down.filter(n => healthOf(n.name, apps).tone === 'bad' || healthOf(n.name, apps).tone === 'warn').length
                ? `Not fine now among what it uses: ${down.filter(n => ['bad', 'warn'].includes(healthOf(n.name, apps).tone)).map(n => n.title).join(', ')}.`
                : 'Everything it uses is fine now.'}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
};
