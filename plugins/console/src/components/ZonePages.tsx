import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useConsoleConfig } from '../config';
import { type Zone, type ZoneView, useZone, zoneVms } from '../zone';
import { Badge } from './Badge';
import { Flow, type FlowLane, type FlowNode, TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ZoneVmRequests } from './ZoneVmRequests';

/** OpenNebula says ACTIVE (VM state) or RUNNING (its LCM state) for a VM that runs. */
export const vmRuns = (state: string) => state === 'ACTIVE' || state === 'RUNNING';

const vmTone = (state: string) => {
  if (vmRuns(state)) return TONES.ok;
  if (/FAIL|ERROR|UNKNOWN/.test(state)) return TONES.bad;
  return TONES.warn;
};

/** Frame of the zone pages: title, freshness, errors, the zone chosen (the one of this cluster). */
const ZoneFrame = ({ title, children }: { title: string; children: (zone: Zone, view: ZoneView) => ReactNode }) => {
  const cfg = useConsoleConfig();
  const { loading, data, error } = useZone();
  const zone = data?.zones.find(z => z.name === cfg.cluster.zone) ?? data?.zones[0];
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {title} {zone ? `of zone ${zone.name}` : ''}
        </Typography>
        <Typography color="text.secondary">
          Read-only, as the OpenNebula host publishes it every 5 minutes{data?.generated ? ` · last ${new Date(data.generated).toLocaleString()}` : ''}.
        </Typography>
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title="The zone could not be read" message={error} />}
      {data && data.warnings.length > 0 && <WarningPanel severity="info" title="The host could not read everything" message={data.warnings.join(' · ')} />}
      {data && zone && children(zone, data)}
      {data && !zone && <Typography color="text.secondary">The host publishes no zone in use.</Typography>}
    </Box>
  );
};

const routerTone = (exists: boolean, state: string): FlowNode['tone'] => {
  if (!exists) return 'bad';
  return vmRuns(state) ? 'ok' : 'warn';
};

const networkState = (n: { exists: boolean; drift: string[] }) => {
  if (!n.exists) return <Badge label="Not in OpenNebula" {...TONES.bad} />;
  if (n.drift.length) return <Badge label={n.drift.join('; ')} {...TONES.warn} />;
  return <Badge label="OK" {...TONES.ok} />;
};

export function zoneLanes(zone: Zone, view: ZoneView): FlowLane[] {
  const host = view.host;
  const routerState = zone.router?.vms[0]?.state ?? (zone.router?.exists ? 'ACTIVE' : 'missing');
  return [
    {
      label: 'Host',
      nodes: host
        ? [{ title: host.name, sub: `${host.cpus ?? '?'} CPU · ${host.memoryGiB ?? '?'} GiB (${host.availableGiB ?? '?'} free)`, state: 'Running', tone: 'ok' }]
        : [{ title: 'Host', sub: 'not published', tone: 'off' }],
    },
    {
      label: `Zone ${zone.name}`,
      nodes: [
        zone.transit
          ? { title: zone.transit.name, sub: `transit ${zone.transit.cidr}`, state: zone.transit.exists ? 'OK' : 'Missing', tone: zone.transit.exists ? 'ok' : 'bad' }
          : { title: 'Transit', sub: 'not declared', tone: 'off' },
        zone.router
          ? { title: zone.router.name, sub: 'zone router', state: routerState, tone: routerTone(zone.router.exists, routerState) }
          : { title: 'Zone router', sub: 'not declared', tone: 'off' },
      ],
    },
    {
      label: 'Programmes',
      grow: 1.3,
      nodes: zone.programs.map(p => {
        const drift = p.networks.some(n => !n.exists || n.drift.length) || p.securityGroups.some(g => !g.exists || g.extra.length || g.missing.length);
        let tone: FlowNode['tone'] = p.ok ? 'ok' : 'warn';
        if (drift) tone = 'warn';
        return {
          title: p.name,
          sub: p.networks.map(n => `${n.role ?? ''} ${n.cidr}`.trim()).join(' · '),
          state: drift ? 'Drift' : p.status.split(' ')[0] || 'OK',
          tone,
        };
      }),
    },
    {
      label: 'Clusters',
      grow: 1.3,
      nodes: zone.programs.map(p =>
        p.cluster
          ? {
              title: p.cluster.name,
              sub: `VIP ${p.cluster.vip ?? '?'} · ${Object.entries(p.cluster.roles).map(([r, n]) => `${n} ${r}`).join(' · ')}`,
              state: p.cluster.state,
              tone: /RUNNING/.test(p.cluster.state) ? ('ok' as const) : ('warn' as const),
            }
          : { title: `${p.name}: no cluster`, sub: 'declared only', tone: 'off' as const, dashed: true },
      ),
    },
  ];
}

export const ZoneOverviewPage = () => (
  <ZoneFrame title="Infrastructure">
    {(zone, view) => {
      const vms = zoneVms(zone);
      const active = vms.filter(v => vmRuns(v.state)).length;
      const kpi = (label: string, value: string, tone?: keyof typeof TONES) => (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone ? TONES[tone].fg : undefined }}>{value}</Typography>
        </Paper>
      );
      const zoneDrift = view.drift.filter(d => d.zone === zone.name);
      return (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {kpi('Programmes', String(zone.programs.length))}
            {kpi('VMs running', `${active} / ${vms.length}`, active === vms.length ? 'ok' : 'warn')}
            {kpi('Networks', String(zone.programs.reduce((t, p) => t + p.networks.length, 0) + (zone.transit ? 1 : 0)))}
            {kpi('Differences with the design', String(zoneDrift.length), zoneDrift.length ? 'warn' : 'ok')}
          </Box>
          <Card title="Zone map" sub="From the host to the clusters of each programme. Orange: what differs from network.toml.">
            <Flow label="Zone map" lanes={zoneLanes(zone, view)} />
          </Card>
          <Card title="Differences with the design" sub="network.toml (git) against what OpenNebula has.">
            {zoneDrift.length === 0 ? (
              <Typography color="text.secondary">None: OpenNebula has what the design says.</Typography>
            ) : (
              <Table head={['Programme', 'What', 'Name', 'Difference']} rows={zoneDrift.map(d => [d.program ?? 'zone', d.kind, <b>{d.name}</b>, d.detail])} />
            )}
          </Card>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Link to="/console/infrastructure/vms">Virtual machines</Link>
            <Link to="/console/infrastructure/networks">Networks</Link>
            <Link to="/console/infrastructure/security-groups">Security groups</Link>
          </Box>
        </>
      );
    }}
  </ZoneFrame>
);

export const ZoneVmsPage = () => {
  const [text, setText] = useState('');
  return (
    <ZoneFrame title="Virtual machines">
      {zone => {
        const t = text.trim().toLowerCase();
        const vms = zoneVms(zone).filter(v => !t || `${v.name} ${v.program} ${v.role} ${v.ips.join(' ')}`.toLowerCase().includes(t));
        return (
          <>
          <ZoneVmRequests zone={zone} />
          <Card title={`${vms.length} VMs`}>
            <TextField size="small" label="Find a VM, programme or address" value={text} onChange={e => setText(e.target.value)} sx={{ maxWidth: 360 }} />
            <Table
              head={['VM', 'Programme', 'Role', 'State', 'vCPU', 'Memory', 'Addresses', 'Host']}
              rows={vms.map(v => [
                <b>{v.name}</b>,
                v.program,
                v.role || '—',
                <Badge label={v.state} {...vmTone(v.state)} />,
                v.vcpu ?? '—',
                v.memoryGb !== undefined ? `${v.memoryGb} GiB` : '—',
                v.ips.join(', ') || '—',
                v.host ?? '—',
              ])}
            />
          </Card>
          </>
        );
      }}
    </ZoneFrame>
  );
};

export const ZoneNetworksPage = () => (
  <ZoneFrame title="Networks">
    {zone => {
      const rows = [
        ...(zone.transit ? [{ program: 'zone', n: zone.transit }] : []),
        ...zone.programs.flatMap(p => p.networks.map(n => ({ program: p.name, n }))),
      ];
      return (
        <Card title={`${rows.length} networks`} sub="VLANs of the zone; leases are the addresses OpenNebula has handed out.">
          <Table
            head={['Network', 'Programme', 'Role', 'CIDR', 'VLAN', 'Leases', 'State']}
            rows={rows.map(({ program, n }) => [
              <b>{n.name}</b>,
              program,
              n.role ?? 'transit',
              n.cidr,
              String(n.vlan ?? '—'),
              String(n.leases),
              networkState(n),
            ])}
          />
        </Card>
      );
    }}
  </ZoneFrame>
);

export const ZoneSecurityGroupsPage = () => (
  <ZoneFrame title="Security groups">
    {zone => (
      <Box sx={{ display: 'grid', gap: 2 }}>
        {zone.programs.flatMap(p =>
          p.securityGroups.map(g => (
            <Card
              key={g.name}
              title={g.name}
              sub={
                <>
                  Programme {p.name} · {g.role ?? ''} network · rules from {g.source ?? 'OpenNebula'}{' '}
                  {!g.exists && <Badge label="Not in OpenNebula" {...TONES.bad} />}
                </>
              }
            >
              <Table
                head={['Rule', 'Compared with the design']}
                rows={[
                  ...g.rules.map(r => [r, g.extra.includes(r) ? <Badge label="Not in the design" {...TONES.warn} /> : <Badge label="As designed" {...TONES.ok} />]),
                  ...g.missing.map(r => [r, <Badge label="Missing (the design has it)" {...TONES.bad} />]),
                ]}
              />
            </Card>
          )),
        )}
      </Box>
    )}
  </ZoneFrame>
);
