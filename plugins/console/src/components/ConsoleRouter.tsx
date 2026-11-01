import { Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useConsoleAccess } from '../access';
import { classicUrl, useConsoleConfig } from '../config';
import { type ConsoleClassicPage, ConsolePagesContext } from '../pages';
import { ClassicPage } from './ClassicPage';
import { ClusterFrame } from './ClusterFrame';
import { ClusterOverviewPage } from './ClusterOverviewPage';
import { NetworkPage } from './NetworkPage';
import { ApplicationsPage } from './ApplicationsPage';
import { StoragePage } from './StoragePage';
import { NamespacePage } from './NamespacePage';
import { ZoneNetworksPage, ZoneOverviewPage, ZoneSecurityGroupsPage, ZoneVmsPage } from './ZonePages';
import { ConsoleEntityPage } from './ConsoleEntityPage';
import { ClustersPage } from './ClustersPage';
import { ConsoleShell, useEmbedded } from './ConsoleShell';
import { PortalHome } from './PortalHome';

const Message = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box sx={{ maxWidth: 560, mx: 'auto', mt: 12, px: 2, display: 'grid', gap: 1.5 }}>
    <Typography variant="h5" component="h1">
      {title}
    </Typography>
    <Typography color="text.secondary" component="div">
      {children}
    </Typography>
  </Box>
);

/**
 * /console/*: off unless console.enabled, and only for console.allowedGroups.
 * entityContent: the classic entity page (EntityLayout with its tabs), reused in /console/entity/...
 * pages: classic pages shown in the console menus (create, docs, costs...), reused in /console/<id>/...
 */
export const ConsoleRouter = ({ entityContent, pages = [] }: { entityContent?: React.ReactNode; pages?: ConsoleClassicPage[] }) => {
  const access = useConsoleAccess();
  const cfg = useConsoleConfig();
  const embedded = useEmbedded(useLocation().search);
  if (access.loading) return <Progress />;
  if (!access.enabled) {
    return (
      <Message title="The console is not enabled in this portal">
        This portal works as always: <a href={classicUrl(cfg, '/home')}>go to the home page</a>.
      </Message>
    );
  }
  if (!access.allowed) {
    return (
      <Message title="The console is in beta">
        Only members of {cfg.allowedGroups.join(', ')} can open it for now. Everything is still available in the{' '}
        <a href={classicUrl(cfg, '/home')}>classic portal</a>.
      </Message>
    );
  }
  return (
    <ConsolePagesContext.Provider value={pages}>
      <ConsoleShell embedded={embedded}>
        <Routes>
        <Route path="/" element={<PortalHome />} />
        <Route path="/entity/:namespace/:kind/:name/*" element={<ConsoleEntityPage content={entityContent} />} />
        {pages.map(p => (
          <Route key={p.id} path={p.nested ? `/${p.id}/*` : `/${p.id}`} element={<ClassicPage page={p} />} />
        ))}
        <Route path="/clusters" element={<ClustersPage />} />
        <Route path="/clusters/:id" element={<ClusterFrame />} />
        <Route path="/cluster" element={<ClusterOverviewPage />} />
        <Route path="/network" element={<NetworkPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/namespaces/:ns" element={<NamespacePage />} />
        <Route path="/infrastructure" element={<ZoneOverviewPage />} />
        <Route path="/infrastructure/vms" element={<ZoneVmsPage />} />
        <Route path="/infrastructure/networks" element={<ZoneNetworksPage />} />
        <Route path="/infrastructure/security-groups" element={<ZoneSecurityGroupsPage />} />
        <Route path="*" element={<Message title="Page not found">This page of the console does not exist.</Message>} />
        </Routes>
      </ConsoleShell>
    </ConsolePagesContext.Provider>
  );
};
