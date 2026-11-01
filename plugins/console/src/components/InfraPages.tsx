import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { Link } from '@backstage/core-components';
import { useClusterPost } from '../post';
import { type CatalogZone, type ClusterProfile, type InfraView, type ReconcileStatus, SCALE_LIMITS, useInfra, useZone } from '../zone';
import { Badge } from './Badge';
import { Flow, type FlowLane, TONES, type Tone } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ConfirmBar, RequestsTable, ResultNote, useChange } from './Requests';

const gb = (mb?: number) => (typeof mb === 'number' ? `${Math.round(mb / 1024)} GB` : '—');
const PROGRAM_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** Frame of the platform-wide pages: every zone of the catalog, as the host publishes it. */
const InfraFrame = ({ title, sub, children }: { title: string; sub: string; children: (view: InfraView) => ReactNode }) => {
  const { loading, data, error } = useZone();
  const view = data as InfraView | undefined;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography color="text.secondary">
          {sub}
          {view?.generated ? ` · host data of ${new Date(view.generated).toLocaleString()}` : ''}
        </Typography>
      </Box>
      {loading && !view && <Progress />}
      {error && <WarningPanel title="The platform could not be read" message={error} />}
      {view && !view.catalog && <WarningPanel severity="info" title="The host publishes an older topology" message="Update the opennebula checkout of the host (configuration.py with reconcile): zones, profiles and capacity come from it." />}
      {view && children(view)}
    </Box>
  );
};

const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.5, bgcolor: 'background.paper', minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="h5" component="p" sx={{ fontWeight: 600 }}>
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    )}
  </Box>
);

const Kpis = ({ children }: { children: ReactNode }) => (
  <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>{children}</Box>
);

function programState(p: { declared: boolean; ok: boolean | null }): [string, Tone] {
  if (!p.declared) return ['Not in network.toml', 'warn'];
  if (p.ok) return ['Applied', 'ok'];
  if (p.ok === false) return ['Incomplete', 'warn'];
  return ['Declared', 'info'];
}

/** The zones of the catalog as lanes, their programmes (segregations) as nodes. */
export function catalogLanes(catalog: CatalogZone[]): FlowLane[] {
  return [...catalog]
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
    .map(z => ({
      label: `${z.label ?? z.name}${z.block ? ` · ${z.block}` : ''}`,
      nodes: z.programs.length
        ? z.programs.map(p => {
            const [state, tone] = programState(p);
            return { title: `${z.name}/${p.name}`, sub: `n=${p.n ?? '?'}${p.cluster ? ` · cluster ${p.cluster}` : ' · no cluster'}`, state, tone, href: `/console/infrastructure/platform/${z.name}/${p.name}` };
          })
        : [{ title: z.enabled ? 'No programme yet' : 'Reserved', sub: z.enabled ? 'enabled, empty' : 'a new segregation enables it', tone: 'off' as Tone, dashed: true }],
    }));
}

export function stepTone(state: string): Tone {
  if (state === 'done' || state === 'ok' || state === 'applied') return 'ok';
  if (state === 'failed' || state === 'refused') return 'bad';
  return 'info';
}

function lastRun(s: ReconcileStatus): string {
  if (s.finished) return new Date(s.finished).toLocaleString();
  if (s.started) return `started ${new Date(s.started).toLocaleString()}`;
  return '—';
}

function segregationHelp(taken: boolean, nameOk: boolean, z: CatalogZone | undefined, program: string, nextN?: number): string {
  if (taken) return 'It already exists in this zone';
  if (program && !nameOk) return 'Lowercase letters, digits and "-"';
  return `${z?.name ?? '…'}/${program || '…'} · n=${nextN ?? '?'}${z && !z.enabled ? ' · enables the zone' : ''}`;
}

/** What the host did following main (configuration.py reconcile, every 5 minutes). */
export const ReconcileCard = ({ status, only }: { status?: ReconcileStatus; only?: (s: { zone?: string; program?: string }) => boolean }) => {
  const steps = (status?.clusters ?? []).filter(s => !only || only(s));
  return (
    <Card title="What the host did" sub="The host follows main of the opennebula repository every 5 minutes: a merged segregation is applied, a cluster file is created or scaled.">
      {!status ? (
        <Typography color="text.secondary">The host has not reported yet (configuration.py reconcile, installed by apply).</Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            Last run {lastRun(status)}
          </Typography>
          {status.error && <Typography color="error">{status.error}</Typography>}
          {status.segregation && !only && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Badge label={`network.toml ${status.segregation.state}`} {...TONES[stepTone(status.segregation.state)]} />
              <Typography variant="caption" color="text.secondary" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {status.segregation.detail?.split('\n').slice(-4).join('\n')}
              </Typography>
            </Box>
          )}
          {steps.length > 0 && (
            <Table
              head={['Cluster', 'Action', 'State', 'Detail']}
              rows={steps.map(s => [
                `${s.zone ?? '?'}/${s.program ?? '?'}`,
                s.action,
                <Badge label={s.state} {...TONES[stepTone(s.state)]} />,
                <Typography variant="caption" component="span" sx={{ whiteSpace: 'pre-wrap' }}>
                  {(s.detail ?? '').split('\n').slice(-3).join('\n')}
                </Typography>,
              ])}
            />
          )}
        </>
      )}
    </Card>
  );
};

/** Infrastructure › Platform: every zone of the catalog, its segregations, the host capacity; a new segregation by PR. */
export const PlatformPage = () => {
  const infra = useInfra();
  const zone = useZone();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { infra.reload(); zone.reload(); });
  const [form, setForm] = useState({ zone: '', program: '' });
  const isSeg = (p: { branch: string }) => /^console\/seg(del)?-/.test(p.branch);
  return (
    <InfraFrame title="Platform" sub="Every zone of the catalog and its programmes (network segregations), across the OpenNebula hosts">
      {view => {
        const catalog = view.catalog ?? [];
        const z = catalog.find(c => c.name === (form.zone || catalog.find(x => x.enabled)?.name));
        const nextN = z ? Math.max(0, ...z.programs.map(p => p.n ?? 0)) + 1 : undefined;
        const nameOk = PROGRAM_NAME.test(form.program);
        const taken = !!z?.programs.some(p => p.name === form.program);
        const programmes = catalog.reduce((t, c) => t + c.programs.length, 0);
        return (
          <>
            <Kpis>
              <Kpi label="Zones enabled" value={`${catalog.filter(c => c.enabled).length} / ${catalog.length}`} sub="the rest are reserved in the catalog" />
              <Kpi label="Programmes" value={String(programmes)} sub={`${catalog.reduce((t, c) => t + c.programs.filter(p => p.cluster).length, 0)} with a Kubernetes cluster`} />
              <Kpi label="Memory free for VMs" value={gb(view.capacity?.freeMemoryMb)} sub={`OpenNebula keeps ${gb(view.capacity?.reservedMemoryMb)} of every host`} />
              <Kpi label="Hosts" value={view.host ? `${view.host.cpus ?? '?'} CPU · ${view.host.memoryGiB ?? '?'} GiB` : '—'} sub={view.host?.name} />
            </Kpis>
            <Card title="Zones and segregations" sub="One lane per classification zone; each programme has its own public and private networks, security groups, group and VDC. Open a programme to see them, or to remove it.">
              <Flow lanes={catalogLanes(catalog)} label="Zones of the catalog and their programmes" />
            </Card>
            <Card title="New network segregation" sub="Adds a programme to network.toml through a pull request (and enables its zone when it is reserved). Once merged, the host applies it: networks, security groups, router, group, VDC and console user.">
              {!infra.data?.allowed && infra.data && <Typography variant="body2" color="text.secondary">Only backstage-admin can create segregations for now.</Typography>}
              <Box component="form" onSubmit={e => { e.preventDefault(); run(() => post('/infra/segregations', { zone: z?.name ?? '', program: form.program }), a => `Pull request #${a.pull?.number} opened for ${z?.name}/${form.program}: once merged, the host applies it within 5 minutes.`).then(ok => ok && setForm(f => ({ ...f, program: '' }))); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', alignItems: 'start' }}>
                <TextField select size="small" label="Zone" value={z?.name ?? ''} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
                  {catalog.map(c => (
                    <MenuItem key={c.name} value={c.name}>
                      {c.label ?? c.name} ({c.name}){c.enabled ? '' : ' · reserved'}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Programme"
                  required
                  value={form.program}
                  onChange={e => setForm(f => ({ ...f, program: e.target.value.toLowerCase() }))}
                  error={!!form.program && (!nameOk || taken)}
                  helperText={segregationHelp(taken, nameOk, z, form.program, nextN)}
                />
                <Button type="submit" variant="contained" disabled={busy || !infra.data?.allowed || !z || !nameOk || taken} sx={{ textTransform: 'none', justifySelf: 'start' }}>
                  Open the pull request
                </Button>
              </Box>
              <ResultNote note={note} />
            </Card>
            <Card title="Requests" sub="Segregations asked from the console in the last 7 days and where they are: waiting for review, merged and waiting for the host, applied or failed.">
              <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={view.reconcile} only={isSeg} />
            </Card>
            <ReconcileCard status={view.reconcile} />
          </>
        );
      }}
    </InfraFrame>
  );
};

const ProfileCard = ({ p, free, onPick, picked }: { p: ClusterProfile; free?: number; onPick: () => void; picked: boolean }) => {
  const fits = typeof free !== 'number' || p.memoryMb <= free;
  const nodes = (['master', 'worker', 'storage'] as const).filter(r => p.counts[r] > 0);
  return (
    <Box sx={{ border: 2, borderColor: picked ? 'primary.main' : 'divider', borderRadius: '12px', p: 2, display: 'grid', gap: 1, alignContent: 'start', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
          OneKE · {p.name}
        </Typography>
        {p.default && <Badge label="default" {...TONES.info} />}
        <Badge label={fits ? 'Fits' : 'Does not fit now'} {...TONES[fits ? 'ok' : 'warn']} />
      </Box>
      {p.description && <Typography variant="body2">{p.description}</Typography>}
      <Typography variant="body2" color="text.secondary">
        {nodes.map(r => `${p.counts[r]} ${r}${p.counts[r] > 1 ? 's' : ''} (${p.roles[r].vcpu} vCPU · ${gb(p.roles[r].memory_mb)})`).join(' · ')} + VNF
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        <Badge label={`${gb(p.memoryMb)} memory`} outlined />
        {p.cni && <Badge label={p.cni} outlined />}
        {p.k8sCis && <Badge label="CIS Kubernetes" {...TONES.ok} />}
        {p.k8sPsa && <Badge label={`PSA ${p.k8sPsa}`} outlined />}
        {p.longhorn && <Badge label="Longhorn" outlined />}
      </Box>
      {p.nodeImage && (
        <Typography variant="caption" color="text.secondary">
          Image {p.nodeImage}
        </Typography>
      )}
      <Button variant={picked ? 'contained' : 'outlined'} onClick={onPick} sx={{ textTransform: 'none', justifySelf: 'start' }}>
        {picked ? 'Chosen: fill the form below' : 'Create with this profile'}
      </Button>
    </Box>
  );
};

/** Every OneKE cluster of the platform, with Scale and Delete (not the cluster of this console). */
export const ClustersCard = ({
  view,
  infra,
  onDelete,
}: {
  view: InfraView;
  infra?: { allowed: boolean; admins?: string[]; clusters: Array<{ zone: string; program: string; delete?: boolean }> };
  onDelete: (zone: string, program: string, name: string) => void;
}) => (
  <Card title="Clusters of the platform" sub="Every OneKE cluster the host runs. Scale changes its nodes at once; Delete asks it through a pull request. The cluster of this console is not deleted from here.">
    <Table
      head={['Programme', 'Cluster', 'Nodes', 'State', '']}
      rows={view.zones.flatMap(z =>
        z.programs
          .filter(p => p.cluster)
          .map(p => {
            const id = `${z.name}/${p.name}`;
            const own = (infra?.admins ?? []).includes(id);
            const deleting = infra?.clusters.some(c => c.zone === z.name && c.program === p.name && c.delete);
            const running = !deleting && /RUNNING/.test(p.cluster!.state);
            return [
              <Link to={`/console/infrastructure/platform/${z.name}/${p.name}`}>{id}</Link>,
              p.cluster!.name,
              Object.entries(p.cluster!.roles ?? {}).map(([r, n]) => `${n} ${r}`).join(' · '),
              <Badge label={deleting ? 'Being deleted' : p.cluster!.state} {...TONES[running ? 'ok' : 'warn']} />,
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" component={Link} to={`/console/infrastructure/clusters/${z.name}/${p.name}`} disabled={deleting} sx={{ textTransform: 'none' }}>
                  Scale
                </Button>
                {!own && infra?.allowed && (
                  <Button size="small" color="error" disabled={deleting} onClick={() => onDelete(z.name, p.name, p.cluster!.name)} sx={{ textTransform: 'none' }}>
                    Delete
                  </Button>
                )}
              </Box>,
            ];
          }),
      )}
    />
  </Card>
);

/** Infrastructure › Marketplace: the OneKE profiles; a new cluster in a segregation by PR. */
export const MarketplacePage = () => {
  const infra = useInfra();
  const zone = useZone();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { infra.reload(); zone.reload(); });
  const [form, setForm] = useState({ target: '', profile: '', workers: '' });
  const isCluster = (p: { branch: string }) => /^console\/cluster(del)?-/.test(p.branch);
  const [confirm, setConfirm] = useState<{ zone: string; program: string; name: string } | undefined>();
  const pick = (name: string) => {
    setForm(f => ({ ...f, profile: name }));
    // the form is under the cards: bring it into view
    setTimeout(() => document.getElementById('create-cluster')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0);
  };
  return (
    <InfraFrame title="Marketplace" sub="Kubernetes clusters (OneKE) ready to create in a programme: hardened images, CIS profile, Calico segments">
      {view => {
        const profiles = view.kubernetes?.profiles ?? [];
        const profile = profiles.find(p => p.name === (form.profile || view.kubernetes?.defaultProfile)) ?? profiles[0];
        const asked = new Set((infra.data?.clusters ?? []).map(c => `${c.zone}/${c.program}`));
        const targets = (view.catalog ?? []).flatMap(z => z.programs.filter(p => p.declared && !p.cluster && !asked.has(`${z.name}/${p.name}`)).map(p => `${z.name}/${p.name}`));
        const target = form.target || targets[0] || '';
        const [tz, tp] = target.split('/');
        const workers = form.workers === '' ? undefined : Number(form.workers);
        const need = profile ? profile.memoryMb + ((workers ?? profile.counts.worker) - profile.counts.worker) * profile.roles.worker.memory_mb : 0;
        const free = view.capacity?.freeMemoryMb;
        return (
          <>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
              {profiles.map(p => (
                <ProfileCard key={p.name} p={p} free={free} picked={p.name === profile?.name} onPick={() => pick(p.name)} />
              ))}
            </Box>
            <Box id="create-cluster" />
            <Card title="Create a cluster" sub="Adds clusters/<zone>-<programme>.json to the opennebula repository through a pull request. Once merged, the host creates it (cluster-create, about 30 minutes) with its Keycloak groups, namespaces and Calico segments.">
              {!infra.data?.allowed && infra.data && <Typography variant="body2" color="text.secondary">Only backstage-admin can create clusters for now.</Typography>}
              {targets.length === 0 ? (
                <Typography color="text.secondary">Every programme has a cluster or one asked: create a new segregation first (Platform).</Typography>
              ) : (
                <Box component="form" onSubmit={e => { e.preventDefault(); run(() => post('/infra/clusters', { zone: tz, program: tp, profile: profile?.name ?? '', ...(workers !== undefined ? { workers } : {}) }), a => `Pull request #${a.pull?.number} opened: once merged, the host creates the cluster of ${target}.`); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', alignItems: 'start' }}>
                  <TextField select size="small" label="Programme" value={target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}>
                    {targets.map(t => (
                      <MenuItem key={t} value={t}>
                        {t}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" label="Profile" value={profile?.name ?? ''} onChange={e => setForm(f => ({ ...f, profile: e.target.value }))}>
                    {profiles.map(p => (
                      <MenuItem key={p.name} value={p.name}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    type="number"
                    label="Workers"
                    value={form.workers}
                    placeholder={String(profile?.counts.worker ?? '')}
                    onChange={e => setForm(f => ({ ...f, workers: e.target.value }))}
                    inputProps={{ min: 0, max: SCALE_LIMITS.workers }}
                    helperText={`needs ${gb(need)} · ${gb(free)} free`}
                    error={typeof free === 'number' && need > free}
                  />
                  <Button type="submit" variant="contained" disabled={busy || !infra.data?.allowed || !profile || (typeof free === 'number' && need > free)} sx={{ textTransform: 'none', justifySelf: 'start' }}>
                    Open the pull request
                  </Button>
                </Box>
              )}
              <ResultNote note={note} />
            </Card>
            <ClustersCard view={view} infra={infra.data} onDelete={(z, program, name) => setConfirm({ zone: z, program, name })} />
            {confirm && (
              <ConfirmBar
                text={`Delete the cluster ${confirm.name} of ${confirm.zone}/${confirm.program}? A pull request asks it; once merged, the host destroys its VMs and their disks (the segregation stays). It cannot be undone.`}
                onYes={() => {
                  const c = confirm;
                  setConfirm(undefined);
                  run(() => post('/infra/clusters/delete', { zone: c.zone, program: c.program }), a => `Pull request #${a.pull?.number} opened: once merged, the host deletes the cluster of ${c.zone}/${c.program}.`);
                }}
                onNo={() => setConfirm(undefined)}
              />
            )}
            <Card title="Requests" sub="Clusters asked or deleted from the console in the last 7 days and where they are.">
              <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={view.reconcile} only={isCluster} />
            </Card>
            <ReconcileCard status={view.reconcile} />
          </>
        );
      }}
    </InfraFrame>
  );
};
