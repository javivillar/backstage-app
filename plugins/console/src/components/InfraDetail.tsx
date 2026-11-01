import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useClusterPost } from '../post';
import { consoleVmName, type InfraView, pullTarget, useInfra, useVmRequests, useZone, vmHref, vmStatus, type ZoneVm } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ConfirmBar, RequestsTable, ResultNote, useChange } from './Requests';
import { OpsActions } from './OpsActions';
import { vmRuns } from './ZonePages';


const Frame = ({ title, sub, back, children }: { title: string; sub?: ReactNode; back: { to: string; label: string }; children: ReactNode }) => (
  <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
    <Box>
      <Link to={back.to}>← {back.label}</Link>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mt: 0.5 }}>
        {title}
      </Typography>
      {sub && <Typography color="text.secondary" component="div">{sub}</Typography>}
    </Box>
    {children}
  </Box>
);

const Facts = ({ items }: { items: Array<[string, ReactNode]> }) => (
  <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 1.5, m: 0 }}>
    {items.map(([k, v]) => (
      <Box key={k} sx={{ minWidth: 0 }}>
        <Typography component="dt" variant="caption" color="text.secondary">
          {k}
        </Typography>
        <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
          {v === undefined || v === '' ? '—' : v}
        </Typography>
      </Box>
    ))}
  </Box>
);

function vmTone(state: string) {
  if (vmRuns(state)) return TONES.ok;
  return /FAIL|ERROR|UNKNOWN/.test(state) ? TONES.bad : TONES.warn;
}

function keepReason(own: boolean, cluster: boolean, vms: number): string {
  if (own) return 'This is the programme of this console.';
  if (cluster) return 'Delete its cluster first.';
  if (vms) return 'Delete its VMs first.';
  return 'Only backstage-admin can remove it.';
}

/** Infrastructure › Platform › a programme: its networks, security groups, router, cluster and VMs; remove it. */
export const ProgrammePage = () => {
  const { zone: zoneName = '', program = '' } = useParams();
  const { loading, data, error, reload } = useZone();
  const infra = useInfra();
  const post = useClusterPost();
  const navigate = useNavigate();
  const { note, busy, run } = useChange(() => { reload(); infra.reload(); });
  const [confirm, setConfirm] = useState(false);
  const view = data as InfraView | undefined;
  const id = `${zoneName}/${program}`;
  const zone = view?.zones.find(z => z.name === zoneName);
  const prog = zone?.programs.find(p => p.name === program);
  const declared = view?.catalog?.find(c => c.name === zoneName)?.programs.find(p => p.name === program);
  const own = (infra.data?.admins ?? []).includes(id);
  const vms = (prog?.vms ?? []).filter(v => v.role !== 'zone router');
  const removable = !!infra.data?.allowed && !own && !prog?.cluster && vms.length === 0;
  const mine = (p: { body?: string }) => {
    const t = pullTarget(p as never);
    return t.zone === zoneName && t.program === program;
  };
  return (
    <Frame title={`Programme ${id}`} back={{ to: '/console/infrastructure/platform', label: 'Platform' }} sub={prog ? `${prog.status}${declared?.n ? ` · n=${declared.n}` : ''}` : undefined}>
      {loading && !view && <Progress />}
      {error && <WarningPanel title="The platform could not be read" message={error} />}
      {view && !prog && (
        <WarningPanel
          severity="info"
          title={declared ? 'Declared, not created yet' : 'Not found'}
          message={declared ? 'It is in network.toml; the host creates it within 5 minutes of the merge (see Requests on Platform).' : `There is no programme ${id} in the topology the host publishes.`}
        />
      )}
      {prog && (
        <>
          <Card title="Networks" sub="Created by the host from network.toml: the public network (its cluster VIP, published services) and the private one (nodes and VMs).">
            <Table
              head={['Network', 'Role', 'Subnet', 'VLAN', 'Leases', 'State']}
              rows={prog.networks.map(n => [
                <b>{n.name}</b>,
                n.role ?? '',
                n.cidr,
                String(n.vlan ?? ''),
                String(n.leases),
                n.exists ? <Badge label={n.drift.length ? n.drift.join('; ') : 'Created'} {...TONES[n.drift.length ? 'warn' : 'ok']} /> : <Badge label="Not in OpenNebula" {...TONES.bad} />,
              ])}
            />
          </Card>
          <Card title="Security groups">
            <Table
              head={['Group', 'Role', 'Rules', 'State']}
              rows={prog.securityGroups.map(g => [
                <b>{g.name}</b>,
                g.role ?? '',
                <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-line' }}>
                  {g.rules.join('\n') || '—'}
                </Typography>,
                g.exists ? <Badge label={g.extra.length || g.missing.length ? 'Differs from the design' : 'Created'} {...TONES[g.extra.length || g.missing.length ? 'warn' : 'ok']} /> : <Badge label="Not in OpenNebula" {...TONES.bad} />,
              ])}
            />
          </Card>
          <Card title={`Zone ${zoneName}`} sub="Shared by every programme of the zone: the transit network to this host and the zone router.">
            <Facts
              items={[
                ['Transit', zone?.transit ? `${zone.transit.name} · ${zone.transit.cidr}` : 'not declared'],
                ['Zone router', zone?.router ? <Badge label={`${zone.router.name}: ${zone.router.vms[0]?.state ?? 'no VM yet'}`} {...vmTone(zone.router.vms[0]?.state ?? 'PENDING')} /> : 'not declared'],
              ]}
            />
          </Card>
          <Card title="Kubernetes cluster">
            {prog.cluster ? (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge label={prog.cluster.state} {...TONES[/RUNNING/.test(prog.cluster.state) ? 'ok' : 'warn']} />
                <Typography>
                  <b>{prog.cluster.name}</b> · {Object.entries(prog.cluster.roles ?? {}).map(([r, n]) => `${n} ${r}`).join(' · ')}
                  {prog.cluster.vip ? ` · VIP ${prog.cluster.vip}` : ''}
                </Typography>
                <Button component={Link} to={`/console/infrastructure/clusters/${zoneName}/${program}`} sx={{ textTransform: 'none' }}>
                  Scale
                </Button>
                <OpsActions target={{ zone: zoneName, program }} allowed={!!infra.data?.allowed} own={own} results={view?.reconcile?.actions} onDone={reload} />
              </Box>
            ) : (
              <Typography color="text.secondary">
                No cluster. <Link to="/console/infrastructure/marketplace">Create one from the Marketplace</Link>.
              </Typography>
            )}
          </Card>
          <Card title="Virtual machines">
            {vms.length === 0 ? (
              <Typography color="text.secondary">None.</Typography>
            ) : (
              <Table
                head={['VM', 'Role', 'Addresses', 'State']}
                rows={vms.map(v => [<Link to={vmHref(v.name)}>{v.name}</Link>, v.role, v.ips.join(', '), <Badge label={v.state} {...vmTone(v.state)} />])}
              />
            )}
          </Card>
          <Card title="Requests" sub="What was asked from the console for this programme in the last 7 days.">
            <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={view?.reconcile} only={mine} />
          </Card>
          <Card title="Remove the segregation" sub="A pull request removes it from network.toml; once merged, the host destroys its networks, security groups, group and VDC. Only a programme without cluster and VMs, and never the one of this console.">
            <Box>
              <Button variant="outlined" color="error" disabled={!removable || busy} onClick={() => setConfirm(true)} sx={{ textTransform: 'none' }}>
                Remove {id}
              </Button>
            </Box>
            {!removable && infra.data && (
              <Typography variant="body2" color="text.secondary">
                {keepReason(own, !!prog.cluster, vms.length)}
              </Typography>
            )}
            {confirm && (
              <ConfirmBar
                text={`Remove ${id}? Once the pull request is merged, its networks and security groups are destroyed. It cannot be undone.`}
                onYes={() => {
                  setConfirm(false);
                  run(() => post('/infra/segregations/delete', { zone: zoneName, program }), a => `Pull request #${a.pull?.number} opened: once merged, the host removes ${id}.`).then(ok => ok && navigate('/console/infrastructure/platform'));
                }}
                onNo={() => setConfirm(false)}
              />
            )}
            <ResultNote note={note} />
          </Card>
        </>
      )}
    </Frame>
  );
};

/** Where a VM is in the topology: its programme (or the zone, for a router). */
function findVm(view: InfraView | undefined, key: string): { vm: ZoneVm; zone: string; program?: string } | undefined {
  for (const z of view?.zones ?? []) {
    for (const p of z.programs) {
      const vm = p.vms.find(v => v.name === key || v.id === key);
      if (vm) return { vm, zone: z.name, program: vm.role === 'zone router' ? undefined : p.name };
    }
    const r = z.router?.vms.find(v => v.name === key || v.id === key);
    if (r) return { vm: r, zone: z.name };
  }
  return undefined;
}

const since = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 120) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

/** A usage tile: what it is, the figure now and, when known, how full it is. */
const Meter = ({ label, value, sub, pct }: { label: string; value: string; sub?: string; pct?: number }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.5, bgcolor: 'background.paper', display: 'grid', gap: 0.5, minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
      {value}{' '}
      {sub && (
        <Typography component="span" variant="body2" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Typography>
    {pct !== undefined && (
      <Box sx={{ height: 8, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, bgcolor: pct > 85 ? TONES.warn.fg : 'primary.main' }} />
      </Box>
    )}
  </Box>
);

/** How OpenNebula names the reason a VM left a host (HISTORY ACTION). */
const HISTORY_ACTIONS: Record<string, string> = { '0': 'ran', '1': 'migrated', '2': 'live migrated', '6': 'stopped', '9': 'powered off', '11': 'rebooted', '20': 'powered off', '21': 'resumed', '23': 'rebooted' };

/** Infrastructure › a VM: usage, how to reach it, network and rules, disks, lifecycle, security, code, quota, actions. */
export const VmDetailPage = () => {
  const { name = '' } = useParams();
  const { loading, data, error, reload } = useZone();
  const req = useVmRequests();
  const infra = useInfra();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { reload(); req.reload(); });
  const [confirm, setConfirm] = useState(false);
  const view = data as InfraView | undefined;
  const found = findVm(view, name);
  const request = (req.data?.vms ?? []).find(v => consoleVmName(v) === name);
  const vm = found?.vm;
  const st = request ? vmStatus(request) : undefined;
  const zoneName = found?.zone ?? request?.zone ?? '';
  const progName = found?.program ?? request?.program;
  const prog = view?.zones.find(z => z.name === zoneName)?.programs.find(p => p.name === progName);
  const programPath = progName ? `/console/infrastructure/platform/${zoneName}/${progName}` : undefined;
  const policy = req.data?.policy;
  const size = request ? policy?.sizes[request.size] : undefined;
  const ip = vm?.ips[0] ?? (request?.state?.outputs?.ip ? String(request.state.outputs.ip) : '');
  const bastion = prog?.cluster?.vip;
  const fqdn = view?.domain && progName ? `${name}.${zoneName}.${progName}.${view.domain}` : '';
  const sg = prog?.securityGroups.find(g => g.role === 'private') ?? prog?.securityGroups.find(g => (vm?.nics ?? []).some(n => n.securityGroups?.split(',').length));
  const disk = vm?.disks?.[0];
  const mine = (req.data?.vms ?? []).filter(v => v.zone === zoneName && v.program === progName);
  const used = { vms: mine.length, cpu: mine.reduce((t, v) => t + (policy?.sizes[v.size]?.cpu ?? 0), 0), mem: mine.reduce((t, v) => t + (policy?.sizes[v.size]?.memory_mb ?? 0), 0) };
  let ssh = '';
  if (ip) ssh = bastion ? `ssh -J refresquito@${bastion} refresquito@${ip}` : `ssh refresquito@${ip}`;
  const pending = vm?.state === 'PENDING';
  const events: Array<{ at?: string; text: string; when?: string }> = [];
  if (request?.requested_at) events.push({ at: request.requested_at, text: `Asked from the console by ${(request.requested_by ?? '').replace(/^user:default\//, '')}: ${request.size}, ${request.image}` });
  for (const h of vm?.history ?? []) {
    events.push({ at: h.start, text: `Deployed on ${h.host}`, when: h.start ? undefined : 'since it was created' });
    if (h.end) events.push({ at: h.end, text: `Left ${h.host}: ${HISTORY_ACTIONS[h.action ?? ''] ?? `action ${h.action}`}` });
  }
  if (pending) events.push({ text: 'Waiting for room in the hosts (OpenNebula keeps memory free on every host): it starts by itself when there is room' });
  if (st && st.tone === 'bad') events.push({ text: `Crossplane: ${st.detail}` });
  events.sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9'));
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);
  return (
    <Frame
      title={name}
      back={programPath ? { to: programPath, label: `${zoneName}/${progName}` } : { to: '/console/infrastructure/vms', label: 'Virtual machines' }}
      sub={
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {vm && <Badge label={pending ? 'Waiting for room' : vm.state} {...vmTone(pending ? 'PENDING' : vm.state)} />}
          {!vm && st && <Badge label={st.label} {...TONES[st.tone]} />}
          {(vm?.console || request) && <Badge label="console VM" {...TONES.info} />}
          <span>
            {[request ? `${request.image} · ${request.size}` : '', progName ? `programme ${zoneName}/${progName}` : '', vm ? `OpenNebula ID ${vm.id}` : ''].filter(Boolean).join(' · ')}
          </span>
        </Box>
      }
    >
      {(loading || req.loading) && !view && <Progress />}
      {error && <WarningPanel title="The zone could not be read" message={error} />}
      {view && !vm && !request && <WarningPanel severity="info" title="Not found" message={`There is no VM ${name} in the topology the host publishes (every 5 minutes).`} />}
      {(vm || request) && (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {ssh && (
              <Button size="small" variant="outlined" onClick={() => copy(ssh)} sx={{ textTransform: 'none' }}>
                Copy SSH command
              </Button>
            )}
            {request && (
              <OpsActions target={{ zone: request.zone, program: request.program, vm: request.name }} allowed={!!req.data?.allowed} results={view?.reconcile?.actions} onDone={reload} />
            )}
          </Box>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))' }}>
            <Meter label={`CPU · ${vm?.vcpu ?? size?.cpu ?? '?'} vCPU${vm?.cpuReserved ? ` (${vm.cpuReserved} reserved)` : ''}`} value={vm?.cpuPct !== undefined ? `${vm.cpuPct} %` : '—'} sub="now" pct={vm?.cpuPct} />
            <Meter
              label={`Memory · ${vm?.memoryGb ?? (size ? size.memory_mb / 1024 : '?')} GB`}
              value={vm?.memoryUsedGb !== undefined ? `${vm.memoryUsedGb} GB` : '—'}
              sub="used"
              pct={vm?.memoryUsedGb !== undefined && vm.memoryGb ? (vm.memoryUsedGb / vm.memoryGb) * 100 : undefined}
            />
            <Meter label={`Disk · ${disk?.image ?? request?.image ?? 'image unknown'}`} value={`${disk ? Math.round(disk.sizeMb / 1024) : size?.disk_gb ?? '?'} GB`} />
            <Meter label="Network since it started" value={vm?.netRxMb !== undefined ? `${vm.netRxMb} MB in` : '—'} sub={vm?.netTxMb !== undefined ? `${vm.netTxMb} MB out` : undefined} />
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(460px, 100%), 1fr))', alignItems: 'start' }}>
            <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <Card title="Summary">
                <Facts
                  items={[
                    ['Name in DNS', fqdn],
                    ['Private address', ip],
                    ['Host', vm?.host],
                    ['Started', vm?.started ? `${new Date(vm.started).toLocaleString()} · up ${since(vm.started)}` : ''],
                    ['Owner · group', vm ? `${vm.owner ?? '?'} · ${vm.group ?? '?'}` : ''],
                    ['Labels', vm?.labels],
                  ]}
                />
              </Card>
              <Card title="How to reach it" sub={bastion ? 'No public address: through the VNF of the programme (its bastion), with your SSH key in OpenNebula.' : 'No public address and no cluster VNF in this programme: from the host, through the zone router.'}>
                {ssh ? (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', bgcolor: 'action.hover', borderRadius: 1, p: 1, fontFamily: 'monospace', fontSize: 13, overflowX: 'auto' }}>
                    <Box component="span" sx={{ flex: 1, whiteSpace: 'nowrap' }}>
                      {ssh}
                    </Box>
                    <Button size="small" onClick={() => copy(ssh)} sx={{ textTransform: 'none', flexShrink: 0 }}>
                      Copy
                    </Button>
                  </Box>
                ) : (
                  <Typography color="text.secondary">It has no address yet.</Typography>
                )}
              </Card>
              <Card title="Network">
                <Table
                  head={['Network', 'Address', 'MAC', 'Security groups']}
                  rows={(vm?.nics ?? []).map(n => [n.network, n.ip, n.mac ?? '', n.securityGroups ?? ''])}
                />
                {sg && (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      What {sg.name} lets through:
                    </Typography>
                    <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-line', fontFamily: 'monospace', fontSize: 12.5 }}>
                      {sg.rules.join('\n') || '—'}
                    </Typography>
                  </>
                )}
              </Card>
              <Card title="Disks">
                {(vm?.disks ?? []).length === 0 ? (
                  <Typography color="text.secondary">Not published yet (the VM has not been deployed, or an older topology).</Typography>
                ) : (
                  <Table head={['Device', 'Image', 'Size', 'Datastore']} rows={(vm?.disks ?? []).map(d => [d.target ?? '', d.image, d.sizeMb ? `${Math.round(d.sizeMb / 1024)} GB` : '', d.datastore ?? ''])} />
                )}
              </Card>
            </Box>
            <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <Card title="Lifecycle">
                {events.length === 0 ? (
                  <Typography color="text.secondary">Nothing yet.</Typography>
                ) : (
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    {events.map((ev, i) => (
                      <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1.5, fontSize: 14 }}>
                        <span>{ev.text}</span>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                          {ev.at ? new Date(ev.at).toLocaleString() : ev.when ?? 'now'}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Card>
              <Card title="Security">
                <Facts
                  items={[
                    ['Image', /cis/i.test(request?.image ?? disk?.image ?? '') ? 'CIS-hardened (level 1): the same OS hardening as the cluster nodes' : request?.image ?? disk?.image],
                    ['Network exposure', 'private network only, behind its security group'],
                    ['Access', bastion ? 'SSH through the VNF only' : 'from the host'],
                  ]}
                />
              </Card>
              {request && (
                <Card title="As code" sub="A file in git (console-vms-oneke) that Crossplane turns into the VM with Terraform.">
                  <Facts
                    items={[
                      ['File', `charts/console-vms-oneke/vms/${request.zone}-${request.program}-${request.name}.json`],
                      ['Crossplane', st ? <Badge label={st.label} {...TONES[st.tone]} /> : ''],
                      ['Outputs', request.state?.outputs ? Object.entries(request.state.outputs).map(([k, v]) => `${k} ${String(v)}`).join(' · ') : ''],
                    ]}
                  />
                  {st?.tone === 'bad' && st.detail && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                      {st.detail}
                    </Typography>
                  )}
                  {req.data?.allowed && (
                    <Box>
                      <Button variant="outlined" color="error" disabled={busy} onClick={() => setConfirm(true)} sx={{ textTransform: 'none' }}>
                        Delete this VM
                      </Button>
                    </Box>
                  )}
                  {confirm && (
                    <ConfirmBar
                      text={`Delete ${request.name}? A pull request removes its file; once merged, Crossplane destroys the VM and its disk.`}
                      onYes={() => {
                        setConfirm(false);
                        run(() => post('/zone/vms/delete', { zone: request.zone, program: request.program, name: request.name }), a => `Pull request #${a.pull?.number} opened: once merged, Crossplane destroys ${request.name}.`);
                      }}
                      onNo={() => setConfirm(false)}
                    />
                  )}
                  <ResultNote note={note} />
                </Card>
              )}
              {request && policy && (
                <Card title="Quota of the programme" sub={`What ${request.zone}/${request.program} uses of the limits of console VMs.`}>
                  <Facts
                    items={[
                      ['VMs', `${used.vms} of ${policy.limits.vms ?? '—'}`],
                      ['CPU', `${used.cpu} of ${policy.limits.cpu ?? '—'}`],
                      ['Memory', `${used.mem / 1024} of ${policy.limits.memory_mb ? policy.limits.memory_mb / 1024 : '—'} GB`],
                    ]}
                  />
                </Card>
              )}
              {!request && vm && (
                <Card
                  title={prog?.cluster && vm.role && vm.role !== 'zone router' ? `Node of cluster ${prog.cluster.name}` : 'Managed outside the console'}
                  sub={
                    prog?.cluster && vm.role && vm.role !== 'zone router'
                      ? 'OneFlow keeps this VM as a node of the cluster: it is stopped, started and restarted with the cluster, not on its own.'
                      : 'Not a VM of the console: it is created by configuration.py (zone router, VNF) or by hand.'
                  }
                >
                  <Facts
                    items={[
                      ['Role', vm.role],
                      ['Cluster', prog?.cluster ? `${prog.cluster.name} · ${prog.cluster.state}` : ''],
                      ['Programme', progName ? <Link to={programPath ?? ''}>{`${zoneName}/${progName}`}</Link> : 'the zone'],
                    ]}
                  />
                  {prog?.cluster && progName && vm.role !== 'zone router' && (
                    <OpsActions
                      target={{ zone: zoneName, program: progName }}
                      allowed={!!infra.data?.allowed}
                      own={(infra.data?.admins ?? []).includes(`${zoneName}/${progName}`)}
                      results={view?.reconcile?.actions}
                      onDone={reload}
                    />
                  )}
                </Card>
              )}
            </Box>
          </Box>
        </>
      )}
    </Frame>
  );
};
