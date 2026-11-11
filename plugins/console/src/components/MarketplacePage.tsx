import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { componentName, componentTitle, interconnectionKind, kindOf, overLimits, policyComponents, RESERVED_NAMES, segregations, type SegKind, siteRole } from '../interconnection';
import { useClusterPost } from '../post';
import { type ConsolePull, type InfraView, type NodeImage, pullKind, SCALE_LIMITS, useInfra, useVmRequests, useZone } from '../zone';
import { InfraFrame, ProfileCard, ReconcileCard, roomFinding } from './InfraPages';
import { ChoiceCard, SitePill } from './InterParts';
import { Card } from './NamespaceSections';
import { RequestsTable, ResultNote, useChange } from './Requests';
import { EmptyState, Id } from './ui';
import { PageTabs, useTab } from './ZoneInventoryPages';

const gb = (mb?: number) => (typeof mb === 'number' ? `${Math.round(mb / 1024)} GB` : '—');
const gib = (mb: number) => `${Math.round((mb / 1024) * 10) / 10} GiB`;
const PROGRAM_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
const TABS = ['segregations', 'clusters', 'components'] as const;
type Asked = 'programme' | 'landing' | 'integration';
const ASKED: Asked[] = ['programme', 'landing', 'integration'];

/** What the requests list of the marketplace covers: segregations, clusters and interconnection components. */
export const isMarketRequest = (p: ConsolePull) => /^console\/(seg|segdel|cluster|clusterdel)-/.test(p.branch) || / component$/.test(pullKind(p));

/** Tab 1: a programme, the landing zone (core site) or the integration zone (edge site) of a zone, by pull request. */
const SegregationsTab = ({ view, allowed, onDone }: { view: InfraView; allowed: boolean; onDone: () => void }) => {
  const { t } = useI18n();
  const post = useClusterPost();
  const { note, busy, run } = useChange(onDone);
  const role = siteRole(view);
  const fits = (k: Asked) => k === 'programme' || k === interconnectionKind(role);
  const [kind, setKind] = useState<Asked>('programme');
  const [form, setForm] = useState({ zone: '', program: '' });
  const catalog = view.catalog ?? [];
  const z = catalog.find(c => c.name === (form.zone || catalog.find(x => x.enabled)?.name)) ?? catalog[0];
  const name = kind === 'programme' ? form.program : kind;
  const taken = !!z?.programs.some(p => p.name === name);
  const reserved = kind === 'programme' && RESERVED_NAMES.includes(name);
  const nameOk = kind !== 'programme' || (PROGRAM_NAME.test(name) && !reserved);
  const first = !!z && z.programs.length === 0;
  const hasCommon = !!z?.programs.some(p => kindOf(p.name, p.kind) === 'common');
  const next = z ? Math.max(0, ...z.programs.map(p => p.n ?? 0)) + 1 : undefined;
  const n = next !== undefined && first ? next + 1 : next;
  const pick = (k: Asked) => {
    setKind(k);
    setTimeout(() => document.getElementById('create-segregation')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0);
  };
  let help = `${z?.name ?? '…'}/${name || '…'} · n=${n ?? '?'}${z && !z.enabled ? ` · ${t('ic.seg.enables')}` : ''}`;
  if (taken) help = t('ic.seg.taken', { id: `${z?.name}/${name}` });
  else if (reserved) help = t('ic.seg.reserved', { name });
  else if (name && !nameOk) help = t('ic.seg.badName');
  let common = t('ic.seg.noCommon', { zone: z?.name ?? '…' });
  if (first) common = t('ic.seg.first', { zone: z?.name ?? '…' });
  else if (hasCommon) common = t('ic.seg.hasCommon', { zone: z?.name ?? '…' });
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <SitePill role={role} />
        <Typography color="text.secondary">{t(`ic.site.${role}.what`)}</Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>
        {ASKED.map(k => (
          <ChoiceCard
            key={k}
            title={t(`ic.seg.${k}`)}
            badge={k === 'programme' ? undefined : t('nav.interconnection')}
            badgeTone="info"
            desc={t(`ic.seg.${k}.desc`)}
            foot={t(`ic.seg.${k}.creates`)}
            chosen={kind === k && fits(k)}
            disabled={fits(k) ? undefined : t(`ic.seg.${k}.notHere`)}
            action={t('ic.seg.pick')}
            onPick={() => pick(k)}
          />
        ))}
      </Box>
      <Box id="create-segregation" />
      <Card title={t('ic.seg.formTitle', { kind: t(`ic.seg.${kind}`).toLowerCase() })} sub={t('ic.seg.formSub')}>
        {!allowed && <Typography variant="body2" color="text.secondary">{t('infra.onlyAdminSeg')}</Typography>}
        <Box
          component="form"
          onSubmit={e => {
            e.preventDefault();
            run(() => post('/infra/segregations', { zone: z?.name ?? '', program: name, kind }), a => t('infra.segOpened', { n: a.pull?.number ?? '', target: `${z?.name}/${name}` })).then(ok => ok && setForm(f => ({ ...f, program: '' })));
          }}
          sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', alignItems: 'start' }}
        >
          <TextField select size="small" label={t('shell.zone')} value={z?.name ?? ''} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
            {catalog.map(c => (
              <MenuItem key={c.name} value={c.name}>
                {c.label ?? c.name} ({c.name}){c.enabled ? '' : ` · ${t('ic.reserved').toLowerCase()}`}
              </MenuItem>
            ))}
          </TextField>
          {kind === 'programme' ? (
            <TextField size="small" label={t('zone.programme')} required value={form.program} onChange={e => setForm(f => ({ ...f, program: e.target.value.toLowerCase() }))} error={!!form.program && (!nameOk || taken)} helperText={help} />
          ) : (
            <TextField size="small" label={t('ic.seg.fixedName')} value={kind} disabled error={taken} helperText={help} />
          )}
          <Button type="submit" variant="contained" disabled={busy || !allowed || !z || !name || !nameOk || taken || !fits(kind)} sx={{ justifySelf: 'start' }}>
            {t('vmr.openPr')}
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {common}
          {kind !== 'programme' && ` ${t('ic.seg.oneZone', { kind: t(`ic.seg.${kind}`).toLowerCase() })}`}
        </Typography>
        <ResultNote note={note} />
      </Card>
    </>
  );
};

/** Tab 2: the OneKE profiles; a new cluster in a programme segregation by pull request. */
const ClustersTab = ({ view, allowed, asked, onDone }: { view: InfraView; allowed: boolean; asked: Set<string>; onDone: () => void }) => {
  const { t } = useI18n();
  const post = useClusterPost();
  const { note, busy, run } = useChange(onDone);
  const [form, setForm] = useState({ target: '', profile: '', workers: '', image: '' });
  const pick = (name: string) => {
    setForm(f => ({ ...f, profile: name }));
    // the form is under the cards: bring it into view
    setTimeout(() => document.getElementById('create-cluster')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0);
  };
  const profiles = view.kubernetes?.profiles ?? [];
  const profile = profiles.find(p => p.name === (form.profile || view.kubernetes?.defaultProfile)) ?? profiles[0];
  // only a programme has a Kubernetes cluster: not common, a landing zone or an integration zone
  const targets = (view.catalog ?? []).flatMap(z => z.programs.filter(p => p.declared && !p.cluster && kindOf(p.name, p.kind) === 'programme' && !asked.has(`${z.name}/${p.name}`)).map(p => `${z.name}/${p.name}`));
  const target = form.target || targets[0] || '';
  const [tz, tp] = target.split('/');
  const workers = form.workers === '' ? undefined : Number(form.workers);
  // the node images the host offers (OS + Kubernetes version): a choice only when there is more than one
  const images = view.kubernetes?.nodeImages ?? [];
  const image = images.length > 1 ? images.find(i => i.name === form.image) ?? images.find(i => i.name === profile?.nodeImage) ?? images.find(i => i.default) ?? images[0] : undefined;
  const imageLabel = (i: NodeImage) => [i.os, i.kubernetes && `Kubernetes ${i.kubernetes}`].filter(Boolean).join(' · ') || i.name;
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
      <Card title={t('infra.createCluster')} sub={`${t('infra.createClusterSub')} ${t('ic.cluster.onlyProgrammes')}`}>
        {!allowed && <Typography variant="body2" color="text.secondary">{t('infra.onlyAdminCluster')}</Typography>}
        {targets.length === 0 ? (
          <Typography color="text.secondary">{t('ic.cluster.noTarget')}</Typography>
        ) : (
          <Box
            component="form"
            onSubmit={e => {
              e.preventDefault();
              run(() => post('/infra/clusters', { zone: tz, program: tp, profile: profile?.name ?? '', ...(image ? { node_image: image.name } : {}), ...(workers !== undefined ? { workers } : {}) }), a => t('infra.clusterOpened', { n: a.pull?.number ?? '', target }));
            }}
            sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', alignItems: 'start' }}
          >
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
            {image && (
              <TextField select size="small" label={t('infra.nodeImage')} value={image.name} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} helperText={t('infra.nodeImageHelp')}>
                {images.map(i => (
                  <MenuItem key={i.name} value={i.name}>
                    {imageLabel(i)}
                  </MenuItem>
                ))}
              </TextField>
            )}
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
            <Button type="submit" variant="contained" disabled={busy || !allowed || !profile || (typeof free === 'number' && need > free)} sx={{ justifySelf: 'start' }}>
              {t('vmr.openPr')}
            </Button>
          </Box>
        )}
        <ResultNote note={note} />
      </Card>
    </>
  );
};

/** Tab 3: APISIX + Coraza, SFTPGo, Kafka or GitLab + Harbor in a landing or integration zone: fixed image, sized from the policy. */
const ComponentsTab = ({ view, onSegregations }: { view: InfraView; onSegregations: () => void }) => {
  const { t, has } = useI18n();
  const post = useClusterPost();
  const req = useVmRequests();
  const { note, busy, run } = useChange(req.reload);
  const role = siteRole(view);
  const wanted: SegKind = interconnectionKind(role);
  // the zones of this site that can hold components and that OpenNebula already has (applied)
  const zones = segregations(view).filter(s => s.kind === wanted);
  const ready = zones.filter(s => s.live);
  const [form, setForm] = useState({ zone: '', component: '', traffic: '', cpu: '', memory: '', disk: '' });
  const policy = req.data?.policy;
  const names = policyComponents(policy);
  if (req.loading && !req.data) return <Typography color="text.secondary">{t('ic.comp.reading')}</Typography>;
  if (!names.length) {
    return (
      <Card title={t('ic.comp.title')}>
        <EmptyState title={t('ic.comp.unavailable')}>{req.error ?? t('ic.comp.unavailableWhy')}</EmptyState>
      </Card>
    );
  }
  if (!ready.length) {
    return (
      <Card title={t('ic.comp.title')}>
        <EmptyState
          title={t(zones.length ? 'ic.comp.zoneNotApplied' : `ic.comp.noZone.${wanted}`, { id: zones[0]?.id ?? '' })}
          action={
            zones.length ? undefined : (
              <Button variant="outlined" onClick={onSegregations}>
                {t(`ic.comp.createZone.${wanted}`)}
              </Button>
            )
          }
        >
          {t('ic.comp.noZoneWhy')}
        </EmptyState>
      </Card>
    );
  }
  const zone = ready.find(s => s.id === form.zone) ?? ready[0];
  const offered = (c: string) => policy!.components![c].kinds.includes(zone.kind);
  const component = names.find(c => c === form.component && offered(c)) ?? names.find(offered) ?? names[0];
  const spec = policy!.components![component];
  // what was chosen when the policy offers it, else the usual value, else the smallest
  const num = (asked: string, list: number[], usual: number) => [Number(asked), usual].find(x => list.includes(x)) ?? list[0];
  // only APISIX has a traffic to choose: undefined for the rest
  const traffic = spec.traffic?.find(x => x === form.traffic) ?? spec.traffic?.[0];
  const cpu = num(form.cpu, spec.cpu, 2);
  const memory = num(form.memory, spec.memory_mb, 4096);
  const disk = num(form.disk, spec.disk_gb, spec.disk_gb[0]);
  const files = req.data?.vms ?? [];
  const inPulls = (req.data?.pulls ?? []).flatMap(p => p.branch.match(new RegExp(`^console/vm-new-${zone.zone}-${zone.name}-(.+)-[0-9a-z]+$`))?.[1] ?? []);
  const name = componentName([...files.filter(v => v.zone === zone.zone && v.program === zone.name).map(v => v.name), ...inPulls], component, traffic);
  const over = overLimits(policy!.component_limits, files, zone.zone, zone.name, { cpu, memory_mb: memory });
  const free = view.capacity?.freeMemoryMb;
  const room = typeof free !== 'number' || memory <= free;
  const limits = policy!.component_limits;
  const pick = (c: string) => {
    setForm(f => ({ ...f, component: c }));
    setTimeout(() => document.getElementById('create-component')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0);
  };
  const allowed = !!req.data?.allowed;
  const fit = over.length ? t('ic.comp.over', { what: over.join(', ') }) : t(room ? 'ic.comp.fits' : 'ic.comp.noRoom', { need: gib(memory), free: gb(free) });
  const title = spec.traffic?.length ? `${componentTitle(component)} + Coraza (${(traffic ?? '').toUpperCase()})` : componentTitle(component);
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField select size="small" label={t('ic.comp.createIn')} value={zone.id} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} sx={{ minWidth: 240 }}>
          {ready.map(s => (
            <MenuItem key={s.id} value={s.id}>
              {s.id} · {t(`ic.kind.${s.kind}`)}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 320px' }}>
          {t(`ic.comp.zoneHint.${role}`)}
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>
        {names.map(c => (
          <ChoiceCard
            key={c}
            title={c === 'apisix' ? 'APISIX + Coraza' : componentTitle(c)}
            desc={has(`ic.comp.${c}.desc`) ? t(`ic.comp.${c}.desc`) : c}
            foot={
              <>
                {t('img.image')} <Id>{policy!.components![c].image}</Id>
              </>
            }
            chosen={c === component}
            disabled={offered(c) ? undefined : t(policy!.components![c].kinds.includes('landing') ? 'ic.comp.landingOnly' : 'ic.comp.integrationOnly')}
            action={t('ic.comp.pick')}
            onPick={() => pick(c)}
          />
        ))}
      </Box>
      <Box id="create-component" />
      <Card title={t('ic.comp.formTitle')} sub={t('ic.comp.formSub')}>
        {!allowed && <Typography variant="body2" color="text.secondary">{t('ic.comp.onlyAdmin')}</Typography>}
        <Typography sx={{ fontWeight: 500 }}>{t('ic.comp.newIn', { title, zone: zone.id })}</Typography>
        <Box
          component="form"
          onSubmit={e => {
            e.preventDefault();
            run(
              () => post('/zone/vms', { zone: zone.zone, program: zone.name, component, ...(traffic ? { traffic } : {}), cpu, memory_mb: memory, disk_gb: disk }),
              a => t('ic.comp.opened', { n: a.pull?.number ?? '', name, zone: zone.id }),
            );
          }}
          sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', alignItems: 'start' }}
        >
          <TextField size="small" label={t('ic.comp.image')} value={spec.image} InputProps={{ readOnly: true }} sx={{ gridColumn: '1 / -1' }} />
          {spec.traffic?.length ? (
            <TextField select size="small" label={t('ic.comp.traffic')} value={traffic} onChange={e => setForm(f => ({ ...f, traffic: e.target.value }))}>
              {spec.traffic.map(x => (
                <MenuItem key={x} value={x}>
                  {has(`ic.traffic.${x}`) ? t(`ic.traffic.${x}`) : x.toUpperCase()}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField select size="small" label="vCPU" value={cpu} onChange={e => setForm(f => ({ ...f, cpu: String(e.target.value) }))}>
            {spec.cpu.map(x => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('cluster.memory')} value={memory} onChange={e => setForm(f => ({ ...f, memory: String(e.target.value) }))}>
            {spec.memory_mb.map(x => (
              <MenuItem key={x} value={x}>
                {gib(x)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('ic.comp.disk')} value={disk} onChange={e => setForm(f => ({ ...f, disk: String(e.target.value) }))}>
            {spec.disk_gb.map(x => (
              <MenuItem key={x} value={x}>
                {x} GB
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={busy || !allowed || over.length > 0} sx={{ justifySelf: 'start' }}>
            {t('vmr.openPr')}
          </Button>
        </Box>
        <Typography variant="body2" color={over.length || !room ? 'error' : 'text.secondary'}>
          {t('ic.comp.name')} <Id>{`vm-${zone.zone}-${zone.name}-${name}`}</Id> ·{' '}
          {fit}
          {limits && ` · ${t('ic.comp.limits', { vms: limits.vms ?? '—', cpu: limits.cpu ?? '—', mem: limits.memory_mb ? gib(limits.memory_mb) : '—' })}`}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('ic.comp.quota')}
        </Typography>
        <ResultNote note={note} />
      </Card>
    </>
  );
};

/** Platform › Marketplace: everything the platform creates, in build order, each one a pull request. */
export const MarketplacePage = () => {
  const infra = useInfra();
  const zone = useZone();
  const vms = useVmRequests();
  const { t } = useI18n();
  const [tab, setTab] = useTab(TABS);
  const reload = () => {
    infra.reload();
    zone.reload();
  };
  return (
    <InfraFrame title={t('nav.marketplace')} crumb={t('nav.marketplace')} sub={t('ic.market.sub')} finding={v => roomFinding(v, t)}>
      {view => (
        <>
          <PageTabs label={t('nav.marketplace')} tab={tab} onChange={setTab} tabs={TABS.map((k, i) => [k, `${i + 1} · ${t(`ic.market.tab.${k}`)}`])} />
          {tab === 'segregations' && <SegregationsTab view={view} allowed={!!infra.data?.allowed} onDone={reload} />}
          {tab === 'clusters' && <ClustersTab view={view} allowed={!!infra.data?.allowed} asked={new Set((infra.data?.clusters ?? []).map(c => `${c.zone}/${c.program}`))} onDone={reload} />}
          {tab === 'components' && <ComponentsTab view={view} onSegregations={() => setTab('segregations')} />}
          <Card title={t('infra.requests')} sub={t('ic.market.requestsSub')}>
            <RequestsTable open={[...(infra.data?.pulls ?? []), ...(vms.data?.pulls ?? [])]} merged={[...(infra.data?.merged ?? []), ...(vms.data?.merged ?? [])]} reconcile={view.reconcile} only={isMarketRequest} />
          </Card>
          <ReconcileCard status={view.reconcile} />
        </>
      )}
    </InfraFrame>
  );
};
