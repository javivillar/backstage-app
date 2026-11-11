import { Link } from '@backstage/core-components';
import type { SvgIconComponent } from '@mui/icons-material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CloudIcon from '@mui/icons-material/Cloud';
import CodeIcon from '@mui/icons-material/Code';
import ComputerIcon from '@mui/icons-material/Computer';
import DnsIcon from '@mui/icons-material/Dns';
import FolderIcon from '@mui/icons-material/Folder';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import HubIcon from '@mui/icons-material/Hub';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LanIcon from '@mui/icons-material/Lan';
import MemoryIcon from '@mui/icons-material/Memory';
import RouterIcon from '@mui/icons-material/Router';
import ShieldIcon from '@mui/icons-material/Shield';
import StorageIcon from '@mui/icons-material/Storage';
import SyncIcon from '@mui/icons-material/Sync';
import VpnLockIcon from '@mui/icons-material/VpnLock';
import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { componentTitle, type InterZone, type Seg, type SiteRole, type SlotState } from '../interconnection';
import { MONO, type RqTokens, useRq } from '../theme/consoleTheme';
import type { CatalogZone, InfraView, Zone } from '../zone';
import { choose } from './ui';

/**
 * Platform › Overview › Architecture: the site as the host publishes it, drawn. The host and what it serves, one lane
 * per classification zone with its router and its segregations (the cluster of each programme, the components of the
 * landing or integration zone, common), and the other site of the interconnection as a placeholder: it is another
 * OpenNebula this console does not read. Every colour comes from the theme of the console (day and night); dashed is
 * planned or missing; the lines that move are the routes of a router that exists (still with prefers-reduced-motion).
 */

/** One hue per zone, in the order of the catalog; lighter on the night theme. */
const ZONE_HUES = { light: ['#1f6fd0', '#1d8a4a', '#6b55a8', '#b7791f', '#0e7c86', '#b0447a'], dark: ['#6aa6f0', '#4cc488', '#a996e6', '#f0b35a', '#5ccfd9', '#f08cc0'] };
const REMOTE_HUE = { light: '#c8751a', dark: '#f0b35a' };

export type ArchColours = { dark: boolean; rq: RqTokens; hue: (i: number) => string; remote: string; wash: (c: string) => string; line: (c: string) => string };

/** The colours of the architecture diagrams, from the mode of the console theme. */
export function useArchColours(): ArchColours {
  const dark = useTheme().palette.mode === 'dark';
  const rq = useRq();
  const hues = dark ? ZONE_HUES.dark : ZONE_HUES.light;
  return {
    dark,
    rq,
    hue: i => hues[i % hues.length],
    remote: dark ? REMOTE_HUE.dark : REMOTE_HUE.light,
    wash: c => alpha(c, dark ? 0.12 : 0.07),
    line: c => alpha(c, dark ? 0.55 : 0.45),
  };
}

type Dot = 'ok' | 'warn' | 'bad' | 'off';
const dotColour = (rq: RqTokens, d: Dot) => ({ ok: rq.positive, warn: rq.warning, bad: rq.negative, off: rq.control })[d];
const SLOT_DOT: Record<SlotState, Dot> = { running: 'ok', creating: 'warn', git: 'warn', waiting: 'warn', stopped: 'warn', failed: 'bad', missing: 'off' };
const vmDot = (state?: string): Dot => {
  if (!state) return 'off';
  if (/RUNNING|ACTIVE/.test(state)) return 'ok';
  return /FAIL|ERROR|UNKNOWN/.test(state) ? 'bad' : 'warn';
};

/** A moving dashed line: a route in use. Horizontal or vertical; still when the user asks for less motion. */
const FlowLine = ({ colour, vertical, length, moving = true }: { colour: string; vertical?: boolean; length?: number | string; moving?: boolean }) => (
  <Box
    aria-hidden
    data-flow={moving ? 'moving' : 'still'}
    sx={{
      flex: 'none',
      alignSelf: vertical ? 'center' : 'stretch',
      width: vertical ? 2 : length ?? '100%',
      height: vertical ? length ?? 16 : 2,
      backgroundImage: `linear-gradient(${vertical ? '180deg' : '90deg'}, ${colour} 55%, transparent 55%)`,
      backgroundSize: vertical ? '2px 10px' : '10px 2px',
      opacity: moving ? 1 : 0.6,
      animation: moving ? `${vertical ? 'rqFlowY' : 'rqFlowX'} 0.9s linear infinite` : 'none',
      '@keyframes rqFlowX': { to: { backgroundPosition: '10px 0' } },
      '@keyframes rqFlowY': { to: { backgroundPosition: '0 10px' } },
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    }}
  />
);

/** A piece of the diagram: icon, name, state dot and a line under it; dashed when it does not exist yet. */
const Tile = ({ icon: Icon, title, sub, dot, colour, dashed, strong }: { icon?: SvgIconComponent; title: ReactNode; sub?: ReactNode; dot?: Dot; colour: string; dashed?: boolean; strong?: boolean }) => {
  const c = useArchColours();
  return (
    <Box
      data-dashed={dashed ? 'true' : undefined}
      sx={{ border: `1px ${dashed ? 'dashed' : 'solid'} ${dashed ? c.rq.control : c.line(colour)}`, borderRadius: '10px', bgcolor: choose([[dashed, 'transparent'], [strong, c.wash(colour)]], c.rq.sheet), px: 1.25, py: 1, display: 'flex', gap: 1, alignItems: 'center', minWidth: 0, color: dashed ? c.rq.muted : c.rq.ink }}
    >
      {Icon && <Icon sx={{ fontSize: 18, color: dashed ? c.rq.control : colour, flex: 'none' }} />}
      <Box sx={{ minWidth: 0, display: 'grid' }}>
        <Box component="span" sx={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 0.75, alignItems: 'center', overflowWrap: 'anywhere' }}>
          {title}
          {dot && <Box component="span" aria-hidden data-dot={dot} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dotColour(c.rq, dot), flex: 'none' }} />}
        </Box>
        {sub && (
          <Box component="span" sx={{ fontSize: 11, lineHeight: '15px', color: c.rq.muted, overflowWrap: 'anywhere' }}>
            {sub}
          </Box>
        )}
      </Box>
    </Box>
  );
};

/** The small upper-case heading of a container. */
const Cap = ({ children, colour }: { children: ReactNode; colour: string }) => (
  <Box component="span" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: colour, overflowWrap: 'anywhere' }}>
    {children}
  </Box>
);

const COMPONENT_ICON: Record<string, SvgIconComponent> = { apisix: ShieldIcon, sftpgo: FolderIcon, kafka: HubIcon, forge: CodeIcon };

/** A segregation inside its zone lane: the cluster of a programme, the pieces of a landing or integration zone, common. */
const SegBox = ({ seg, colour, inter }: { seg: Seg; colour: string; inter?: InterZone }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const cluster = seg.live?.cluster;
  const roles = cluster?.roles ?? {};
  const count = (r: string) => Number(roles[r] ?? 0);
  const box = { border: `1px solid ${c.line(colour)}`, borderRadius: '12px', bgcolor: c.rq.sheet, p: 1.25, display: 'grid', gap: 1, alignContent: 'start', minWidth: 0 };
  const head = (
    <Link to={`/console/infrastructure/platform/${seg.zone}/${seg.name}`} style={{ textDecoration: 'none' }}>
      <Cap colour={colour}>
        {seg.id}
        {cluster ? ` · ${t('shell.cluster')}` : ''}
      </Cap>
    </Link>
  );
  if (seg.kind === 'common') {
    return (
      <Box data-seg={seg.id} data-kind="common" sx={box}>
        {head}
        <Tile icon={HealthAndSafetyIcon} title="ClamAV" sub={seg.vms ? t('ic.arch.clamav') : t('ic.arch.clamavPlanned')} dot={seg.vms ? 'ok' : undefined} colour={colour} dashed={!seg.vms} />
      </Box>
    );
  }
  if (seg.kind === 'landing' || seg.kind === 'integration') {
    return (
      <Box data-seg={seg.id} data-kind={seg.kind} sx={{ ...box, borderWidth: 1.5, borderColor: colour }}>
        {head}
        {(inter?.slots ?? []).map(s => (
          <Tile
            key={s.key}
            icon={COMPONENT_ICON[s.component]}
            title={componentTitle(s.component, s.traffic)}
            sub={s.state === 'missing' ? t('ic.state.missing') : `${s.rows[0]?.address ?? t(`ic.state.${s.state}`)}`}
            dot={s.state === 'missing' ? undefined : SLOT_DOT[s.state]}
            colour={colour}
            dashed={s.state === 'missing'}
          />
        ))}
      </Box>
    );
  }
  return (
    <Box data-seg={seg.id} data-kind="programme" sx={box}>
      {head}
      {cluster ? (
        <>
          <Tile icon={LanIcon} title="VNF · VIP" sub={`${cluster.vip ?? '—'} · ${cluster.name}`} dot={vmDot(cluster.state)} colour={colour} strong />
          <FlowLine colour={colour} vertical length={10} moving={/RUNNING/.test(cluster.state)} />
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Tile icon={AccountTreeIcon} title={t('ic.arch.masters', { n: count('master') })} colour={colour} />
            <Tile icon={MemoryIcon} title={t('ic.arch.workers', { n: count('worker') })} colour={colour} />
          </Box>
          <Tile icon={StorageIcon} title={count('storage') ? t('ic.arch.storage', { n: count('storage') }) : t('ic.arch.noStorage')} colour={colour} dashed={!count('storage')} />
        </>
      ) : (
        <Tile title={t('ic.zones.noCluster')} sub={<Link to="/console/infrastructure/marketplace?tab=clusters">{t('ic.arch.add')}</Link>} colour={colour} dashed />
      )}
    </Box>
  );
};

/** One lane per classification zone: its router on top, the routes down to each segregation. */
const ZoneLane = ({ z, live, segs, inter, colour }: { z: CatalogZone; live?: Zone; segs: Seg[]; inter: InterZone[]; colour: string }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const router = live?.router;
  const routerVm = router?.vms[0];
  const routerUp = !!router?.exists && vmDot(routerVm?.state) === 'ok';
  const clusters = segs.filter(s => s.cluster).length;
  const order: Record<string, number> = { programme: 0, landing: 1, integration: 1, common: 2 };
  const sorted = [...segs].sort((a, b) => order[a.kind] - order[b.kind] || (a.n ?? 0) - (b.n ?? 0));
  const empty = segs.length === 0;
  return (
    <Box
      data-zone={z.name}
      sx={{ flex: `${Math.max(1, segs.length)} 0 ${empty ? 170 : segs.length * 190}px`, minWidth: 0, border: `1px ${empty ? 'dashed' : 'solid'} ${c.line(colour)}`, borderRadius: '16px', bgcolor: c.wash(colour), p: 1.5, display: 'flex', flexDirection: 'column', gap: 0 }}
    >
      <Cap colour={colour}>
        {z.label ?? z.name}
        {z.block ? ` ${z.block}` : ''}
        {empty ? '' : ` · ${t('ic.arch.segs', { n: segs.length })} · ${t('ic.arch.clusters', { n: clusters })}`}
      </Cap>
      <Box sx={{ alignSelf: 'center', width: 'min(100%, 230px)', mt: 1.25 }}>
        <Tile
          icon={RouterIcon}
          title={router?.name ?? `vr-${z.name}`}
          sub={router?.exists ? `${t('ic.arch.router')} · ${routerVm?.ips[0] ?? live?.transit?.routerIp ?? routerVm?.state ?? ''}` : t('ic.arch.planned')}
          dot={router?.exists ? vmDot(routerVm?.state) : undefined}
          colour={colour}
          dashed={!router?.exists}
          strong
        />
      </Box>
      {empty ? (
        <Box sx={{ mt: 1.5, fontSize: 12, color: c.rq.muted }}>{z.enabled ? t('ic.zones.empty') : t('ic.zones.reservedSub')}</Box>
      ) : (
        <>
          <FlowLine colour={colour} vertical length={14} moving={routerUp} />
          <Box sx={{ px: `calc(50% / ${sorted.length})` }}>
            <FlowLine colour={colour} moving={routerUp} />
          </Box>
          <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: `repeat(${sorted.length}, minmax(0, 1fr))`, alignItems: 'start' }}>
            {sorted.map(s => (
              <Box key={s.id} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <FlowLine colour={colour} vertical length={14} moving={routerUp} />
                <SegBox seg={s} colour={colour} inter={inter.find(i => i.seg.id === s.id)} />
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

export const PlatformArchitecture = ({ view, segs, inter, role }: { view: InfraView; segs: Seg[]; inter: InterZone[]; role: SiteRole }) => {
  const c = useArchColours();
  const { t } = useI18n();
  const catalog: CatalogZone[] = view.catalog ?? view.zones.map(z => ({ name: z.name, label: z.label, status: z.status, enabled: true, block: z.block, programs: [] }));
  // the zones in use first; the hue of a zone stays the one of its place in the catalog
  const lanes = catalog.map((z, i) => ({ z, i, mine: segs.filter(s => s.zone === z.name) })).sort((a, b) => Number(b.mine.length > 0) - Number(a.mine.length > 0));
  const width = lanes.reduce((w, l) => w + (l.mine.length ? l.mine.length * 190 : 170) + 44, 0);
  const host = view.host;
  const inv = view.inventory;
  const rec = view.reconcile;
  const neutral = c.rq.control;
  const remote = role === 'core' ? 'edge' : 'core';
  return (
    <Box role="group" aria-label={t('ic.arch.label')} sx={{ overflowX: 'auto', pb: 1 }}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: c.rq.muted, mb: 1.5 }}>
        {lanes.filter(l => l.mine.length).map(l => (
          <Box component="span" key={l.z.name} sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
            <Box component="span" aria-hidden sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: c.hue(l.i) }} />
            {l.z.label ?? l.z.name}
          </Box>
        ))}
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
          <FlowLine colour={c.rq.ink} length={28} /> {t('ic.arch.legend.route')}
        </Box>
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
          <Box component="span" aria-hidden sx={{ width: 22, height: 12, border: `1px dashed ${c.rq.control}`, borderRadius: '4px' }} /> {t('ic.arch.legend.dashed')}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0, alignItems: 'stretch', minWidth: Math.max(860, width + 330) }}>
        <Box data-site={role} sx={{ flex: '1 1 auto', minWidth: 0, border: `1px solid ${c.rq.border}`, borderRadius: '20px', bgcolor: c.rq.raised, p: 2, display: 'grid', gap: 1.5, alignContent: 'start' }}>
          <Box sx={{ justifySelf: 'start', display: 'inline-flex', gap: 0.75, alignItems: 'center', border: `1px solid ${c.rq.border}`, bgcolor: c.rq.sheet, borderRadius: 999, px: 1.5, py: 0.25 }}>
            <Box component="span" aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: c.rq.positive }} />
            <Cap colour={c.rq.ink}>
              {t(`ic.site.${role}`)} · {host?.name ?? 'OpenNebula'}
              {host?.cpus !== undefined ? ` · ${host.cpus} vCPU` : ''}
              {host?.memoryGiB !== undefined ? ` · ${host.memoryGiB} GiB` : ''}
            </Cap>
          </Box>
          <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Tile icon={ComputerIcon} title={t('ic.arch.host')} sub={[host?.supernet, view.capacity?.freeMemoryMb !== undefined ? t('ic.arch.free', { gb: Math.round(view.capacity.freeMemoryMb / 1024) }) : ''].filter(Boolean).join(' · ') || '—'} colour={neutral} />
            <Tile icon={DnsIcon} title={t('ic.arch.dns')} sub={view.domain ?? t('ic.arch.unknown')} colour={neutral} dashed={!view.domain} />
            <Tile icon={Inventory2Icon} title={t('ic.arch.images')} sub={inv ? t('ic.arch.imagesSub', { images: inv.images.length, ds: inv.datastores.length }) : t('ic.arch.unknown')} colour={neutral} dashed={!inv} />
            <Tile icon={SyncIcon} title={t('ic.arch.reconcile')} sub={rec?.finished ? new Date(rec.finished).toLocaleString() : t('ic.arch.unknown')} dot={choose<Dot | undefined>([[!rec, undefined], [rec?.error, 'bad']], 'ok')} colour={neutral} dashed={!rec} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch' }}>
            {lanes.map(l => (
              <ZoneLane key={l.z.name} z={l.z} live={view.zones.find(x => x.name === l.z.name)} segs={l.mine} inter={inter} colour={c.hue(l.i)} />
            ))}
          </Box>
        </Box>
        {/* the other site of the interconnection: another OpenNebula, nothing of it is read here */}
        <Box sx={{ flex: 'none', width: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75 }}>
          <VpnLockIcon sx={{ fontSize: 20, color: c.rq.control }} />
          <FlowLine colour={c.rq.control} moving={false} />
          <Box component="span" sx={{ fontSize: 11, color: c.rq.muted, textAlign: 'center' }}>
            {t('ic.arch.tunnel')}
          </Box>
        </Box>
        <Box data-site="remote" sx={{ flex: 'none', width: 250, border: `1.5px dashed ${c.line(c.remote)}`, borderRadius: '20px', bgcolor: 'transparent', p: 2, display: 'grid', gap: 1.25, alignContent: 'start', color: c.rq.muted }}>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
            <CloudIcon sx={{ fontSize: 18, color: c.remote }} />
            <Cap colour={c.remote}>{t(`ic.site.${remote}`)}</Cap>
          </Box>
          <Box sx={{ fontSize: 13, fontWeight: 600, color: c.rq.ink }}>{t(`ic.page.noRemote.${role}`)}</Box>
          <Box sx={{ fontSize: 12, lineHeight: '17px' }}>{t(`ic.page.remoteWhy.${role}`)}</Box>
          <Tile icon={ShieldIcon} title={componentTitle('apisix', 'u2m')} sub={t(`ic.kind.${remote === 'edge' ? 'integration' : 'landing'}`)} colour={c.remote} dashed />
          <Tile icon={ShieldIcon} title={componentTitle('apisix', 'm2m')} sub={t(`ic.kind.${remote === 'edge' ? 'integration' : 'landing'}`)} colour={c.remote} dashed />
          <Box sx={{ fontFamily: MONO, fontSize: 11 }}>{t('ic.arch.remoteNote')}</Box>
        </Box>
      </Box>
    </Box>
  );
};
