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
import { ContinuityPage, ContinuityServicePage } from './ContinuityPage';
import { ZoneNetworksPage, ZoneOverviewPage, ZoneSecurityGroupsPage, ZoneVmsPage } from './ZonePages';
import { ConsoleEntityPage } from './ConsoleEntityPage';
import { MarketplacePage, PlatformOverviewPage, PlatformPage } from './InfraPages';
import { ClusterScalePage } from './ClusterScalePage';
import { ProgrammePage, VmDetailPage } from './InfraDetail';
import { CisClusterPage } from './CisClusterPage';
import { ManageHubPage, ManageServicePage } from './ManagePages';
import { ClustersPage, YourClustersPage } from './ClustersPage';
import { ConsoleShell, useEmbedded } from './ConsoleShell';
import { ConsoleTheme } from '../theme/consoleTheme';
import { I18nProvider } from '../i18n';
import { DependencyExplorer } from './DependencyExplorer';
import { MonitoringPage } from './MonitoringPage';
import { BusinessMapPage } from './businessMap/BusinessMapPage';
import { BusinessExplorerPage } from './businessMap/ExplorerPage';
import { BusinessHeatmapPage } from './businessMap/HeatmapPage';
import { BusinessGlassPage } from './businessMap/GlassPage';
import { BusinessMatrixPage } from './businessMap/MatrixPage';
import { ImportModelPage } from './businessMap/ImportModelPage';
import { AdoptModelPage } from './businessMap/AdoptModelPage';
import { ProcessFormPage } from './businessMap/ProcessFormPage';
import { DataContinuityPage } from './businessMap/DataContinuityPage';
import { FrameworksPage } from './frameworks/FrameworksPage';
import { FrameworkLinePage } from './frameworks/FrameworkLinePage';
import { HeatmapPage } from './frameworks/HeatmapPage';
import { NewAppWizard } from './NewAppWizard';
import { PortalHome } from './PortalHome';
import { PortalApisPage, PortalDocsPage, PortalQualityPage, ResolutionGroupsPage } from './PortalIndexes';

/** Pages of the classic list (App) that the console has its own version of. */
const NATIVE = new Set(['cis-nodes', 'images', 'continuity', 'docs', 'apis', 'quality', 'dependencies']);

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
 * apiDefinition: the classic definition card of an API (Swagger UI with Try it out), shown in the API's Definition tab.
 * pages: classic pages shown in the console menus (create, docs, costs...), reused in /console/<id>/...
 */
export const ConsoleRouter = ({ entityContent, pages = [], apiDefinition }: { entityContent?: React.ReactNode; pages?: ConsoleClassicPage[]; apiDefinition?: React.ReactNode }) => {
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
      <I18nProvider>
      <ConsoleTheme>
      <ConsoleShell embedded={embedded}>
        <Routes>
        <Route path="/" element={<PortalHome />} />
        <Route path="/entity/:namespace/:kind/:name/*" element={<ConsoleEntityPage content={entityContent} apiDefinition={apiDefinition} />} />
        {/* pages the console draws itself; their classic version stays at its classic path */}
        <Route path="/cis-nodes" element={<CisNodesPage />} />
        <Route path="/docs" element={<PortalDocsPage />} />
        <Route path="/apis" element={<PortalApisPage />} />
        <Route path="/quality" element={<PortalQualityPage />} />
        <Route path="/dependencies" element={<DependencyExplorer />} />
        <Route path="/resolution-groups" element={<ResolutionGroupsPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/business-map" element={<BusinessMapPage />} />
        <Route path="/business-map/explorer" element={<BusinessExplorerPage />} />
        <Route path="/business-map/heat" element={<BusinessHeatmapPage />} />
        <Route path="/business-map/glass" element={<BusinessGlassPage />} />
        <Route path="/business-map/matrix" element={<BusinessMatrixPage />} />
        {/* the templates of the business map as console forms (no Scaffolder page) */}
        <Route path="/business-map/import" element={<ImportModelPage />} />
        <Route path="/business-map/adopt" element={<AdoptModelPage />} />
        <Route path="/business-map/process/new" element={<ProcessFormPage mode="new" />} />
        <Route path="/business-map/process/edit/:namespace/:name" element={<ProcessFormPage mode="edit" />} />
        <Route path="/data-continuity" element={<DataContinuityPage />} />
        <Route path="/development/:template" element={<NewAppWizard />} />
        <Route path="/frameworks" element={<FrameworksPage />} />
        <Route path="/frameworks/:line" element={<FrameworkLinePage />} />
        <Route path="/heatmap" element={<HeatmapPage />} />
        <Route path="/images" element={<ImageCatalogPage />} />
        <Route path="/continuity" element={<ContinuityPage />} />
        <Route path="/continuity/:service" element={<ContinuityServicePage />} />
        {pages.filter(p => !NATIVE.has(p.id)).map(p => (
          <Route key={p.id} path={p.nested ? `/${p.id}/*` : `/${p.id}`} element={<ClassicPage key={p.id} page={p} />} />
        ))}
        <Route path="/clusters" element={<ClustersPage />} />
        <Route path="/your-clusters" element={<YourClustersPage />} />
        <Route path="/infrastructure/overview" element={<PlatformOverviewPage />} />
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
      </ConsoleTheme>
      </I18nProvider>
    </ConsolePagesContext.Provider>
  );
};
