import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useConsoleConfig } from '../config';
import { type Zone, type ZoneView, useZone, vmHref, zoneVms } from '../zone';
import { Badge } from './Badge';
import { Flow, type FlowLane, type FlowNode, TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ZoneVmRequests } from './ZoneVmRequests';
import { useLocation } from 'react-router-dom';
import { useRq } from '../theme/consoleTheme';
import { useI18n } from '../i18n';
import { Id, Kpis, TitleRow, choose } from './ui';

/** OpenNebula says ACTIVE (VM state) or RUNNING (its LCM state) for a VM that runs. */
export const vmRuns = (state: string) => state === 'ACTIVE' || state === 'RUNNING';

const vmTone = (state: string) => {
  if (vmRuns(state)) return TONES.ok;
  if (/FAIL|ERROR|UNKNOWN/.test(state)) return TONES.bad;
  return TONES.warn;
};

const ZONE_TABS: Array<[string, string]> = [
  ['nav.infrastructure', '/console/infrastructure'],
  ['nav.vms', '/console/infrastructure/vms'],
  ['nav.networks', '/console/infrastructure/networks'],
  ['nav.securityGroups', '/console/infrastructure/security-groups'],
  ['nav.templates', '/console/infrastructure/templates'],
  ['nav.zoneStorage', '/console/infrastructure/storage'],
];

/** Frame of the zone pages: title row, the tabs of the zone, freshness, errors, the zone chosen (the one of this cluster). */
export const ZoneFrame = ({ title, children, finding, actions }: { title: string; children: (zone: Zone, view: ZoneView) => ReactNode; finding?: (zone: Zone, view: ZoneView) => ReactNode; actions?: ReactNode }) => {
  const cfg = useConsoleConfig();
  const { t } = useI18n();
  const rqT = useRq();
  const { pathname } = useLocation();
  const { loading, data, error } = useZone();
  const zone = data?.zones.find(z => z.name === cfg.cluster.zone) ?? data?.zones[0];
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box>
        <TitleRow
          crumbs={[[t('nav.platform'), '/console/infrastructure/platform'], [zone ? `${t('shell.zone')} ${zone.name}` : t('shell.zone')]]}
          title={`${title} ${zone ? `of zone ${zone.name}` : ''}`.trim()}
          sub={`${t('zone.readOnly')}${data?.generated ? ` · ${t('zone.last', { time: new Date(data.generated).toLocaleString() })}` : ''}`}
          finding={data && zone && finding ? finding(zone, data) : undefined}
          actions={actions}
        />
        <Box component="nav" aria-label="Zone sections" sx={{ display: 'flex', gap: 0.5, borderBottom: `1px solid ${rqT.border}`, flexWrap: 'wrap', mt: -1 }}>
          {ZONE_TABS.map(([key, to]) => {
            const on = pathname.replace(/\/+$/, '') === to;
            return (
              <Link key={to} to={to} aria-current={on ? 'page' : undefined} style={{ padding: '8px 10px 10px', borderBottom: `2px solid ${on ? rqT.ink : 'transparent'}`, color: on ? rqT.ink : rqT.muted, fontWeight: on ? 500 : 400, textDecoration: 'none' }}>
                {t(key)}
              </Link>
            );
          })}
        </Box>
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title={t('zone.unreadable')} message={error} />}
      {data && data.warnings.length > 0 && <WarningPanel severity="info" title={t('zone.partial')} message={data.warnings.join(' · ')} />}
      {data && zone && children(zone, data)}
      {data && !zone && <Typography color="text.secondary">{t('zone.none')}</Typography>}
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

export const ZoneOverviewPage = () => {
  const { t } = useI18n();
  return (
    <ZoneFrame
      title="Infrastructure"
      finding={(zone, view) => {
        const d = view.drift.filter(x => x.zone === zone.name).length;
        const free = view.host?.availableGiB;
        return choose([[d, t('zone.finding.drift', { n: d })], [free !== undefined, t('zone.finding.free', { free: free ?? 0 })]], t('zone.finding.ok'));
      }}
    >
      {(zone, view) => {
        const vms = zoneVms(zone);
        const active = vms.filter(v => vmRuns(v.state)).length;
        const zoneDrift = view.drift.filter(d => d.zone === zone.name);
        return (
          <>
            <Kpis
              items={[
                { label: t('zone.programmes'), value: zone.programs.length },
                { label: t('zone.vmsRunning'), value: `${active} / ${vms.length}`, tone: active === vms.length ? undefined : 'bad' },
                { label: t('nav.networks'), value: zone.programs.reduce((sum, p) => sum + p.networks.length, 0) + (zone.transit ? 1 : 0) },
                { label: t('zone.diffs'), value: zoneDrift.length, tone: zoneDrift.length ? 'bad' : undefined },
                ...(view.host ? [{ label: t('zone.hostFree'), value: `${view.host.availableGiB ?? '?'} GiB`, note: `${view.host.name} · ${view.host.cpus ?? '?'} CPU · ${view.host.memoryGiB ?? '?'} GiB` }] : []),
              ]}
            />
            <Card title={t('zone.map')} sub={t('zone.mapSub')}>
              <Flow label="Zone map" lanes={zoneLanes(zone, view)} />
            </Card>
            <Card title={t('zone.diffsTitle')} sub={t('zone.diffsSub')}>
              {zoneDrift.length === 0 ? (
                <Typography color="text.secondary">{t('zone.noDiffs')}</Typography>
              ) : (
                <Table head={[t('zone.programme'), t('zone.what'), t('zone.name'), t('zone.difference')]} rows={zoneDrift.map(d => [d.program ?? 'zone', d.kind, <Id>{d.name}</Id>, d.detail])} />
              )}
            </Card>
          </>
        );
      }}
    </ZoneFrame>
  );
};

export const ZoneVmsPage = () => {
  const [text, setText] = useState('');
  const { t } = useI18n();
  return (
    <ZoneFrame title="Virtual machines" finding={zone => {
      const waiting = zoneVms(zone).filter(v => !vmRuns(v.state)).length;
      return waiting ? t('zone.finding.vms', { n: waiting }) : t('zone.finding.vmsOk');
    }}>
      {zone => {
        const q = text.trim().toLowerCase();
        // problems first: a VM that does not run comes before the ones that do
        const vms = zoneVms(zone)
          .filter(v => !q || `${v.name} ${v.program} ${v.role} ${v.ips.join(' ')}`.toLowerCase().includes(q))
          .sort((a, b) => Number(vmRuns(a.state)) - Number(vmRuns(b.state)) || a.name.localeCompare(b.name));
        return (
          <>
          <ZoneVmRequests zone={zone} />
          <Card title={t('zone.vmCount', { n: vms.length })}>
            <TextField size="small" label={t('zone.findVm')} value={text} onChange={e => setText(e.target.value)} sx={{ maxWidth: 360 }} />
            <Table
              head={['VM', t('zone.programme'), t('zone.role'), t('zone.state'), 'vCPU', t('cluster.memory'), t('zone.addresses'), 'Host']}
              rows={vms.map(v => [
                <Link to={vmHref(v.name)}>
                  <Id>{v.name}</Id>
                </Link>,
                v.program,
                v.role || '—',
                <Badge label={v.state} {...vmTone(v.state)} />,
                v.vcpu ?? '—',
                v.memoryGb !== undefined ? `${v.memoryGb} GiB` : '—',
                v.ips.length ? <Id>{v.ips.join(', ')}</Id> : '—',
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

export const ZoneNetworksPage = () => {
  const { t } = useI18n();
  return (
  <ZoneFrame title="Networks">
    {zone => {
      const rows = [
        ...(zone.transit ? [{ program: 'zone', n: zone.transit }] : []),
        ...zone.programs.flatMap(p => p.networks.map(n => ({ program: p.name, n }))),
      ];
      return (
        <Card title={t('zone.netCount', { n: rows.length })} sub={t('zone.netSub')}>
          <Table
            head={[t('zone.network'), t('zone.programme'), t('zone.role'), 'CIDR', 'VLAN', t('zone.leases'), t('zone.state')]}
            rows={rows.map(({ program, n }) => [
              <Id>{n.name}</Id>,
              program,
              n.role ?? 'transit',
              <Id>{n.cidr}</Id>,
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
};

export const ZoneSecurityGroupsPage = () => {
  const { t } = useI18n();
  return (
    <ZoneFrame title="Security groups" finding={zone => {
      const off = zone.programs.flatMap(p => p.securityGroups).filter(g => !g.exists || g.extra.length || g.missing.length).length;
      return off ? t('sg.finding', { n: off }) : t('sg.findingOk');
    }}>
      {zone => (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {zone.programs.flatMap(p =>
            p.securityGroups.map(g => (
              <Card
                key={g.name}
                title={g.name}
                sub={
                  <>
                    {t('sg.sub', { programme: p.name, role: g.role ?? '', source: g.source ?? 'OpenNebula' })}{' '}
                    {!g.exists && <Badge label={t('sg.notInOne')} {...TONES.bad} />}
                  </>
                }
              >
                <Table
                  head={[t('sg.rule'), t('sg.compared')]}
                  rows={[
                    ...g.rules.map(r => [<Id>{r}</Id>, g.extra.includes(r) ? <Badge label={t('sg.notInDesign')} {...TONES.warn} /> : <Badge label={t('sg.asDesigned')} {...TONES.ok} />]),
                    ...g.missing.map(r => [<Id>{r}</Id>, <Badge label={t('sg.missing')} {...TONES.bad} />]),
                  ]}
                />
              </Card>
            )),
          )}
        </Box>
      )}
    </ZoneFrame>
  );
};
