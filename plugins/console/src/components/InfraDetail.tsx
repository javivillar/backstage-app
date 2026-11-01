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
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/** Infrastructure › a VM: what OpenNebula says of it and, for a VM of the console, its request and Crossplane. */
export const VmDetailPage = () => {
  const { name = '' } = useParams();
  const { loading, data, error, reload } = useZone();
  const req = useVmRequests();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { reload(); req.reload(); });
  const [confirm, setConfirm] = useState(false);
  const view = data as InfraView | undefined;
  const found = findVm(view, name);
  const request = (req.data?.vms ?? []).find(v => consoleVmName(v) === name);
  const vm = found?.vm;
  const st = request ? vmStatus(request) : undefined;
  const programPath = found?.program ? `/console/infrastructure/platform/${found.zone}/${found.program}` : undefined;
  return (
    <Frame
      title={name}
      back={programPath ? { to: programPath, label: `${found!.zone}/${found!.program}` } : { to: '/console/infrastructure/vms', label: 'Virtual machines' }}
      sub={vm ? <Badge label={vm.state} {...vmTone(vm.state)} /> : st && <Badge label={st.label} {...TONES[st.tone]} />}
    >
      {(loading || req.loading) && !view && <Progress />}
      {error && <WarningPanel title="The zone could not be read" message={error} />}
      {view && !vm && !request && <WarningPanel severity="info" title="Not found" message={`There is no VM ${name} in the topology the host publishes (every 5 minutes).`} />}
      {vm && (
        <>
          <Card title="Summary">
            <Facts
              items={[
                ['OpenNebula ID', vm.id],
                ['State', vm.state],
                ['Role', vm.role],
                ['Host', vm.host],
                ['vCPU', `${vm.vcpu ?? '?'}${vm.cpuReserved ? ` (${vm.cpuReserved} reserved)` : ''}`],
                ['Memory', vm.memoryGb !== undefined ? `${vm.memoryGb} GB` : ''],
                ['Started', vm.started ? `${new Date(vm.started).toLocaleString()} (${since(vm.started)})` : ''],
                ['CPU now', vm.cpuPct !== undefined ? `${vm.cpuPct} %` : ''],
                ['Memory used', vm.memoryUsedGb !== undefined ? `${vm.memoryUsedGb} GB` : ''],
              ]}
            />
          </Card>
          <Card title="Network interfaces">
            <Table
              head={['Network', 'Address', 'MAC', 'Security groups']}
              rows={(vm.nics ?? vm.ips.map(ip => ({ network: '', ip }))).map(n => [n.network, n.ip, (n as { mac?: string }).mac ?? '', (n as { securityGroups?: string }).securityGroups ?? ''])}
            />
          </Card>
          <Card title="Disks">
            {(vm.disks ?? []).length === 0 ? (
              <Typography color="text.secondary">Not published by the host (older topology).</Typography>
            ) : (
              <Table head={['Device', 'Image', 'Size', 'Datastore']} rows={(vm.disks ?? []).map(d => [d.target ?? '', d.image, d.sizeMb ? `${Math.round(d.sizeMb / 1024)} GB` : '', d.datastore ?? ''])} />
            )}
          </Card>
          <Card title="Ownership">
            <Facts
              items={[
                ['Owner', vm.owner],
                ['Group', vm.group],
                ['Created by the console', vm.console ? 'yes' : 'no'],
                ['Asked by', (vm.requestedBy ?? request?.requested_by ?? '').replace(/^user:default\//, '')],
                ['Labels', vm.labels],
              ]}
            />
          </Card>
        </>
      )}
      {request && (
        <Card title="Request of the console" sub="As code in git (console-vms-oneke); Crossplane creates it with Terraform, and its Workspace says how it goes.">
          <Facts
            items={[
              ['Programme', `${request.zone}/${request.program}`],
              ['Size', request.size],
              ['Image', request.image],
              ['Asked', request.requested_at ? new Date(request.requested_at).toLocaleString() : ''],
              ['Crossplane', st ? <Badge label={st.label} {...TONES[st.tone]} /> : ''],
            ]}
          />
          {st?.detail && (
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
    </Frame>
  );
};
