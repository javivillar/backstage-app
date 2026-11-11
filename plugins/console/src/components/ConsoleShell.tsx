import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMore from '@mui/icons-material/ExpandMore';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { classicUrl, useConsoleConfig } from '../config';
import { type ConsoleClassicPage, classicPathForConsole, useConsolePages } from '../pages';
import { type Layer, LAYER_HOME, layerOf } from '../layers';
import { useRq } from '../theme/consoleTheme';
import refresquitoIcon from '../assets/refresquito-icon.png';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ComputerIcon from '@mui/icons-material/Computer';
import GridViewIcon from '@mui/icons-material/GridView';
import StorefrontIcon from '@mui/icons-material/Storefront';
import { NAV_ICONS } from '../navIcons';
import { usePortalLinks } from '../portalApps';
import LaunchIcon from '@mui/icons-material/Launch';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import BadgeIcon from '@mui/icons-material/Badge';

/** Icons of the applications of the Portal menu (console.portalApps[].icon). */
const APP_ICONS: Record<string, typeof LaunchIcon> = { incidents: ReportProblemIcon, accreditation: BadgeIcon };
import { QuickFind } from './QuickFind';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitch } from './LanguageSwitch';
import { useI18n } from '../i18n';

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

type NavItem = { label: string; to: string; hint?: string; external?: boolean; icon?: string };

const NavGroup = ({ title, items, current }: { title: string; items: NavItem[]; current: string }) => {
  const t = useRq();
  return (
    <Box component="nav" aria-label={title} sx={{ display: 'grid', gap: '2px', mb: 2 }}>
      <Typography component="h2" sx={{ px: 1.25, pb: 0.5, fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'text.secondary' }}>
        {title}
      </Typography>
      {items.map(i => {
        const on =
          current === i.to ||
          (!['/console', '/console/infrastructure', '/console/infrastructure/overview', '/console/cluster', '/console/manage'].includes(i.to) && current.startsWith(`${i.to}/`)) ||
          (i.to === '/console' && current.startsWith('/console/entity/'));
        const Icon = (i.icon && APP_ICONS[i.icon]) || (i.external ? LaunchIcon : NAV_ICONS[i.to] ?? NAV_ICONS[i.to.replace('/console/manage/', '/console/')]);
        const link = (
          <Link
            key={i.to}
            to={i.to}
            {...(i.external ? { target: '_blank', rel: 'noreferrer' } : {})}
            underline="none"
            aria-current={on ? 'page' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 10px',
              borderRadius: 6,
              background: on ? t.active : 'transparent',
              color: on ? t.ink : t.muted,
              fontWeight: on ? 500 : 400,
              fontSize: 14,
              lineHeight: '20px',
            }}
          >
            {Icon && (
              <Box component="span" aria-hidden sx={{ display: 'inline-flex', color: on ? t.data : t.muted, '& svg': { fontSize: 18 } }}>
                <Icon />
              </Box>
            )}
            {i.label}
          </Link>
        );
        return i.hint ? (
          <Tooltip key={i.to} title={i.hint} placement="right" arrow>
            {link}
          </Tooltip>
        ) : (
          link
        );
      })}
    </Box>
  );
};

/** One step of the scope trail (Zone / Cluster / Portal): the current layer is shaded. */
const Scope = ({ label, sub, on, onClick, menu }: { label: string; sub?: string; on: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void; menu?: boolean }) => (
  <Button
    onClick={onClick}
    aria-current={on ? 'true' : undefined}
    aria-haspopup={menu ? 'menu' : undefined}
    endIcon={menu ? <ExpandMore sx={{ fontSize: '16px !important' }} /> : undefined}
    variant="text"
    size="small"
    sx={{ color: 'text.secondary', px: 1, minWidth: 0, height: 32, gap: 0.5, bgcolor: on ? 'action.selected' : 'transparent', '& .MuiButton-endIcon': { ml: 0.25 } }}
  >
    {sub && <span>{sub}</span>}
    <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
      {label}
    </Box>
  </Button>
);

/** Classic pages the Business management group lists itself (not again under Portal). */
const BUSINESS_PAGES = new Set(['/console/continuity']);
/** Classic pages of the FinOps group: what the services cost and how good they are. */
const FINOPS_PAGES = new Set(['/console/costs', '/console/quality']);

const LAYER_KEY: Record<Layer, string> = { infra: 'shell.platform', cluster: 'shell.cluster', portal: 'shell.portal' };

/**
 * The frame of the console: a top bar on the tinted frame (the logo switches between the three consoles, the scope
 * trail Zone / Cluster / Portal picks where), the menu of the layer on the frame, and the page on a white sheet.
 */
export const ConsoleShell = ({ embedded, children }: PropsWithChildren<{ embedded: boolean }>) => {
  const cfg = useConsoleConfig();
  const t = useRq();
  const { t: tr, has } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [consoles, setConsoles] = useState<HTMLElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const current = pathname.replace(/\/+$/, '') || '/console';
  const own = cfg.cluster;
  // the global CSS of the classic portal restyles MUI buttons and chips; body.rq-console keeps the console out of it
  useEffect(() => {
    document.body.classList.add('rq-console');
    return () => document.body.classList.remove('rq-console');
  }, []);
  useEffect(() => setNavOpen(false), [current]);
  const pages = useConsolePages();
  const portalLinks = usePortalLinks();
  const layer = layerOf(current, pages);
  const navOf = (l: ConsoleClassicPage['layer']) => pages.filter(p => p.layer === l).map(p => ({ label: has(`page.${p.id}`) ? tr(`page.${p.id}`) : p.title, to: `/console/${p.id}`, hint: p.product }));
  const zoneName = own.zone ? `${tr('shell.zone')} ${own.zone}` : tr('nav.infrastructure');

  const groups: Array<{ title: string; items: NavItem[] }> = [];
  if (layer === 'infra') {
    groups.push({
      title: tr('nav.platform'),
      items: [
        { label: tr('nav.overview'), to: '/console/infrastructure/overview' },
        { label: tr('nav.marketplace'), to: '/console/infrastructure/marketplace' },
        { label: tr('nav.zonesSegregations'), to: '/console/infrastructure/platform' },
        { label: tr('nav.k8sClusters'), to: '/console/clusters' },
        { label: tr('nav.interconnection'), to: '/console/infrastructure/interconnection' },
      ],
    });
    groups.push({
      title: zoneName,
      items: [
        { label: tr('nav.infrastructure'), to: '/console/infrastructure' },
        { label: tr('nav.vms'), to: '/console/infrastructure/vms' },
        { label: tr('nav.networks'), to: '/console/infrastructure/networks' },
        { label: tr('nav.securityGroups'), to: '/console/infrastructure/security-groups' },
        { label: tr('nav.templates'), to: '/console/infrastructure/templates' },
        { label: tr('nav.zoneStorage'), to: '/console/infrastructure/storage' },
      ],
    });
  } else if (layer === 'cluster') {
    groups.push({
      title: tr('nav.cluster', { cluster: own.id }),
      items: [
        { label: tr('nav.overview'), to: '/console/cluster' },
        { label: tr('nav.applications'), to: '/console/applications' },
        { label: tr('nav.network'), to: '/console/network' },
        { label: tr('nav.scale'), to: '/console/cluster/scale' },
        { label: tr('nav.storage'), to: '/console/storage' },
        ...navOf('cluster'),
        { label: tr('nav.cisCluster'), to: '/console/cis-cluster' },
      ],
    });
    groups.push({ title: tr('nav.yourClusters'), items: [{ label: tr('nav.allYouAdminister'), to: '/console/your-clusters' }] });
    groups.push({ title: zoneName, items: [{ label: tr('nav.infrastructure'), to: '/console/infrastructure' }] });
    groups.push({ title: tr('nav.itsPortal'), items: [{ label: tr('nav.openPortal'), to: '/console' }] });
  } else {
    groups.push({
      title: tr('nav.portal'),
      items: [
        { label: tr('nav.catalogue'), to: '/console', hint: tr('nav.catalogue.hint') },
        ...navOf('portal').filter(i => !BUSINESS_PAGES.has(i.to) && !FINOPS_PAGES.has(i.to)),
      ],
    });
    // the continuity of the business: its processes (the business map), its data, and the digital continuity of the
    // Refresquito services (the classic page Continuity, shown here under the portal)
    groups.push({
      title: tr('nav.businessManagement'),
      items: [
        { label: tr('nav.businessMap'), to: '/console/business-map', hint: tr('nav.businessMap.hint') },
        { label: tr('nav.dataContinuity'), to: '/console/data-continuity', hint: tr('nav.dataContinuity.hint') },
        { label: tr('nav.digitalContinuity'), to: '/console/continuity', hint: tr('nav.digitalContinuity.hint') },
      ],
    });
    const finops = navOf('portal').filter(i => FINOPS_PAGES.has(i.to));
    if (finops.length) groups.push({ title: tr('nav.finops'), items: finops });
    // the templates of a new application, opened in the console's own scaffolder (Portal › Create), not the classic one
    groups.push({
      title: tr('nav.development'),
      items: [
        { label: tr('nav.frameworks'), to: '/console/frameworks', hint: tr('nav.frameworks.hint') },
        { label: tr('nav.heatmap'), to: '/console/heatmap', hint: tr('nav.heatmap.hint') },
        { label: tr('nav.newPython'), to: '/console/development/python-framework-app', hint: tr('nav.newPython.hint') },
        { label: tr('nav.newSpring'), to: '/console/development/spring-framework-app', hint: tr('nav.newSpring.hint') },
        { label: tr('nav.newFramework'), to: '/console/new-framework', hint: tr('nav.newFramework.hint') },
      ],
    });
    // the applications of the platform (Incidents, Accreditation), the dashboards of everything and the teams that resolve
    groups.push({
      title: tr('nav.support'),
      items: [
        ...portalLinks.map(l => ({ label: l.label, to: `/console/app/${l.application}`, hint: l.hint, icon: l.icon })),
        { label: tr('nav.monitoring'), to: '/console/monitoring', hint: tr('nav.monitoring.hint') },
        { label: tr('nav.resolutionGroups'), to: '/console/resolution-groups', hint: tr('nav.resolutionGroups.hint') },
      ],
    });
    if (navOf('assistants').length) groups.push({ title: tr('nav.assistants'), items: navOf('assistants') });
    if (navOf('managers').length)
      groups.push({
        title: tr('nav.manage'),
        items: [
          { label: tr('nav.allServices'), to: '/console/manage' },
          ...navOf('managers').map(i => ({ ...i, to: i.to.replace('/console/', '/console/manage/') })),
          // who is in the Keycloak groups of each product (AccessAdminPage): its administrators and the portal's
          { label: tr('nav.accessAdmin'), to: '/console/access-administration', hint: tr('nav.accessAdmin.hint') },
        ],
      });
  }

  const CONSOLES: Array<{ layer: Layer; Icon: typeof ComputerIcon; what: string }> = [
    { layer: 'infra', Icon: ComputerIcon, what: tr('shell.platform.what') },
    { layer: 'cluster', Icon: GridViewIcon, what: tr('shell.cluster.what', { cluster: own.id }) },
    { layer: 'portal', Icon: StorefrontIcon, what: tr('shell.portal.what') },
  ];
  const go = (to: string) => {
    setMenu(null);
    setConsoles(null);
    navigate(to);
  };

  return (
    <Box className="rq-console-root" sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '232px minmax(0, 1fr)' }, gridTemplateRows: 'auto 1fr', bgcolor: t.frame }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1, gridColumn: { xs: '1', md: '1' } }}>
        <Button
          onClick={e => setConsoles(e.currentTarget)}
          aria-haspopup="menu"
          aria-label={tr('shell.switchConsole')}
          endIcon={<ExpandMore sx={{ color: 'text.secondary' }} />}
          sx={{ color: 'text.primary', px: 1, gap: 0.5, fontSize: 16, fontWeight: 600 }}
        >
          <Box component="img" src={refresquitoIcon} alt="" sx={{ width: 26, height: 26, borderRadius: '6px', mr: 0.75 }} />
          Refresquito
          <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 14, ml: 0.5 }}>
            {tr(LAYER_KEY[layer])}
          </Box>
        </Button>
        <Box sx={{ ml: 'auto', display: { md: 'none' } }}>
          <ThemeToggle />
        </Box>
        <IconButton aria-label={tr('shell.menu')} onClick={() => setNavOpen(o => !o)} aria-expanded={navOpen} sx={{ display: { md: 'none' } }}>
          <MenuIcon />
        </IconButton>
      </Box>
      <Menu anchorEl={consoles} open={!!consoles} onClose={() => setConsoles(null)} slotProps={{ paper: { sx: { minWidth: 300 } } }}>
        {CONSOLES.map(c => (
          <MenuItem key={c.layer} selected={layer === c.layer} onClick={() => go(LAYER_HOME[c.layer])} sx={{ gap: 1.25, py: 1, alignItems: 'flex-start' }}>
            <Box component="span" sx={{ width: 28, height: 28, borderRadius: '6px', display: 'grid', placeItems: 'center', flex: 'none', bgcolor: layer === c.layer ? t.dataSoft : t.raised, color: layer === c.layer ? t.data : t.muted, '& svg': { fontSize: 18 } }}>
              <c.Icon />
            </Box>
            <Box component="span" sx={{ display: 'grid' }}>
              <span style={{ fontWeight: 500 }}>{tr(LAYER_KEY[c.layer])}</span>
              <span style={{ fontSize: 12, color: t.muted }}>{c.what}</span>
            </Box>
          </MenuItem>
        ))}
      </Menu>
      {!embedded && (
        <Box component="header" sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.5, pr: 2, py: 1, minWidth: 0 }}>
          <Box component="nav" aria-label={tr('shell.scope')} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
            <Scope label={own.zone ?? 'zone'} sub={tr('shell.zone')} on={layer === 'infra'} onClick={() => navigate(LAYER_HOME.infra)} />
            <Box component="span" aria-hidden sx={{ color: t.control, px: 0.25 }}>
              /
            </Box>
            <Scope label={own.id} sub={tr('shell.cluster')} on={layer === 'cluster'} menu onClick={e => setMenu(e.currentTarget)} />
            <Box component="span" aria-hidden sx={{ color: t.control, px: 0.25 }}>
              /
            </Box>
            <Scope label={tr('shell.portal')} on={layer === 'portal'} onClick={() => navigate(LAYER_HOME.portal)} />
          </Box>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <ListSubheader sx={{ lineHeight: '32px', fontSize: 12 }}>{tr('shell.thisCluster')}</ListSubheader>
            <MenuItem selected={layer === 'cluster'} onClick={() => go(LAYER_HOME.cluster)}>
              {own.id} ({own.kind}) · {tr('shell.cluster').toLowerCase()}
            </MenuItem>
            <MenuItem onClick={() => go(LAYER_HOME.portal)}>{own.id} · {tr('shell.itsPortal')}</MenuItem>
            {cfg.clusters.length > 0 && <ListSubheader sx={{ lineHeight: '32px', fontSize: 12 }}>{tr('shell.otherClusters')}</ListSubheader>}
            {cfg.clusters.map(c => (
              <MenuItem key={c.id} onClick={() => go(`/console/clusters/${encodeURIComponent(c.id)}`)}>
                {c.id} ({c.kind})
              </MenuItem>
            ))}
            <MenuItem onClick={() => go('/console/clusters')}>{tr('shell.allClusters')}</MenuItem>
          </Menu>
          <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            <QuickFind />
          </Box>
          <Button href={classicUrl(cfg, classicPathFor(current, pages))} endIcon={<OpenInNew sx={{ fontSize: '16px !important' }} />} size="small" variant="text" sx={{ color: 'text.secondary' }}>
            {tr('shell.classic')}
          </Button>
          <LanguageSwitch />
          <ThemeToggle />
        </Box>
      )}
      <Box
        component="aside"
        aria-label={tr('shell.sections')}
        sx={{ display: { xs: navOpen ? 'block' : 'none', md: 'block' }, px: 1.5, pt: 1, pb: 3, gridColumn: '1', gridRow: { md: '2' } }}
      >
        {groups.map(g => (
          <NavGroup key={g.title} title={g.title} items={g.items} current={current} />
        ))}
      </Box>
      <Box
        component="main"
        sx={{
          minWidth: 0,
          gridColumn: { xs: '1', md: '2' },
          gridRow: { md: '2' },
          bgcolor: t.sheet,
          borderRadius: { xs: '16px 16px 0 0', md: '16px 0 0 0' },
          border: `1px solid ${t.border}`,
          borderRight: 0,
          borderBottom: 0,
          px: { xs: 2, md: 3.5 },
          py: { xs: 2, md: 3 },
        }}
      >
        {children}
      </Box>
    </Box>
  );
};
