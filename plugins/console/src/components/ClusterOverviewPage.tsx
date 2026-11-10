import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useConsoleConfig } from '../config';
import { type AppOverview, type NodeOverview, type Resource, type StorageNamespace, useClusterOverview } from '../overview';
import { ClassicLink } from './ClassicLink';
import { NeedsAttention } from './NeedsAttention';
import { OpsActions } from './OpsActions';
import { type InfraView, useInfra, useZone } from '../zone';
import { useNamespaceCosts } from '../costs';

export type { ClusterOverview } from '../overview';
import { useRq } from '../theme/consoleTheme';
import { useI18n } from '../i18n';
import { Id, Kpis, Pill, Row, Section, TitleRow, choose, type Tone } from './ui';
import { ActionsMenu, Sub, Table, UseMeter, healthTone, syncTone } from './ui-infra';
import { ClusterArchitecture } from './ClusterArchitecture';
import { PageTabs, useTab } from './ZoneInventoryPages';


const ok = { bg: '#dcfae5', fg: '#04250e' };
const warn = { bg: '#fff6e0', fg: '#7a3a06' };
const bad = { bg: '#ffedea', fg: '#831c1e' };
const info = { bg: '#d6e3f3', fg: '#0c4595' };

const HEALTH: Record<string, { bg: string; fg: string }> = { Healthy: ok, Progressing: info, Degraded: bad, Missing: bad };
/** @deprecated use healthTone (ui-infra) with Pill */
export const healthColour = (h: string) => HEALTH[h] ?? warn;
/** @deprecated use syncTone (ui-infra) with Pill */
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

const Meter = ({ r, format }: { r: Resource; format: (n: number) => string }) => {
  const { t } = useI18n();
  const req = r.allocatable ? r.requested / r.allocatable : 0;
  return (
    <UseMeter
      requested={r.requested}
      capacity={r.allocatable}
      used={r.used}
      label={`${t('cluster.requestedOf', { pct: pct(req), cap: format(r.allocatable) })}${r.used !== undefined ? ` · ${t('cluster.inUse', { pct: pct(r.used) })}` : ''}`}
    />
  );
};

const Nodes = ({ nodes }: { nodes: NodeOverview[] }) => {
  const { t } = useI18n();
  return (
    <Table head={[t('cluster.node'), t('cluster.status'), [t('cluster.pods'), 'r'], 'CPU', t('cluster.memory'), t('cluster.k8sOs')]}>
      {nodes.map(n => (
        <tr key={n.name}>
          <td>
            <Id>{n.name}</Id>
            <Sub>{[n.ip, n.roles.length ? n.roles.join(', ') : 'worker'].filter(Boolean).join(' · ')}</Sub>
          </td>
          <td>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {n.ready ? <Pill tone="pos">Ready</Pill> : <Pill tone="neg">Not ready</Pill>}
              {!n.schedulable && <Pill tone="warn">Cordoned</Pill>}
            </Box>
          </td>
          <td className="r">{n.pods}</td>
          <td>
            <Meter r={n.cpu} format={c => `${Math.round(c * 10) / 10} CPU`} />
          </td>
          <td>
            <Meter r={n.memory} format={bytes} />
          </td>
          <td>
            {n.kubelet ?? '—'}
            <Sub>{n.os ?? ''}</Sub>
          </td>
        </tr>
      ))}
    </Table>
  );
};

const Apps = ({ apps }: { apps: AppOverview[] }) => {
  const { t } = useI18n();
  const sorted = [...apps].sort((a, b) => appRank(a) - appRank(b) || a.name.localeCompare(b.name));
  return (
    <Table head={[t('cluster.application'), t('cluster.health'), t('cluster.sync'), t('cluster.namespace')]}>
      {sorted.map(a => (
        <tr key={a.name}>
          <td>
            <Box component="span" sx={{ fontWeight: 500 }}>
              {a.name}
            </Box>
          </td>
          <td>
            <Pill tone={healthTone(a.health)}>{a.health}</Pill>
          </td>
          <td>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <Pill tone={syncTone(a.sync)}>{a.sync}</Pill>
              {a.autosync && <Pill plain>auto</Pill>}
            </Box>
          </td>
          <td>{a.namespace ? <Link to={`/console/namespaces/${a.namespace}`}><Id>{a.namespace}</Id></Link> : '—'}</td>
        </tr>
      ))}
    </Table>
  );
};

const Storage = ({ storage }: { storage: StorageNamespace[] }) => {
  const { t } = useI18n();
  return (
    <Table head={[t('cluster.namespace'), [t('cluster.volumes'), 'r'], [t('cluster.size'), 'r'], [t('cluster.used'), 'r'], t('cluster.classes')]}>
      {storage.map(s => (
        <tr key={s.namespace}>
          <td>
            <Id>{s.namespace}</Id>
          </td>
          <td className="r">{s.volumes}</td>
          <td className="r">{bytes(s.requestedBytes)}</td>
          <td className="r">{s.usedBytes === undefined ? '—' : bytes(s.usedBytes)}</td>
          <td>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {Object.entries(s.classes).map(([c, n]) => (
                <Pill key={c} plain>{`${c} ${n}`}</Pill>
              ))}
            </Box>
          </td>
        </tr>
      ))}
    </Table>
  );
};

/** The namespaces that cost most in the last 7 days (OpenCost, our prices), each linked to its page. */
const TopCosts = () => {
  const { costs, money } = useNamespaceCosts('7d');
  const { t } = useI18n();
  const rqT = useRq();
  if (!costs?.length) return null;
  const top = costs.slice(0, 5);
  const max = top[0].total || 1;
  return (
    <Section title={t('cluster.topCosts')} meta={costs.length}>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {top.map(c => (
          <Box key={c.namespace} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 2fr) minmax(0, 3fr) auto' }, gap: 1.5, alignItems: 'center' }}>
            <Link to={`/console/namespaces/${c.namespace}`} style={{ overflowWrap: 'anywhere' }}>
              {c.namespace}
            </Link>
            <Box sx={{ height: 6, borderRadius: 3, bgcolor: rqT.rule, overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${(c.total / max) * 100}%`, bgcolor: rqT.data }} />
            </Box>
            <Box component="span" sx={{ fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {money(c.total)}
            </Box>
          </Box>
        ))}
        <Typography variant="caption" color="text.secondary">
          {t('cluster.costNote')} <Link to="/console/costs">{t('cluster.allCosts')}</Link>
        </Typography>
      </Box>
    </Section>
  );
};

const TABS = ['summary', 'architecture'] as const;

/**
 * Cluster layer: the nodes, Argo CD applications and volumes of this cluster (read from Prometheus by the backend).
 * Its Architecture tab draws what is deployed by the bands of the catalogue (ClusterArchitecture).
 */
export const ClusterOverviewPage = () => {
  const cfg = useConsoleConfig();
  const [tab, setTab] = useTab(TABS);
  const { loading, data, error, reload } = useClusterOverview();
  const infra = useInfra();
  const zoneView = useZone();
  const { zone, program } = cfg.cluster;
  const own = !!zone && !!program && (infra.data?.admins ?? [`${zone}/${program}`]).includes(`${zone}/${program}`);
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

  const { t } = useI18n();
  const nodesOk = ready === nodes.length;
  const finding = data
    ? choose(
        [
          [unhealthy, t('cluster.finding.unhealthy', { n: unhealthy, sync: outOfSync })],
          [outOfSync, t('cluster.finding.outOfSync', { n: outOfSync })],
          [nodesOk, t('cluster.finding.ok')],
        ],
        t('cluster.finding.nodes', { n: nodes.length - ready }),
      )
    : undefined;

  return (
    <Box sx={{ maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[t('cluster.crumb')], [cfg.cluster.id]]}
        title={`Cluster ${cfg.cluster.id}`}
        pills={data && <Pill tone={unhealthy ? 'warn' : 'pos'}>{unhealthy ? t('cluster.appsNotHealthy', { n: unhealthy }) : t('cluster.allHealthy')}</Pill>}
        sub={`${where ? `${where} · ` : ''}${data ? t('cluster.readAt', { time: new Date(data.generatedAt).toLocaleTimeString() }) : t('cluster.read')}`}
        finding={finding}
        findingTone={choose<Tone>([[unhealthy || !nodesOk, 'neg'], [outOfSync, 'warn']], 'pos')}
        actions={
          <>
            <Button variant="text" onClick={reload} disabled={loading}>
              {t('cluster.refresh')}
            </Button>
            {zone && program && (
              <ActionsMenu label={t('cluster.actions')}>
                <OpsActions target={{ zone, program }} allowed={!!infra.data?.allowed} own={own} results={(zoneView.data as InfraView | undefined)?.reconcile?.actions} onDone={zoneView.reload} />
              </ActionsMenu>
            )}
            <Button variant="contained" component={Link as any} to="/console/applications">
              {t('cluster.openApps')}
            </Button>
          </>
        }
      />
      {loading && !data && <Progress />}
      {error && <WarningPanel title={t('cluster.unreadable')} message={error} />}
      {data && (
        <Box sx={{ mb: 2.5 }}>
          <PageTabs label={t('nav.overview')} tab={tab} onChange={setTab} tabs={TABS.map(k => [k, t(`ic.tab.${k}`)])} />
        </Box>
      )}
      {data && tab === 'architecture' && (
        <ClusterArchitecture overview={data} vip={(zoneView.data as InfraView | undefined)?.zones.find(z => z.name === zone)?.programs.find(p => p.name === program)?.cluster?.vip} />
      )}
      {data && tab === 'summary' && (
        <>
          <Kpis
            items={[
              { label: t('cluster.nodesReady'), value: `${ready} / ${nodes.length}`, tone: nodesOk ? undefined : 'bad' },
              { label: t('cluster.cpuRequested'), value: pct(cpuReq), note: t('cluster.ofCpu', { n: Math.round(sum(n => n.cpu.allocatable)) }) },
              { label: t('cluster.memRequested'), value: pct(memReq), note: t('cluster.of', { v: bytes(sum(n => n.memory.allocatable)) }) },
              { label: t('cluster.argoApps'), value: apps.length, note: t('cluster.appsNote', { bad: unhealthy, sync: outOfSync }), tone: unhealthy ? 'bad' : undefined },
              { label: t('cluster.volumes'), value: volumes, note: bytes(storageBytes) },
            ]}
          />
          <Box sx={{ mb: 3 }}>
            <NeedsAttention />
          </Box>
          <Section title={t('cluster.nodes')} meta={nodes.length} flush>
            <Nodes nodes={nodes} />
          </Section>
          <Section title={t('cluster.appsArgo')} meta={apps.length} flush>
            <Apps apps={apps} />
          </Section>
          <Row spans={[7, 5]}>
            <Section title={t('cluster.storageByNs')} meta={storage.length} flush>
              <Storage storage={storage} />
            </Section>
            <Box>
              <TopCosts />
              <Section title={t('cluster.backups')}>
                <Typography color="text.secondary">
                  {t('cluster.backupsNote')} <ClassicLink path="/topology">Topology</ClassicLink>.
                </Typography>
              </Section>
            </Box>
          </Row>
        </>
      )}
    </Box>
  );
};
