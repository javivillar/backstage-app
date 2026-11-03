import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { type ReactNode, useState } from 'react';
import { useConsoleConfig } from '../config';
import { certificateDays, type ClusterNetwork, identityHost, ISOLATION_TEXT, isolationTone, tlsText, useClusterNetwork, whiskerHost } from '../network';
import { Badge } from './Badge';
import { Flow, type FlowLane, TONES } from './Flow';
import { useRq } from '../theme/consoleTheme';
import { useI18n } from '../i18n';
import { Card } from './NamespaceSections';
import { Pill, TitleRow } from './ui';

const Section = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => <Card title={title} sub={sub}>{children}</Card>;

/** A plain table of the console: 12 px muted headers, light rules between rows, its own horizontal scroll. */
export const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => {
  const t = useRq();
  const cell = { px: 1.5, py: 1.25, textAlign: 'left' as const, verticalAlign: 'top' as const };
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: Math.min(560, head.length * 120), fontVariantNumeric: 'tabular-nums', '& tbody tr:hover td': { bgcolor: t.raised } }}>
        <thead>
          <tr>
            {head.map(h => (
              <Box component="th" key={h} sx={{ ...cell, py: 1, fontWeight: 500, fontSize: 12, lineHeight: '16px', color: 'text.secondary', whiteSpace: 'nowrap', borderBottom: `1px solid ${t.border}` }}>
                {h}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <Box component="td" key={j} sx={{ ...cell, borderTop: i ? `1px solid ${t.rule}` : 0 }}>
                  {c}
                </Box>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
};

export const tone = (t: keyof typeof TONES) => TONES[t];

/** The map of the cluster: entry → published hosts → segments → isolation of the namespaces. */
export function mapLanes(n: ClusterNetwork): FlowLane[] {
  const apps = n.namespaces.filter(x => !x.system);
  const count = (i: string) => apps.filter(x => x.isolation === i).length;
  const tls = n.hosts.filter(h => h.tls).length;
  const id = identityHost(n);
  const days = certificateDays(n);
  const certSub = days === undefined ? 'cluster certificate: expiry unknown' : `cluster certificate: ${days} days left`;
  return [
    {
      label: 'Entry',
      nodes: [
        { title: 'VNF · VIP', sub: 'OneKE load balancer: seen from the zone console', tone: 'off', dashed: true },
        n.entry
          ? { title: 'Traefik', sub: `${n.entry.service} · ports ${n.entry.ports.join(', ')}`, state: 'Running', tone: 'ok' }
          : { title: 'Traefik', sub: 'service not found', state: 'Unknown', tone: 'warn' },
      ],
    },
    {
      label: 'Published hosts',
      nodes: [
        { title: `${n.hosts.length} hosts`, sub: `${tls} with TLS · ${certSub}`, state: tls === n.hosts.length && (days ?? 99) >= 21 ? 'OK' : 'Review', tone: tls === n.hosts.length && (days ?? 99) >= 21 ? 'ok' : 'warn' },
        ...(id ? [{ title: 'Keycloak', sub: id, state: 'Login', tone: 'info' as const }] : []),
      ],
    },
    {
      label: 'Segments (Calico)',
      grow: 1.4,
      nodes: n.segments.map(s => ({
        title: s.name,
        sub: `${s.namespaces} namespace${s.namespaces === 1 ? '' : 's'} · ${s.policy ?? 'no policy'}`,
        state: s.enforced ? 'Enforced' : 'Pass-through',
        tone: s.enforced ? ('ok' as const) : ('warn' as const),
      })),
    },
    {
      label: 'Namespaces (NetworkPolicy)',
      nodes: [
        { title: `${count('isolated')} isolated`, sub: 'every pod behind a policy', tone: 'ok' },
        { title: `${count('partial')} partly isolated`, sub: 'some pods behind a policy', tone: 'info' },
        { title: `${count('open')} open to the cluster`, sub: 'no ingress policy', state: count('open') ? 'Review' : 'OK', tone: count('open') ? 'warn' : 'ok' },
      ],
    },
  ];
}

/** Cluster layer › Network: how this cluster is reached and isolated, read live from Kubernetes and Calico. */
export const NetworkPage = () => {
  const cfg = useConsoleConfig();
  const { loading, data, error, reload } = useClusterNetwork();
  const [tab, setTab] = useState<'map' | 'hosts' | 'isolation'>('map');
  const [system, setSystem] = useState(false);
  const whisker = data && whiskerHost(data);
  const { t } = useI18n();
  const rqT = useRq();
  const tabs: Array<[typeof tab, string]> = [
    ['map', t('net.map')],
    ['hosts', t('net.hosts')],
    ['isolation', t('net.isolation')],
  ];
  const apps = data ? data.namespaces.filter(x => !x.system) : [];
  const open = apps.filter(x => x.isolation === 'open').length;
  const passThrough = data ? data.segments.filter(x => !x.enforced).length : 0;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[cfg.cluster.id, '/console/cluster'], [t('net.crumb')]]}
        title={t('net.title', { cluster: cfg.cluster.id })}
        pills={data && <Pill tone={open ? 'warn' : 'pos'}>{t('net.open', { n: open })}</Pill>}
        sub={data ? t('net.readAt', { time: new Date(data.generatedAt).toLocaleTimeString() }) : t('net.read')}
        finding={data && (passThrough ? t('net.finding.pass', { n: passThrough, open }) : t('net.finding.ok'))}
        findingTone={passThrough || open ? 'warn' : 'pos'}
        actions={
          <>
            <Button variant="text" onClick={reload} disabled={loading}>
              {t('cluster.refresh')}
            </Button>
            {whisker && (
              <Button variant="contained" href={`https://${whisker}`} target="_blank" rel="noreferrer">
                Live flows in Calico Whisker
              </Button>
            )}
          </>
        }
      />
      <Box component="nav" aria-label="Network views" sx={{ display: 'flex', gap: 0.5, borderBottom: `1px solid ${rqT.border}`, flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            variant="text"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            sx={{ borderRadius: 0, borderBottom: 2, borderColor: tab === id ? rqT.ink : 'transparent', color: tab === id ? 'text.primary' : 'text.secondary', fontWeight: tab === id ? 500 : 400, '&:hover': { bgcolor: 'transparent', color: 'text.primary' } }}
          >
            {label}
          </Button>
        ))}
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title="The network of the cluster could not be read" message={error} />}
      {data && data.warnings.length > 0 && <WarningPanel severity="info" title="Part of the network could not be read" message={data.warnings.join(' · ')} />}
      {data && tab === 'map' && (
        <Section title="Cluster map" sub="Each request enters through the VNF, Traefik picks the namespace by host name, and the policies decide who else can talk to it.">
          <Flow label="Cluster map" lanes={mapLanes(data)} />
        </Section>
      )}
      {data && tab === 'hosts' && (
        <Section title="Published hosts" sub="Every Ingress of the cluster. They share the address of the cluster; Traefik routes by name.">
          <Table
            head={['Host', 'Namespace', 'Service', 'TLS']}
            rows={data.hosts.map(h => [
              <a href={`https://${h.host}`} target="_blank" rel="noreferrer" style={{ color: rqT.data }}>
                {h.host}
              </a>,
              h.namespace,
              h.service ?? '—',
              <Badge label={tlsText(h)} {...tone(h.tls ? 'ok' : 'warn')} />,
            ])}
          />
        </Section>
      )}
      {data && tab === 'isolation' && (
        <Section
          title="Isolation by namespace"
          sub={
            <FormControlLabel control={<Switch size="small" checked={system} onChange={e => setSystem(e.target.checked)} />} label="Show the namespaces of the cluster itself" />
          }
        >
          <Table
            head={['Namespace', 'Segment', 'Isolation', 'Policies', 'Pods ready']}
            rows={data.namespaces
              .filter(x => system || !x.system)
              .map(x => [
                <Link to={`/console/namespaces/${x.name}`}>{x.name}</Link>,
                x.segment ?? '—',
                <Badge label={ISOLATION_TEXT[x.isolation]} {...tone(isolationTone(x.isolation))} />,
                x.policies.length ? x.policies.map(p => p.name).join(', ') : '—',
                x.pods ? `${x.pods.ready} / ${x.pods.total}` : '—',
              ])}
          />
        </Section>
      )}
    </Box>
  );
};
