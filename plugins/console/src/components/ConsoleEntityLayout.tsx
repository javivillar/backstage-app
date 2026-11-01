import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useResolvedPath } from 'react-router-dom';
import { rq } from './tokens';

/** The props of an EntityLayout.Route: the console reads the same children as the classic layout. */
type TabProps = { path: string; title: ReactNode; if?: (entity: never, ctx?: never) => boolean; children?: ReactNode };
type Tab = TabProps & { key: string };

/** Which group of the tab bar each tab goes to, by its path; anything else goes under More. */
export const TAB_GROUPS: Array<{ label: string; paths: string[] }> = [
  { label: 'Overview', paths: ['/'] },
  { label: 'Operate', paths: ['/live', '/network', '/dependencies', '/user-journey', '/changes', '/incidents'] },
  { label: 'Build', paths: ['/ci-cd', '/api', '/docs'] },
  { label: 'Secure', paths: ['/security', '/sbom', '/access'] },
  { label: 'Spend', paths: ['/costs'] },
];

/** The routes among the children, flattening fragments (the extra tabs come in one). */
export function collectTabs(children: ReactNode): Tab[] {
  const out: Tab[] = [];
  const walk = (node: ReactNode) =>
    Children.forEach(node, child => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        walk((child.props as { children?: ReactNode }).children);
        return;
      }
      const p = child.props as Partial<TabProps>;
      if (typeof p.path === 'string') out.push({ ...(p as TabProps), key: p.path });
    });
  walk(children);
  // a tab of the console replaces the classic one with the same path (it comes later, in the extra tabs)
  return out.filter((t, i) => !out.slice(i + 1).some(u => u.path === t.path));
}

/** Splits the visible tabs into the groups of the bar and the More menu (the order of the groups, not the code). */
export function groupTabs(tabs: Tab[]): { groups: Array<{ label: string; tabs: Tab[] }>; more: Tab[] } {
  const groups = TAB_GROUPS.map(g => ({ label: g.label, tabs: g.paths.map(p => tabs.find(t => t.path === p)).filter((t): t is Tab => !!t) })).filter(g => g.tabs.length);
  const placed = new Set(groups.flatMap(g => g.tabs.map(t => t.path)));
  return { groups, more: tabs.filter(t => !placed.has(t.path)) };
}

const tabSx = (on: boolean) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  px: 1.1,
  py: 0.6,
  borderRadius: '8px',
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
  color: on ? rq.blue : 'text.primary',
  bgcolor: on ? 'rgba(26,141,255,0.10)' : 'transparent',
  '& svg': { color: on ? rq.blue : 'text.secondary' },
  '&:hover': { bgcolor: on ? 'rgba(26,141,255,0.14)' : 'action.hover' },
  '&:focus-visible': { outline: `2px solid ${rq.blue}`, outlineOffset: 2 },
});

/**
 * The entity page of the console: the same tabs as the classic EntityLayout (same children), drawn as a bar of
 * groups (Overview · Operate · Build · Secure · Spend) with the rarer tabs under More.
 */
export const ConsoleEntityLayout = ({ children }: { children?: ReactNode }) => {
  const { entity } = useEntity();
  const base = useResolvedPath('.').pathname.replace(/\/+$/, '');
  const { pathname } = useLocation();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const tabs = collectTabs(children).filter(t => {
    try {
      return !t.if || t.if(entity as never);
    } catch {
      return false;
    }
  });
  const { groups, more } = groupTabs(tabs);
  const rest = pathname.slice(base.length) || '/';
  const current = tabs.filter(t => t.path !== '/' && (rest === t.path || rest.startsWith(`${t.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]?.path ?? '/';
  const to = (p: string) => `${base}${p === '/' ? '' : p}`;
  const inMore = more.find(t => t.path === current);
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box
        component="nav"
        aria-label="Sections"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', alignItems: 'flex-end', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '12px', px: 1.25, py: 0.75 }}
      >
        {groups.map(g => (
          <Box key={g.label} sx={{ display: 'grid', gap: 0.25 }}>
            <Box component="span" sx={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'text.secondary', pl: 1 }}>
              {g.label}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.25, flexWrap: 'wrap' }}>
              {g.tabs.map(t => (
                <Box key={t.key} component={Link} to={to(t.path)} aria-current={current === t.path ? 'page' : undefined} sx={tabSx(current === t.path)}>
                  {t.title}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        {more.length > 0 && (
          <Box sx={{ ml: 'auto' }}>
            <Button
              size="small"
              startIcon={<MoreHoriz />}
              onClick={e => setMenu(e.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={!!menu}
              sx={{ textTransform: 'none', color: inMore ? rq.blue : 'text.secondary', border: '1px dashed', borderColor: 'divider', borderRadius: '8px' }}
            >
              {inMore ? <Box component="span">{inMore.title}</Box> : 'More'}
            </Button>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              {more.map(t => (
                <MenuItem key={t.key} component={Link} to={to(t.path)} selected={current === t.path} onClick={() => setMenu(null)}>
                  {t.title}
                </MenuItem>
              ))}
            </Menu>
          </Box>
        )}
      </Box>
      <Routes>
        {tabs.map(t => (
          <Route key={t.key} path={t.path === '/' ? '/' : `${t.path}/*`} element={<>{t.children as ReactElement}</>} />
        ))}
        <Route path="*" element={<Navigate to={to('/')} replace />} />
      </Routes>
    </Box>
  );
};
