import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useClusterPost } from '../post';
import { kindCounts, removalBlock, type Seg, type SegKind, segregations, siteRole, type Why } from '../interconnection';
import { type ClusterProfile, type InfraView, pullTarget, type ReconcileStatus, useInfra, useVmRequests, useZone } from '../zone';
import { Badge } from './Badge';
import { TONES, type Tone } from './Flow';
import { KindPill, SitePill } from './InterParts';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ConfirmBar, RequestsTable, ResultNote, useChange } from './Requests';
import { useRq } from '../theme/consoleTheme';
import { useI18n } from '../i18n';
import { Kpis, Pill, TitleRow, choose, type Tone as PillTone } from './ui';

const gb = (mb?: number) => (typeof mb === 'number' ? `${Math.round(mb / 1024)} GB` : '—');
const PILL_TONE: Record<Tone, PillTone> = { ok: 'pos', warn: 'warn', bad: 'neg', info: 'info', off: 'neu' };

/** "3 programmes · 3 common · 1 landing": the kinds that exist. */
export function kindsNote(counts: Record<SegKind, number>, t: (k: string, v?: Record<string, string | number>) => string): string {
  return (['programme', 'common', 'landing', 'integration'] as const).filter(k => counts[k] > 0).map(k => t(`ic.count.${k}`, { n: counts[k] })).join(' · ');
}

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
export function roomFinding(view: InfraView, t: (k: string, v?: Record<string, string | number>) => string) {
  const free = view.capacity?.freeMemoryMb;
  const smallest = Math.min(...(view.kubernetes?.profiles ?? []).map(p => p.memoryMb));
  if (typeof free !== 'number' || !Number.isFinite(smallest)) return undefined;
  return smallest > free
    ? { text: <span><b style={{ fontWeight: 500 }}>{t('infra.noRoom')}</b> {t('infra.noRoomWhy', { free: gb(free), need: gb(smallest) })}</span>, tone: 'warn' as const }
    : { text: t('infra.room', { free: gb(free) }), tone: 'pos' as const };
}

export function programState(p: { declared: boolean; ok: boolean | null }): [string, Tone] {
  if (!p.declared) return ['Not in network.toml', 'warn'];
  if (p.ok) return ['Applied', 'ok'];
  if (p.ok === false) return ['Incomplete', 'warn'];
  return ['Declared', 'info'];
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

/** Why a segregation stays, in words. */
const blockText = (why: Why, t: (k: string, v?: Record<string, string | number>) => string) => t(why.key, why.vars);

/**
 * Platform › Zones and segregations: every zone of the catalog and its segregations with their kind. Read-only except
 * Remove, which opens a pull request (or says why it cannot yet); new ones are created in the Marketplace.
 */
export const PlatformPage = () => {
  const infra = useInfra();
  const zone = useZone();
  const vms = useVmRequests();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { infra.reload(); zone.reload(); });
  const [confirm, setConfirm] = useState<Seg | undefined>();
  const isSeg = (p: { branch: string }) => /^console\/seg(del)?-/.test(p.branch);
  const { t } = useI18n();
  const rq = useRq();
  const market = '/console/infrastructure/marketplace';
  return (
    <InfraFrame
      title={t('infra.platformTitle')}
      sub={t('ic.zones.sub')}
      finding={v => roomFinding(v, t)}
      actions={<Button variant="outlined" component={Link as any} to={market}>{t('ic.createInMarket')}</Button>}
    >
      {view => {
        const catalog = view.catalog ?? [];
        const role = siteRole(view);
        const segs = segregations(view);
        const counts = kindCounts(segs);
        const pending = (infra.data?.pulls ?? []).filter(p => /^console\/segdel-/.test(p.branch)).map(p => pullTarget(p)).map(x => `${x.zone}/${x.program}`);
        const ctx = { admins: infra.data?.admins ?? [], askedClusters: (infra.data?.clusters ?? []).filter(c => !c.delete).map(c => `${c.zone}/${c.program}`), pending, allowed: !!infra.data?.allowed };
        const files = (s: Seg) => (vms.data?.vms ?? []).filter(v => v.zone === s.zone && v.program === s.name).length;
        const sub = (s: Seg) => {
          const what = choose<string>(
            [
              [s.kind === 'common', 'ClamAV'],
              [s.kind === 'landing' || s.kind === 'integration', t('ic.zones.components', { n: Math.max(s.vms, files(s)) })],
              [s.cluster, `cluster ${s.cluster}`],
            ],
            t('ic.zones.noCluster'),
          );
          return `n=${s.n ?? '?'} · ${what}`;
        };
        return (
          <>
            <Kpis
              items={[
                { label: t('infra.zonesEnabled'), value: `${catalog.filter(c => c.enabled).length} / ${catalog.length}`, note: t('infra.zonesNote') },
                { label: t('ic.segregations'), value: segs.length, note: kindsNote(counts, t) },
                { label: t('infra.memNewVm'), value: gb(view.capacity?.freeMemoryMb), note: t('infra.memNote', { r: gb(view.capacity?.reservedMemoryMb) }), tone: (view.capacity?.freeMemoryMb ?? 1) < 4096 ? 'bad' : undefined },
                { label: t('infra.hosts'), value: view.host ? `${view.host.cpus ?? '?'} CPU · ${view.host.memoryGiB ?? '?'} GiB` : '—', note: view.host?.name },
              ]}
            />
            {confirm && (
              <ConfirmBar
                text={t('ic.zones.confirm', { id: confirm.id })}
                onYes={() => {
                  const c = confirm;
                  setConfirm(undefined);
                  run(() => post('/infra/segregations/delete', { zone: c.zone, program: c.name }), a => t('ic.zones.removeOpened', { n: a.pull?.number ?? '', id: c.id }));
                }}
                onNo={() => setConfirm(undefined)}
              />
            )}
            <ResultNote note={note} />
            <Card
              title={t('nav.zonesSegregations')}
              sub={
                <>
                  <SitePill role={role} /> {t(`ic.zones.lanes.${role}`)} <Link to={market}>{t('nav.marketplace')}</Link>.
                </>
              }
            >
              <Box role="group" aria-label={t('nav.zonesSegregations')} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', alignItems: 'start' }}>
                {[...catalog]
                  .sort((a, b) => Number(b.enabled) - Number(a.enabled))
                  .map(z => {
                    const mine = segs.filter(s => s.zone === z.name);
                    return (
                      <Box key={z.name} sx={{ display: 'grid', gap: 1, minWidth: 0 }}>
                        <Typography component="h3" sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, m: 0 }}>
                          {z.label ?? z.name}
                          {z.block ? ` · ${z.block}` : ''}
                        </Typography>
                        {mine.length === 0 && (
                          <Box sx={{ border: `1px dashed ${rq.control}`, borderRadius: '8px', p: 1.5, display: 'grid', gap: 0.5 }}>
                            <Box component="span" sx={{ fontWeight: 600 }}>{z.enabled ? t('ic.zones.empty') : t('ic.reserved')}</Box>
                            <Typography variant="caption" color="text.secondary">{t('ic.zones.reservedSub')}</Typography>
                          </Box>
                        )}
                        {mine.map(s => {
                          const why = removalBlock(s, segs, { ...ctx, vmFiles: files(s) });
                          const [state, tone] = programState(s);
                          return (
                            <Box key={s.id} data-testid={`seg-${s.id}`} sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.sheet, p: 1.5, display: 'grid', gap: 0.75, minWidth: 0 }}>
                              <Link to={`/console/infrastructure/platform/${s.zone}/${s.name}`} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                                {s.id}
                              </Link>
                              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                                {sub(s)}
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                <KindPill kind={s.kind} />
                                <Pill tone={PILL_TONE[tone]}>{state}</Pill>
                              </Box>
                              {why ? (
                                <Typography variant="caption" color="text.secondary">
                                  {blockText(why, t)}
                                </Typography>
                              ) : (
                                <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => setConfirm(s)} aria-label={t('ic.zones.removeId', { id: s.id })} sx={{ justifySelf: 'start' }}>
                                  {t('ic.zones.remove')}
                                </Button>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    );
                  })}
              </Box>
            </Card>
            <Card title={t('infra.requests')} sub={t('ic.zones.requestsSub')}>
              <RequestsTable open={infra.data?.pulls ?? []} merged={infra.data?.merged ?? []} reconcile={view.reconcile} only={isSeg} />
            </Card>
            <ReconcileCard status={view.reconcile} />
          </>
        );
      }}
    </InfraFrame>
  );
};

export const ProfileCard = ({ p, free, onPick, picked }: { p: ClusterProfile; free?: number; onPick: () => void; picked: boolean }) => {
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
