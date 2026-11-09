import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { Link } from '@backstage/core-components';
import { useClusterPost } from '../post';
import { type CatalogZone, type ClusterProfile, type InfraView, type ReconcileStatus, SCALE_LIMITS, useInfra, useZone, vmHref } from '../zone';
import { Badge } from './Badge';
import { Flow, type FlowLane, TONES, type Tone } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ConfirmBar, RequestsTable, ResultNote, useChange } from './Requests';
import { useRq } from '../theme/consoleTheme';
import { useI18n } from '../i18n';
import { Attention, Facts, Kpis, Row, Section, TitleRow } from './ui';
import { vmRuns } from './ZonePages';

const gb = (mb?: number) => (typeof mb === 'number' ? `${Math.round(mb / 1024)} GB` : '—');
const PROGRAM_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** Frame of the platform-wide pages: every zone of the catalog, as the host publishes it. */
export const InfraFrame = ({ title, sub, crumb, children, finding, actions }: { title: string; sub: string; crumb?: string; children: (view: InfraView) => ReactNode; finding?: (view: InfraView) => { text: ReactNode; tone: 'pos' | 'warn' | 'neg' } | undefined; actions?: ReactNode }) => {
  const { loading, data, error } = useZone();
  const { t } = useI18n();
  const view = data as InfraView | undefined;
  const f = view && finding ? finding(view) : undefined;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <TitleRow
        crumbs={crumb ? [[t('nav.platform'), '/console/infrastructure/platform'], [crumb]] : [[t('nav.platform')]]}
        title={title}
        sub={`${sub}${view?.generated ? ` · ${t('infra.hostData', { time: new Date(view.generated).toLocaleString() })}` : ''}`}
        finding={f?.text}
        findingTone={f?.tone}
        actions={actions}
      />
      {loading && !view && <Progress />}
      {error && <WarningPanel title={t('infra.unreadable')} message={error} />}
      {view && !view.catalog && <WarningPanel severity="info" title={t('infra.older')} message={t('infra.olderMsg')} />}
      {view && children(view)}
    </Box>
  );
};

/** No room for a new cluster: the smallest profile does not fit in the memory free above the host reserve. */
function roomFinding(view: InfraView, t: (k: string, v?: Record<string, string | number>) => string) {
  const free = view.capacity?.freeMemoryMb;
  const smallest = Math.min(...(view.kubernetes?.profiles ?? []).map(p => p.memoryMb));
  if (typeof free !== 'number' || !Number.isFinite(smallest)) return undefined;
  return smallest > free
    ? { text: <span><b style={{ fontWeight: 500 }}>{t('infra.noRoom')}</b> {t('infra.noRoomWhy', { free: gb(free), need: gb(smallest) })}</span>, tone: 'warn' as const }
    : { text: t('infra.room', { free: gb(free) }), tone: 'pos' as const };
}

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
  const { t } = useI18n();
  return (
    <Card title={t('infra.hostDid')} sub={t('infra.hostDidSub')}>
      {!status ? (
        <Typography color="text.secondary">{t('infra.notReported')}</Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {t('infra.lastRun')} {lastRun(status)}
          </Typography>
          {status.error && <Typography color="error">{status.error}</Typography>}
          {status.segregation && !only && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Badge label={`network.toml ${status.segregation.state}`} {...TONES[stepTone(status.segregation.state)]} />
              <Typography variant="caption" color="text.secondary" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>
                {status.segregation.detail?.split('\n').slice(-4).join('\n')}
              </Typography>
            </Box>
          )}
          {steps.length > 0 && (
            <Table
              head={[t('shell.cluster'), t('infra.action'), t('zone.state'), t('infra.detail')]}
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
  const { t } = useI18n();
  return (
    <InfraFrame title={t('infra.platformTitle')} sub={t('infra.platformSub')} finding={v => roomFinding(v, t)} actions={<Button variant="contained" href="#new-segregation">{t('infra.newSeg')}</Button>}>
      {view => {
        const catalog = view.catalog ?? [];
        const z = catalog.find(c => c.name === (form.zone || catalog.find(x => x.enabled)?.name));
        const nextN = z ? Math.max(0, ...z.programs.map(p => p.n ?? 0)) + 1 : undefined;
        const nameOk = PROGRAM_NAME.test(form.program);
        const taken = !!z?.programs.some(p => p.name === form.program);
        const programmes = catalog.reduce((sum, c) => sum + c.programs.length, 0);
        return (
          <>
            <Kpis
              items={[
                { label: t('infra.zonesEnabled'), value: `${catalog.filter(c => c.enabled).length} / ${catalog.length}`, note: t('infra.zonesNote') },
                { label: t('zone.programmes'), value: programmes, note: t('infra.withCluster', { n: catalog.reduce((sum, c) => sum + c.programs.filter(x => x.cluster).length, 0) }) },
                { label: t('infra.memNewVm'), value: gb(view.capacity?.freeMemoryMb), note: t('infra.memNote', { r: gb(view.capacity?.reservedMemoryMb) }), tone: (view.capacity?.freeMemoryMb ?? 1) < 4096 ? 'bad' : undefined },
                { label: t('infra.hosts'), value: view.host ? `${view.host.cpus ?? '?'} CPU · ${view.host.memoryGiB ?? '?'} GiB` : '—', note: view.host?.name },
              ]}
            />
            <Card title={t('nav.zonesSegregations')} sub={t('infra.lanesSub')}>
              <Flow lanes={catalogLanes(catalog)} label="Zones of the catalog and their programmes" />
            </Card>
            <Box id="new-segregation" />
            <Card title={t('infra.newSegTitle')} sub={t('infra.newSegSub')}>
              {!infra.data?.allowed && infra.data && <Typography variant="body2" color="text.secondary">{t('infra.onlyAdminSeg')}</Typography>}
              <Box component="form" onSubmit={e => { e.preventDefault(); run(() => post('/infra/segregations', { zone: z?.name ?? '', program: form.program }), a => t('infra.segOpened', { n: a.pull?.number ?? '', target: `${z?.name}/${form.program}` })).then(ok => ok && setForm(f => ({ ...f, program: '' }))); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', alignItems: 'start' }}>
                <TextField select size="small" label={t('shell.zone')} value={z?.name ?? ''} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
                  {catalog.map(c => (
                    <MenuItem key={c.name} value={c.name}>
                      {c.label ?? c.name} ({c.name}){c.enabled ? '' : ' · reserved'}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label={t('zone.programme')}
                  required
                  value={form.program}
                  onChange={e => setForm(f => ({ ...f, program: e.target.value.toLowerCase() }))}
                  error={!!form.program && (!nameOk || taken)}
                  helperText={segregationHelp(taken, nameOk, z, form.program, nextN)}
                />
                <Button type="submit" variant="outlined" disabled={busy || !infra.data?.allowed || !z || !nameOk || taken} sx={{ justifySelf: 'start' }}>
                  {t('vmr.openPr')}
                </Button>
              </Box>
              <ResultNote note={note} />
            </Card>
            <Card title={t('infra.requests')} sub={t('infra.requestsSegSub')}>
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
  const rqT = useRq();
  const { t } = useI18n();
  return (
    <Box sx={{ border: 1, borderColor: picked ? rqT.data : 'divider', boxShadow: picked ? `0 0 0 1px ${rqT.data}` : 'none', borderRadius: '8px', p: 2, display: 'grid', gap: 1, alignContent: 'start', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h3">
          OneKE · {p.name}
        </Typography>
        {p.default && <Badge label="default" {...TONES.info} />}
        <Badge label={fits ? t('infra.fits') : t('infra.noFit')} {...TONES[fits ? 'ok' : 'warn']} />
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
      <Button variant="outlined" onClick={onPick} sx={{ justifySelf: 'start' }}>
        {picked ? t('infra.chosen') : t('infra.createWith')}
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
}) => {
  const { t } = useI18n();
  return (
  <Card title={t('infra.clustersTitle')} sub={t('infra.clustersSub')}>
    <Table
      head={[t('zone.programme'), t('shell.cluster'), t('cluster.nodes'), t('zone.state'), '']}
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
                <Button size="small" variant="outlined" component={Link} to={`/console/infrastructure/clusters/${z.name}/${p.name}`} disabled={deleting}>
                  {t('nav.scale')}
                </Button>
                {!own && infra?.allowed && (
                  <Button size="small" color="error" disabled={deleting} onClick={() => onDelete(z.name, p.name, p.cluster!.name)}>
                    {t('vmr.delete')}
                  </Button>
                )}
              </Box>,
            ];
          }),
      )}
    />
  </Card>
  );
};

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
  const { t } = useI18n();
  return (
    <InfraFrame title={t('nav.marketplace')} crumb={t('nav.marketplace')} sub={t('infra.marketSub')} finding={v => roomFinding(v, t)}>
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
            <Card title={t('infra.createCluster')} sub={t('infra.createClusterSub')}>
              {!infra.data?.allowed && infra.data && <Typography variant="body2" color="text.secondary">{t('infra.onlyAdminCluster')}</Typography>}
              {targets.length === 0 ? (
                <Typography color="text.secondary">{t('infra.noTarget')}</Typography>
              ) : (
                <Box component="form" onSubmit={e => { e.preventDefault(); run(() => post('/infra/clusters', { zone: tz, program: tp, profile: profile?.name ?? '', ...(workers !== undefined ? { workers } : {}) }), a => t('infra.clusterOpened', { n: a.pull?.number ?? '', target })); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', alignItems: 'start' }}>
                  <TextField select size="small" label={t('zone.programme')} value={target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}>
                    {targets.map(x => (
                      <MenuItem key={x} value={x}>
                        {x}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" label={t('infra.profile')} value={profile?.name ?? ''} onChange={e => setForm(f => ({ ...f, profile: e.target.value }))}>
                    {profiles.map(p => (
                      <MenuItem key={p.name} value={p.name}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    type="number"
                    label={t('infra.workers')}
                    value={form.workers}
                    placeholder={String(profile?.counts.worker ?? '')}
                    onChange={e => setForm(f => ({ ...f, workers: e.target.value }))}
                    inputProps={{ min: 0, max: SCALE_LIMITS.workers }}
                    helperText={t('infra.needs', { need: gb(need), free: gb(free) })}
                    error={typeof free === 'number' && need > free}
                  />
                  <Button type="submit" variant="contained" disabled={busy || !infra.data?.allowed || !profile || (typeof free === 'number' && need > free)} sx={{ justifySelf: 'start' }}>
                    {t('vmr.openPr')}
                  </Button>
                </Box>
              )}
              <ResultNote note={note} />
            </Card>
            <ClustersCard view={view} infra={infra.data} onDelete={(z, program, name) => setConfirm({ zone: z, program, name })} />
            {confirm && (
              <ConfirmBar
                text={t('infra.confirmDelete', { name: confirm.name, target: `${confirm.zone}/${confirm.program}` })}
                onYes={() => {
                  const c = confirm;
                  setConfirm(undefined);
                  run(() => post('/infra/clusters/delete', { zone: c.zone, program: c.program }), a => t('infra.deleteOpened', { n: a.pull?.number ?? '', target: `${c.zone}/${c.program}` }));
                }}
                onNo={() => setConfirm(undefined)}
              />
            )}
            <Card title={t('infra.requests')} sub={t('infra.requestsClusterSub')}>
              <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={view.reconcile} only={isCluster} />
            </Card>
            <ReconcileCard status={view.reconcile} />
          </>
        );
      }}
    </InfraFrame>
  );
};

/** Platform › Overview: zones, programmes, clusters, room in the hosts and what needs attention, in one page. */
export const PlatformOverviewPage = () => {
  const infra = useInfra();
  const { t } = useI18n();
  return (
    <InfraFrame title={t('infra.platformTitle')} sub={t('infra.overviewSub')} finding={v => roomFinding(v, t)} actions={<Button variant="contained" component={Link as any} to="/console/infrastructure/marketplace">{t('infra.createCluster')}</Button>}>
      {view => {
        const catalog = view.catalog ?? [];
        const programmes = view.zones.flatMap(z => z.programs.map(p => ({ zone: z.name, p })));
        const clusters = programmes.filter(x => x.p.cluster);
        const running = clusters.filter(x => /RUNNING/.test(x.p.cluster!.state)).length;
        const vms = programmes.flatMap(x => x.p.vms);
        const waiting = vms.filter(v => v.state === 'PENDING');
        const drift = view.drift ?? [];
        const attention = [
          ...clusters.filter(x => !/RUNNING/.test(x.p.cluster!.state)).map(x => ({ tone: 'neg' as const, label: t('shell.cluster'), what: t('infra.att.cluster', { name: x.p.cluster!.name, state: x.p.cluster!.state }), action: { label: t('nav.k8sClusters'), to: '/console/clusters' } })),
          ...waiting.map(v => ({ tone: 'warn' as const, label: 'VM', what: t('infra.att.vm', { name: v.name }), action: { label: t('clusters.open'), to: vmHref(v.name) } })),
          ...(drift.length ? [{ tone: 'warn' as const, label: t('infra.att.design'), what: t('zone.finding.drift', { n: drift.length }), action: { label: t('nav.infrastructure'), to: '/console/infrastructure' } }] : []),
          ...programmes.filter(x => !x.p.cluster).map(x => ({ tone: 'neu' as const, label: t('zone.programme'), what: t('infra.att.noCluster', { name: `${x.zone}/${x.p.name}` }), action: { label: t('clusters.create'), to: '/console/infrastructure/marketplace' } })),
        ];
        return (
          <>
            <Kpis
              items={[
                { label: t('infra.zonesEnabled'), value: `${catalog.filter(c => c.enabled).length} / ${catalog.length}` },
                { label: t('zone.programmes'), value: programmes.length, note: t('infra.withCluster', { n: clusters.length }) },
                { label: t('nav.k8sClusters'), value: `${running} / ${clusters.length}`, note: t('infra.running'), tone: running < clusters.length ? 'bad' : undefined },
                { label: t('infra.memNewVm'), value: gb(view.capacity?.freeMemoryMb), note: t('infra.memNote', { r: gb(view.capacity?.reservedMemoryMb) }), tone: (view.capacity?.freeMemoryMb ?? 1) < 4096 ? 'bad' : undefined },
                { label: 'VMs', value: `${vms.filter(v => vmRuns(v.state)).length} / ${vms.length}`, note: t('infra.running') },
              ]}
            />
            {attention.length > 0 && (
              <Section title={t('infra.attention')} meta={attention.length}>
                <Attention items={attention} />
              </Section>
            )}
            <Row spans={[8, 4]}>
              <Section title={t('infra.clustersTitle')} flush>
                <Table
                  head={[t('shell.cluster'), t('zone.programme'), t('cluster.nodes'), t('zone.state')]}
                  rows={clusters.map(x => [
                    <Link to={`/console/infrastructure/platform/${x.zone}/${x.p.name}`}>{x.p.cluster!.name}</Link>,
                    `${x.zone}/${x.p.name}`,
                    Object.entries(x.p.cluster!.roles ?? {}).map(([r, n]) => `${n} ${r}`).join(' · '),
                    <Badge label={x.p.cluster!.state} {...TONES[/RUNNING/.test(x.p.cluster!.state) ? 'ok' : 'warn']} />,
                  ])}
                />
              </Section>
              <Section title={view.host?.name ?? t('infra.hosts')}>
                <Facts
                  labelWidth={110}
                  items={[
                    ['CPU', view.host?.cpus !== undefined ? `${view.host.cpus}` : '—'],
                    [t('cluster.memory'), view.host?.memoryGiB !== undefined ? `${view.host.memoryGiB} GiB` : '—'],
                    [t('infra.reserve'), gb(view.capacity?.reservedMemoryMb)],
                    [t('infra.freeVms'), gb(view.capacity?.freeMemoryMb)],
                  ]}
                />
              </Section>
            </Row>
            <Section title={t('infra.requests')} meta={t('infra.last7')}>
              <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={view.reconcile} />
            </Section>
          </>
        );
      }}
    </InfraFrame>
  );
};
