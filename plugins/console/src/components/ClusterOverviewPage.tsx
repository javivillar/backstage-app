import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useConsoleConfig } from '../config';
import { Badge } from './Badge';
import { ClassicLink } from './ClassicLink';
import { rq } from './tokens';

/** The answer of GET /api/cluster/overview (backend plugin cluster). */
type Resource = { allocatable: number; requested: number; used?: number };
type NodeOverview = {
  name: string;
  ip?: string;
  roles: string[];
  kubelet?: string;
  os?: string;
  ready: boolean;
  schedulable: boolean;
  pods: number;
  cpu: Resource;
  memory: Resource;
};
type AppOverview = { name: string; namespace?: string; project?: string; sync: string; health: string; autosync: boolean };
type StorageNamespace = { namespace: string; volumes: number; requestedBytes: number; usedBytes?: number; classes: Record<string, number> };
export type ClusterOverview = { generatedAt: string; nodes: NodeOverview[]; apps: AppOverview[]; storage: StorageNamespace[] };

const ok = { bg: '#E3F4E8', fg: '#1E6B34' };
const warn = { bg: '#FFF3E0', fg: '#B45F06' };
const bad = { bg: '#FDECEA', fg: '#B3261E' };
const info = { bg: '#E0ECF7', fg: '#003D68' };

const HEALTH: Record<string, { bg: string; fg: string }> = { Healthy: ok, Progressing: info, Degraded: bad, Missing: bad };
export const healthColour = (h: string) => HEALTH[h] ?? warn;
export const syncColour = (s: string) => (s === 'Synced' ? ok : warn);
/** Problems first: not healthy, then not synced, then by name. */
export function appRank(a: AppOverview): number {
  if (a.health !== 'Healthy') return 0;
  if (a.sync !== 'Synced') return 1;
  return 2;
}

export function bytes(n: number): string {
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

function useOverview() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ClusterOverview; error?: string }>({ loading: true });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${await discovery.getBaseUrl('cluster')}/overview`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setState({ loading: false, data: body as ClusterOverview });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  }, [discovery, fetch]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

const Kpi = ({ label, value, note, colour }: { label: string; value: ReactNode; note?: ReactNode; colour?: string }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 28, fontWeight: 600, color: colour }}>{value}</Typography>
    {note && (
      <Typography variant="body2" color="text.secondary">
        {note}
      </Typography>
    )}
  </Paper>
);

const Section = ({ title, count, children }: { title: string; count?: number; children: ReactNode }) => (
  <Paper variant="outlined" component="section" sx={{ borderRadius: 2, overflow: 'hidden' }}>
    <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'baseline' }}>
      <Typography variant="h6" component="h2" sx={{ fontSize: 17, fontWeight: 600 }}>
        {title}
      </Typography>
      {count !== undefined && (
        <Typography variant="body2" color="text.secondary">
          {count}
        </Typography>
      )}
    </Box>
    <Box sx={{ overflowX: 'auto' }}>{children}</Box>
  </Paper>
);

/** Requested (solid) against allocatable, with the real use (marker) when node-exporter has it. */
const Meter = ({ r, format }: { r: Resource; format: (n: number) => string }) => {
  const req = r.allocatable ? r.requested / r.allocatable : 0;
  let colour = rq.primary;
  if (req > 0.9) colour = bad.fg;
  else if (req > 0.75) colour = warn.fg;
  return (
    <Box sx={{ minWidth: 150 }}>
      <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(req, 1) * 100}%`, bgcolor: colour }} />
        {r.used !== undefined && (
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${Math.min(r.used, 1) * 100}% - 1px)`, width: 2, bgcolor: 'text.primary' }} />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {pct(req)} requested of {format(r.allocatable)}
        {r.used !== undefined && ` · ${pct(r.used)} in use`}
      </Typography>
    </Box>
  );
};

const cell = { px: 2, py: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'left' as const, verticalAlign: 'top' as const };
const Th = ({ children }: { children?: ReactNode }) => (
  <Box component="th" sx={{ ...cell, fontWeight: 600, fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }}>
    {children}
  </Box>
);
const Td = ({ children }: { children?: ReactNode }) => (
  <Box component="td" sx={{ ...cell, fontSize: 14 }}>
    {children}
  </Box>
);

const Nodes = ({ nodes }: { nodes: NodeOverview[] }) => (
  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead>
      <tr>
        <Th>Node</Th>
        <Th>Status</Th>
        <Th>Pods</Th>
        <Th>CPU</Th>
        <Th>Memory</Th>
        <Th>Kubernetes / OS</Th>
      </tr>
    </thead>
    <tbody>
      {nodes.map(n => (
        <tr key={n.name}>
          <Td>
            <Box sx={{ fontWeight: 600 }}>{n.name}</Box>
            <Typography variant="caption" color="text.secondary">
              {[n.ip, n.roles.length ? n.roles.join(', ') : 'worker'].filter(Boolean).join(' · ')}
            </Typography>
          </Td>
          <Td>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {n.ready ? <Badge label="Ready" {...ok} /> : <Badge label="Not ready" {...bad} />}
              {!n.schedulable && <Badge label="Cordoned" {...warn} />}
            </Box>
          </Td>
          <Td>{n.pods}</Td>
          <Td>
            <Meter r={n.cpu} format={c => `${Math.round(c * 10) / 10} CPU`} />
          </Td>
          <Td>
            <Meter r={n.memory} format={bytes} />
          </Td>
          <Td>
            <Typography variant="body2">{n.kubelet ?? '—'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {n.os ?? ''}
            </Typography>
          </Td>
        </tr>
      ))}
    </tbody>
  </Box>
);

const Apps = ({ apps }: { apps: AppOverview[] }) => {
  const sorted = [...apps].sort((a, b) => appRank(a) - appRank(b) || a.name.localeCompare(b.name));
  return (
    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <Th>Application</Th>
          <Th>Health</Th>
          <Th>Sync</Th>
          <Th>Namespace</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(a => (
          <tr key={a.name}>
            <Td>
              <Box sx={{ fontWeight: 600 }}>{a.name}</Box>
            </Td>
            <Td>
              <Badge label={a.health} {...healthColour(a.health)} />
            </Td>
            <Td>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                <Badge label={a.sync} {...syncColour(a.sync)} />
                {a.autosync && <Badge outlined label="auto" />}
              </Box>
            </Td>
            <Td>
              <Typography variant="body2" color="text.secondary">
                {a.namespace ?? '—'}
              </Typography>
            </Td>
          </tr>
        ))}
      </tbody>
    </Box>
  );
};

const Storage = ({ storage }: { storage: StorageNamespace[] }) => (
  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead>
      <tr>
        <Th>Namespace</Th>
        <Th>Volumes</Th>
        <Th>Size</Th>
        <Th>Used</Th>
        <Th>Storage classes</Th>
      </tr>
    </thead>
    <tbody>
      {storage.map(s => (
        <tr key={s.namespace}>
          <Td>{s.namespace}</Td>
          <Td>{s.volumes}</Td>
          <Td>{bytes(s.requestedBytes)}</Td>
          <Td>{s.usedBytes === undefined ? '—' : bytes(s.usedBytes)}</Td>
          <Td>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {Object.entries(s.classes).map(([c, n]) => (
                <Badge key={c} outlined label={`${c} ${n}`} />
              ))}
            </Box>
          </Td>
        </tr>
      ))}
    </tbody>
  </Box>
);

/** Cluster layer: the nodes, Argo CD applications and volumes of this cluster (read from Prometheus by the backend). */
export const ClusterOverviewPage = () => {
  const cfg = useConsoleConfig();
  const { loading, data, error, reload } = useOverview();
  const where = [cfg.cluster.zone, cfg.cluster.program].filter(Boolean).join(' / ');

  const nodes = data?.nodes ?? [];
  const apps = data?.apps ?? [];
  const storage = data?.storage ?? [];
  const sum = (f: (n: NodeOverview) => number) => nodes.reduce((t, n) => t + f(n), 0);
  const ready = nodes.filter(n => n.ready).length;
  const cpuReq = sum(n => n.cpu.requested) / (sum(n => n.cpu.allocatable) || 1);
  const memReq = sum(n => n.memory.requested) / (sum(n => n.memory.allocatable) || 1);
  const unhealthy = apps.filter(a => a.health !== 'Healthy').length;
  const outOfSync = apps.filter(a => a.sync !== 'Synced').length;
  const volumes = storage.reduce((t, s) => t + s.volumes, 0);
  const storageBytes = storage.reduce((t, s) => t + s.requestedBytes, 0);

  return (
    <Box sx={{ display: 'grid', gap: 3, maxWidth: 1240 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            Cluster {cfg.cluster.id}
          </Typography>
          <Typography color="text.secondary">
            {where ? `${where} · ` : ''}
            {data ? `read from Prometheus at ${new Date(data.generatedAt).toLocaleTimeString()}` : 'read from Prometheus'}
          </Typography>
        </Box>
        <Button variant="text" onClick={reload} disabled={loading} sx={{ textTransform: 'none' }}>
          Refresh
        </Button>
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title="The overview of the cluster could not be read" message={error} />}
      {data && (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <Kpi label="Nodes ready" value={`${ready} / ${nodes.length}`} colour={ready === nodes.length ? ok.fg : bad.fg} />
            <Kpi label="CPU requested" value={pct(cpuReq)} note={`of ${Math.round(sum(n => n.cpu.allocatable))} CPU`} />
            <Kpi label="Memory requested" value={pct(memReq)} note={`of ${bytes(sum(n => n.memory.allocatable))}`} />
            <Kpi
              label="Argo CD applications"
              value={apps.length}
              note={`${unhealthy} not healthy · ${outOfSync} out of sync`}
              colour={unhealthy ? bad.fg : undefined}
            />
            <Kpi label="Volumes" value={volumes} note={bytes(storageBytes)} />
          </Box>
          <Section title="Nodes" count={nodes.length}>
            <Nodes nodes={nodes} />
          </Section>
          <Section title="Applications (Argo CD)" count={apps.length}>
            <Apps apps={apps} />
          </Section>
          <Section title="Storage by namespace" count={storage.length}>
            <Storage storage={storage} />
          </Section>
          <Section title="Backups">
            <Typography sx={{ p: 2 }} color="text.secondary">
              This cluster does not publish backup metrics yet; the disaster recovery plan of each system says how it is
              backed up. See also <ClassicLink path="/topology">Topology</ClassicLink>.
            </Typography>
          </Section>
        </>
      )}
    </Box>
  );
};
