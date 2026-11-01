import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import ExpandMore from '@mui/icons-material/ExpandMore';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { type PropsWithChildren, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { classicUrl, useConsoleConfig } from '../config';
import { type ConsoleClassicPage, classicPathForConsole, useConsolePages } from '../pages';
import { type Layer, LAYER_HOME, LAYER_LOOK, layerOf } from '../layers';
import { rq } from './tokens';
import { Badge } from './Badge';
import { QuickFind } from './QuickFind';

const EMBED_KEY = 'rq-console-embedded';

/** ?embed=1 (the console of another cluster frames this one): remembered for the session of the frame. */
export function useEmbedded(search: string): boolean {
  const asked = new URLSearchParams(search).get('embed') === '1';
  try {
    if (asked) sessionStorage.setItem(EMBED_KEY, '1');
    return asked || sessionStorage.getItem(EMBED_KEY) === '1';
  } catch {
    return asked;
  }
}

/** The classic page that shows the same thing as a page of the console. */
export function classicPathFor(consolePath: string, pages: ConsoleClassicPage[] = []): string {
  const same = classicPathForConsole(consolePath, pages);
  if (same) return same;
  if (consolePath.startsWith('/console/cluster') && !consolePath.startsWith('/console/clusters')) return '/topology';
  if (consolePath.startsWith('/console/infrastructure')) return '/topology';
  return '/home';
}

type NavItem = { label: string; to: string };

const NavGroup = ({ title, items, current }: { title: string; items: NavItem[]; current: string }) => (
  <Box component="nav" aria-label={title} sx={{ display: 'grid', gap: 0.25, mb: 2 }}>
    <Typography variant="overline" sx={{ px: 2, color: 'text.secondary', lineHeight: 2 }}>
      {title}
    </Typography>
    {items.map(i => {
      const on =
        current === i.to ||
        (i.to !== '/console' && i.to !== '/console/infrastructure' && current.startsWith(`${i.to}/`)) ||
        (i.to === '/console' && current.startsWith('/console/entity/'));
      return (
        <Link
          key={i.to}
          to={i.to}
          underline="none"
          aria-current={on ? 'page' : undefined}
          style={{
            display: 'block',
            padding: '7px 16px',
            borderLeft: `3px solid ${on ? rq.blue : 'transparent'}`,
            background: on ? 'rgba(26,141,255,0.10)' : 'transparent',
            color: 'inherit',
            fontWeight: on ? 600 : 400,
          }}
        >
          {i.label}
        </Link>
      );
    })}
  </Box>
);

/** One step of the scope trail (Zone › Cluster › Portal): current one highlighted. */
const Scope = ({ label, sub, on, onClick, menu }: { label: string; sub: string; on: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void; menu?: boolean }) => (
  <Button
    onClick={onClick}
    aria-current={on ? 'true' : undefined}
    aria-haspopup={menu ? 'menu' : undefined}
    endIcon={menu ? <ExpandMore /> : undefined}
    variant="text"
    size="small"
    sx={{
      color: '#fff',
      textTransform: 'none',
      px: 1.25,
      py: 0.5,
      borderRadius: '8px',
      border: '1px solid',
      borderColor: on ? 'rgba(255,255,255,0.55)' : 'transparent',
      bgcolor: on ? 'rgba(255,255,255,0.14)' : 'transparent',
      display: 'flex',
      gap: 0.75,
      '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' },
    }}
  >
    <span style={{ color: '#B9D3EA', fontSize: 12 }}>{sub}</span>
    <span style={{ fontWeight: on ? 700 : 500 }}>{label}</span>
  </Button>
);

/**
 * The frame of the console: top bar with the scope trail (Zone › Cluster › Portal, the three administrators: IaaS,
 * cluster, portal of its services), a band that names the layer, and the menu of that layer only.
 */
export const ConsoleShell = ({ embedded, children }: PropsWithChildren<{ embedded: boolean }>) => {
  const cfg = useConsoleConfig();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const current = pathname.replace(/\/+$/, '') || '/console';
  const own = cfg.cluster;
  const pages = useConsolePages();
  const layer = layerOf(current, pages);
  const look = LAYER_LOOK[layer];
  const navOf = (l: ConsoleClassicPage['layer']) => pages.filter(p => p.layer === l).map(p => ({ label: p.title, to: `/console/${p.id}` }));
  const zoneName = own.zone ? `Zone ${own.zone}` : 'Infrastructure';

  const groups: Array<{ title: string; items: NavItem[] }> = [];
  if (layer === 'infra') {
    groups.push({
      title: zoneName,
      items: [
        { label: 'Overview', to: '/console/infrastructure' },
        { label: 'Virtual machines', to: '/console/infrastructure/vms' },
        { label: 'Networks', to: '/console/infrastructure/networks' },
        { label: 'Security groups', to: '/console/infrastructure/security-groups' },
      ],
    });
    groups.push({ title: 'Kubernetes clusters', items: [{ label: `${own.id} (this one)`, to: '/console/cluster' }, { label: 'All clusters', to: '/console/clusters' }] });
  } else if (layer === 'cluster') {
    groups.push({
      title: `Cluster ${own.id}`,
      items: [
        { label: 'Overview', to: '/console/cluster' },
        { label: 'Network', to: '/console/network' },
        { label: 'Applications', to: '/console/applications' },
        { label: 'Storage', to: '/console/storage' },
        ...navOf('cluster'),
      ],
    });
    groups.push({ title: 'Its portal', items: [{ label: 'Open the portal', to: '/console' }] });
  } else {
    groups.push({ title: 'Portal', items: [{ label: 'Home', to: '/console' }, ...navOf('portal')] });
    if (navOf('assistants').length) groups.push({ title: 'Assistants', items: navOf('assistants') });
    if (navOf('managers').length) groups.push({ title: 'Manage', items: navOf('managers') });
  }

  const band: Record<Layer, { text: string; next?: { label: string; to: string } }> = {
    infra: { text: `${zoneName} · OpenNebula: hosts, VMs, networks, security groups and the Kubernetes clusters of its programmes. Read-only.`, next: { label: `Enter cluster ${own.id}`, to: '/console/cluster' } },
    cluster: { text: `Cluster ${own.id} · nodes, network, applications, storage and hardening of this Kubernetes cluster.`, next: { label: 'Open its portal', to: '/console' } },
    portal: { text: `Portal of ${own.id} · the business applications and Refresquito services that run in this cluster.` },
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {!embedded && (
        <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, bgcolor: rq.navy, color: '#fff', flexWrap: 'wrap' }}>
          <Link to="/console" underline="none" style={{ color: '#fff', fontWeight: 600, fontSize: 17 }}>
            Refresquito Console
          </Link>
          <Badge label="beta" bg={rq.accent} fg="#14202E" />
          <Box component="nav" aria-label="Scope" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <Scope label={own.zone ?? 'zone'} sub="Zone" on={layer === 'infra'} onClick={() => navigate(LAYER_HOME.infra)} />
            <Box component="span" aria-hidden sx={{ color: '#7FA6C9' }}>
              ›
            </Box>
            <Scope label={own.id} sub="Cluster" on={layer === 'cluster'} menu onClick={e => setMenu(e.currentTarget)} />
            <Box component="span" aria-hidden sx={{ color: '#7FA6C9' }}>
              ›
            </Box>
            <Scope label="Portal" sub="" on={layer === 'portal'} onClick={() => navigate(LAYER_HOME.portal)} />
          </Box>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <ListSubheader>This cluster</ListSubheader>
            <MenuItem selected={layer === 'cluster'} onClick={() => { setMenu(null); navigate(LAYER_HOME.cluster); }}>
              {own.id} ({own.kind}) · cluster
            </MenuItem>
            <MenuItem onClick={() => { setMenu(null); navigate(LAYER_HOME.portal); }}>
              {own.id} · its portal
            </MenuItem>
            {cfg.clusters.length > 0 && <ListSubheader>Other clusters</ListSubheader>}
            {cfg.clusters.map(c => (
              <MenuItem key={c.id} onClick={() => { setMenu(null); navigate(`/console/clusters/${encodeURIComponent(c.id)}`); }}>
                {c.id} ({c.kind})
              </MenuItem>
            ))}
            <MenuItem onClick={() => { setMenu(null); navigate('/console/clusters'); }}>All clusters…</MenuItem>
          </Menu>
          <Box sx={{ flex: 1 }} />
          <QuickFind />
          <Button href={classicUrl(cfg, classicPathFor(current, pages))} endIcon={<OpenInNew fontSize="small" />} size="small" sx={{ color: '#fff', textTransform: 'none' }}>
            Classic view
          </Button>
        </Box>
      )}
      <Box
        role="note"
        aria-label={`Layer: ${look.name}`}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.75, bgcolor: look.bg, color: look.fg, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', fontSize: 13 }}
      >
        <Box component="span" sx={{ fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', fontSize: 12 }}>
          {look.name}
        </Box>
        <Box component="span" sx={{ flex: '1 1 300px' }}>
          {band[layer].text}
        </Box>
        {band[layer].next && (
          <Link to={band[layer].next!.to} style={{ color: look.fg, fontWeight: 600 }}>
            {band[layer].next!.label} →
          </Link>
        )}
      </Box>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        <Box sx={{ width: { xs: '100%', md: 220 }, flexShrink: 0, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider', pt: 2, bgcolor: 'background.paper' }}>
          {groups.map(g => (
            <NavGroup key={g.title} title={g.title} items={g.items} current={current} />
          ))}
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};
