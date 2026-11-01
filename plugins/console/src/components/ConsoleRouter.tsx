import { Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useConsoleAccess } from '../access';
import { classicUrl, useConsoleConfig } from '../config';
import { type ConsoleClassicPage, ConsolePagesContext } from '../pages';
import { ClassicPage } from './ClassicPage';
import { AppFrame } from './AppFrame';
import { ClusterFrame } from './ClusterFrame';
import { ClusterOverviewPage } from './ClusterOverviewPage';
import { NetworkPage } from './NetworkPage';
import { ApplicationsPage } from './ApplicationsPage';
import { StoragePage } from './StoragePage';
import { NamespacePage } from './NamespacePage';
import { CisNodesPage } from './CisNodesPage';
import { ImageCatalogPage } from './ImageCatalogPage';
import { ZoneNetworksPage, ZoneOverviewPage, ZoneSecurityGroupsPage, ZoneVmsPage } from './ZonePages';
import { ConsoleEntityPage } from './ConsoleEntityPage';
import { MarketplacePage, PlatformPage } from './InfraPages';
import { ClusterScalePage } from './ClusterScalePage';
import { ProgrammePage, VmDetailPage } from './InfraDetail';
import { CisClusterPage } from './CisClusterPage';
import { ManageHubPage, ManageServicePage } from './ManagePages';
import { ClustersPage } from './ClustersPage';
import { ConsoleShell, useEmbedded } from './ConsoleShell';
import { DependencyExplorer } from './DependencyExplorer';
import { NewAppWizard } from './NewAppWizard';
import { PortalHome } from './PortalHome';
import { PortalApisPage, PortalDocsPage, PortalQualityPage } from './PortalIndexes';

/** Pages of the classic list (App) that the console has its own version of. */
const NATIVE = new Set(['cis-nodes', 'images', 'docs', 'apis', 'quality', 'dependencies']);

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
        {/* pages the console draws itself; their classic version stays at its classic path */}
        <Route path="/cis-nodes" element={<CisNodesPage />} />
        <Route path="/docs" element={<PortalDocsPage />} />
        <Route path="/apis" element={<PortalApisPage />} />
        <Route path="/quality" element={<PortalQualityPage />} />
        <Route path="/dependencies" element={<DependencyExplorer />} />
        <Route path="/development/:template" element={<NewAppWizard />} />
        <Route path="/images" element={<ImageCatalogPage />} />
        {pages.filter(p => !NATIVE.has(p.id)).map(p => (
          <Route key={p.id} path={p.nested ? `/${p.id}/*` : `/${p.id}`} element={<ClassicPage page={p} />} />
        ))}
        <Route path="/clusters" element={<ClustersPage />} />
        <Route path="/clusters/:id" element={<ClusterFrame />} />
        <Route path="/app/:application" element={<AppFrame />} />
        <Route path="/cluster" element={<ClusterOverviewPage />} />
        <Route path="/cluster/scale" element={<ClusterScalePage />} />
        <Route path="/cis-cluster" element={<CisClusterPage />} />
        <Route path="/manage" element={<ManageHubPage />} />
        <Route path="/manage/:id" element={<ManageServicePage />} />
        <Route path="/network" element={<NetworkPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/namespaces/:ns" element={<NamespacePage />} />
        <Route path="/infrastructure" element={<ZoneOverviewPage />} />
        <Route path="/infrastructure/vms" element={<ZoneVmsPage />} />
        <Route path="/infrastructure/networks" element={<ZoneNetworksPage />} />
        <Route path="/infrastructure/security-groups" element={<ZoneSecurityGroupsPage />} />
        <Route path="/infrastructure/platform" element={<PlatformPage />} />
        <Route path="/infrastructure/marketplace" element={<MarketplacePage />} />
        <Route path="/infrastructure/platform/:zone/:program" element={<ProgrammePage />} />
        <Route path="/infrastructure/clusters/:zone/:program" element={<ClusterScalePage />} />
        <Route path="/infrastructure/vm/:name" element={<VmDetailPage />} />
        <Route path="*" element={<Message title="Page not found">This page of the console does not exist.</Message>} />
        </Routes>
      </ConsoleShell>
    </ConsolePagesContext.Provider>
  );
};
