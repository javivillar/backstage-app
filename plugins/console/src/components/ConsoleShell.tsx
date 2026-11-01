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
        (i.to !== '/console' && current.startsWith(`${i.to}/`)) ||
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

/** Top bar (brand, cluster selector, classic view) and the menu of the layers of this cluster. */
export const ConsoleShell = ({ embedded, children }: PropsWithChildren<{ embedded: boolean }>) => {
  const cfg = useConsoleConfig();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const current = pathname.replace(/\/+$/, '') || '/console';
  const own = cfg.cluster;
  const pages = useConsolePages();
  const navOf = (layer: ConsoleClassicPage['layer']) =>
    pages.filter(p => p.layer === layer).map(p => ({ label: p.title, to: `/console/${p.id}` }));

  const layers: Array<{ title: string; items: NavItem[] }> = [];
  if (own.kind === 'zone') {
    layers.push({ title: 'Infrastructure', items: [{ label: 'Overview', to: '/console/infrastructure' }] });
  }
  layers.push({ title: 'Cluster', items: [{ label: 'Overview', to: '/console/cluster' }, { label: 'Network', to: '/console/network' }, { label: 'Applications', to: '/console/applications' }, { label: 'Storage', to: '/console/storage' }, ...navOf('cluster')] });
  layers.push({ title: 'Portal', items: [{ label: 'Home', to: '/console' }, ...navOf('portal')] });
  layers.push({ title: 'Clusters', items: [{ label: 'All clusters', to: '/console/clusters' }] });

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {!embedded && (
        <Box
          component="header"
          sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, bgcolor: rq.navy, color: '#fff', flexWrap: 'wrap' }}
        >
          <Link to="/console" underline="none" style={{ color: '#fff', fontWeight: 600, fontSize: 17 }}>
            Refresquito Console
          </Link>
          <Button
            onClick={e => setMenu(e.currentTarget)}
            endIcon={<ExpandMore />}
            aria-haspopup="menu"
            sx={{ color: '#fff', border: '1px solid rgba(255,255,255,0.4)', textTransform: 'none', px: 1.5 }}
            variant="text"
            size="small"
          >
            {own.id} · {own.kind}
          </Button>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <ListSubheader>This cluster</ListSubheader>
            <MenuItem selected onClick={() => { setMenu(null); navigate('/console'); }}>
              {own.id} ({own.kind})
            </MenuItem>
            {cfg.clusters.length > 0 && <ListSubheader>Other clusters</ListSubheader>}
            {cfg.clusters.map(c => (
              <MenuItem key={c.id} onClick={() => { setMenu(null); navigate(`/console/clusters/${encodeURIComponent(c.id)}`); }}>
                {c.id} ({c.kind})
              </MenuItem>
            ))}
          </Menu>
          <Badge label="beta" bg={rq.accent} fg="#14202E" />
          <Box sx={{ flex: 1 }} />
          <QuickFind />
          <Button
            href={classicUrl(cfg, classicPathFor(current, pages))}
            endIcon={<OpenInNew fontSize="small" />}
            size="small"
            sx={{ color: '#fff', textTransform: 'none' }}
          >
            Classic view
          </Button>
        </Box>
      )}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        <Box
          sx={{
            width: { xs: '100%', md: 220 },
            flexShrink: 0,
            borderRight: { md: 1 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: 'divider',
            pt: 2,
            bgcolor: 'background.paper',
          }}
        >
          {layers.map(l => (
            <NavGroup key={l.title} title={l.title} items={l.items} current={current} />
          ))}
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};
