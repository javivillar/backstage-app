import { Entity } from '@backstage/catalog-model';
import { cloneElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import Dashboard from '@mui/icons-material/Dashboard';
import Lan from '@mui/icons-material/Lan';
import MonitorHeart from '@mui/icons-material/MonitorHeart';
import RouteIcon from '@mui/icons-material/Route';
import {
  EntityLiveContent,
  EntityNetworkContent,
  EntityUserJourneyContent,
  ServiceChanges,
  ServiceOverview,
  ServiceSecurity,
  ConsoleEntityLayout,
  EntityDependenciesContent,
  EntityApiContent,
  EntityCicdContent,
  EntityDocsContent,
  ClassicTabNote,
  TechInsightsChecks,
} from '@internal/plugin-console';
import GppMaybe from '@mui/icons-material/GppMaybe';
import History from '@mui/icons-material/History';
import Savings from '@mui/icons-material/Savings';
import RocketLaunch from '@mui/icons-material/RocketLaunch';
import Cloud from '@mui/icons-material/Cloud';
import AccountTree from '@mui/icons-material/AccountTree';
import Api from '@mui/icons-material/Api';
import Hub from '@mui/icons-material/Hub';
import Description from '@mui/icons-material/Description';
import Bolt from '@mui/icons-material/Bolt';
import Storage from '@mui/icons-material/Storage';
import Category from '@mui/icons-material/Category';
import VerifiedUser from '@mui/icons-material/VerifiedUser';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';
import Schedule from '@mui/icons-material/Schedule';
import Person from '@mui/icons-material/Person';
import Schema from '@mui/icons-material/Schema';
import Dataset from '@mui/icons-material/Dataset';
import GridView from '@mui/icons-material/GridView';
import Inventory from '@mui/icons-material/Inventory2';
import BubbleChart from '@mui/icons-material/BubbleChart';
import SupportAgent from '@mui/icons-material/SupportAgent';
import Key from '@mui/icons-material/Key';
import { EntitySecurityContent, isSecurityAvailable } from '@internal/plugin-keycloak';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  EntityAboutCard,
  EntityDependsOnComponentsCard,
  EntityDependsOnResourcesCard,
  EntityHasComponentsCard,
  EntityHasResourcesCard,
  EntityHasSubcomponentsCard,
  EntityHasSystemsCard,
  EntityLayout,
  EntityLinksCard,
  EntitySwitch,
  EntityOrphanWarning,
  EntityProcessingErrorsPanel,
  isComponentType,
  isKind,
  hasCatalogProcessingErrors,
  isOrphan,
  hasRelationWarnings,
  EntityRelationWarning,
} from '@backstage/plugin-catalog';
import {
  EntityUserProfileCard,
  EntityGroupProfileCard,
  EntityMembersListCard,
  EntityOwnershipCard,
} from '@backstage/plugin-org';
import { EntityTechdocsContent } from '@backstage/plugin-techdocs';
import { EmptyState } from '@backstage/core-components';
import {
  EntityApiDefinitionCard,
  EntityConsumedApisCard,
  EntityConsumingComponentsCard,
  EntityHasApisCard,
  EntityProvidedApisCard,
  EntityProvidingComponentsCard,
} from '@backstage/plugin-api-docs';
import {
  Direction,
  EntityCatalogGraphCard,
} from '@backstage/plugin-catalog-graph';
import {
  RELATION_API_CONSUMED_BY,
  RELATION_API_PROVIDED_BY,
  RELATION_CONSUMES_API,
  RELATION_DEPENDENCY_OF,
  RELATION_DEPENDS_ON,
  RELATION_HAS_PART,
  RELATION_PART_OF,
  RELATION_PROVIDES_API,
} from '@backstage/catalog-model';
import { TechDocsAddons } from '@backstage/plugin-techdocs-react';
import { ReportIssue } from '@backstage/plugin-techdocs-module-addons-contrib';

import { EntityKubernetesContent, isKubernetesAvailable } from '@backstage/plugin-kubernetes';
import { TopologyPage } from '@backstage-community/plugin-topology';
import { FillTopology } from './FillTopology';
import { EntityDatahubCard, EntityDatahubContent, isDatahubAvailable } from '@internal/plugin-datahub';
import { EntityQualityConsoleContent, EntityQualityDetailContent, EntitySbomContent, isSbomAvailable } from '@internal/plugin-sbom';
import { EntityTechInsightsScorecardContent } from '@backstage-community/plugin-tech-insights';
import { EntityServiceMetadataCard, hasServiceMetadata } from './EntityServiceMetadataCard';
import { EntityAvailabilityCard } from './EntityAvailabilityCard';
import { EntitySecurityCard } from './EntitySecurityCard';
import { EntitySupportContent } from './EntitySupportContent';
import { EntityImageContent, isImageAvailable } from '../images/EntityImageContent';
import { EntityCostCard } from '../cost/EntityCostCard';
import { EntityAssistantUsageCard } from '../cost/EntityAssistantUsageCard';
import { ConsoleCosts } from '../cost/ConsoleCosts';
import { NAMESPACE_ANNOTATION } from './usePrometheus';

// services of the stack: the catalog entities that say which namespace they run in
const hasNamespace = (entity: Entity) => Boolean(entity.metadata.annotations?.[NAMESPACE_ANNOTATION]);
import {
  IfKroResourceGraphAvailable,
  IfKroOverviewAvailable,
  KroOverviewCard,
  KroResourceGraph,
  isKroAvailable,
} from '@terasky/backstage-plugin-kro-resources-frontend';

import {
  EntityArgoWorkflowsOverviewCard,
  EntityArgoWorkflowsTemplateOverviewCard,
  isArgoWorkflowsAvailable,
} from '@internal/plugin-argo-workflows';
import {
  EntityApacheSparkContent,
  isApacheSparkAvailable,
} from '@internal/plugin-apache-spark';
import {
  EntityTerraformContent,
  isTerraformAvailable,
} from '@internal/plugin-terraform';
import {
  EntityArgoCDHistoryCard,
  EntityArgoCDOverviewCard,
  isArgocdAvailable,
} from '@roadiehq/backstage-plugin-argo-cd';
import { EntityGithubRunsCard } from './EntityGithubRunsCard';
import { EntityDeploymentChangesCard } from './EntityDeploymentChangesCard';
import { DEPLOYMENT_FILE_ANNOTATION, REPOSITORY_ANNOTATION, SLUG_ANNOTATION } from './useGithub';

const hasGithubSlug = (e: Entity) => Boolean(e.metadata.annotations?.[SLUG_ANNOTATION]);
const hasRepository = (e: Entity) => Boolean(e.metadata.annotations?.[REPOSITORY_ANNOTATION]);
const hasDeploymentFile = (e: Entity) => Boolean(e.metadata.annotations?.[DEPLOYMENT_FILE_ANNOTATION]);

/** The layout of an entity page: the classic EntityLayout, or the console's grouped tab bar (same Route children). */
type PageLayout = typeof EntityLayout;

// CSS grid layout helpers (replaces MUI Grid)
const grid12: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, 1fr)',
  gap: '24px',
  alignItems: 'stretch',
};
const span = (n: number): CSSProperties => ({ gridColumn: `span ${n}` });

// Tab label helper — renders icon + text inline
// EntityLayout.Route types title as string but renders ReactNode at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabLabel = (icon: ReactElement, text: string): any => (
  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
    {cloneElement(icon, { style: { fontSize: 18 } })}
    {text}
  </span>
);

// Chip style helpers for EntityMetadataBar
const chipBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  borderRadius: '16px',
  fontSize: '12px',
  padding: '4px 12px',
  fontWeight: 500,
};

const EntityMetadataBar = () => {
  const { entity } = useEntity();
  const lifecycle = (entity.spec?.lifecycle as string) || 'unknown';
  const type = (entity.spec?.type as string) || 'unknown';
  const owner = (entity.spec?.owner as string) || 'unknown';

  let lifecycleColor = { background: '#e3f2fd', color: '#1565c0' };
  if (lifecycle === 'production') {
    lifecycleColor = { background: '#e8f5e9', color: '#2e7d32' };
  } else if (lifecycle === 'experimental') {
    lifecycleColor = { background: '#fff8e1', color: '#f57f17' };
  }

  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '12px 0', gridColumn: 'span 12' }}>
      <span style={{ ...chipBase, background: '#e3f2fd', color: '#1565c0' }}>
        <Category style={{ fontSize: 14 }} />
        {type}
      </span>
      <span style={{ ...chipBase, ...lifecycleColor }}>
        <Schedule style={{ fontSize: 14 }} />
        {lifecycle}
      </span>
      <span style={{ ...chipBase, background: '#f3e5f5', color: '#7b1fa2' }}>
        <Person style={{ fontSize: 14 }} />
        {owner}
      </span>
    </div>
  );
};

const techdocsContent = (
  <EntityTechdocsContent>
    <TechDocsAddons>
      <ReportIssue />
    </TechDocsAddons>
  </EntityTechdocsContent>
);

// CI/CD: the CI of a repository (GitHub Actions), and for what Argo CD deploys, its deployments
// (Argo CD history, the changes merged to the file that deploys it, the CI of its repository).
const cicdContent = (
  <EntitySwitch>
    <EntitySwitch.Case if={hasGithubSlug}>
      <div style={grid12}>
        <div style={span(12)}>
          <EntityGithubRunsCard />
        </div>
      </div>
    </EntitySwitch.Case>
    <EntitySwitch.Case if={isArgocdAvailable}>
      <div style={grid12}>
        <div style={span(12)}>
          <EntityArgoCDHistoryCard />
        </div>
        <EntitySwitch>
          <EntitySwitch.Case if={hasDeploymentFile}>
            <div style={span(12)}>
              <EntityDeploymentChangesCard />
            </div>
          </EntitySwitch.Case>
        </EntitySwitch>
        <EntitySwitch>
          <EntitySwitch.Case if={hasRepository}>
            <div style={span(12)}>
              <EntityGithubRunsCard title="CI of its repository: GitHub Actions" />
            </div>
          </EntitySwitch.Case>
        </EntitySwitch>
      </div>
    </EntitySwitch.Case>
    <EntitySwitch.Case if={isArgoWorkflowsAvailable}>
      <div style={grid12}>
        <div style={span(12)}>
          <EntityArgoWorkflowsOverviewCard />
        </div>
        <div style={span(12)}>
          <EntityArgoWorkflowsTemplateOverviewCard />
        </div>
      </div>
    </EntitySwitch.Case>
    <EntitySwitch.Case>
      <EmptyState
        title="No CI/CD available for this entity"
        missing="info"
        description="You need to add an annotation to your component if you want to enable CI/CD for it. You can read more about annotations in Backstage by clicking the button below."
        action={
          <a href="https://backstage.io/docs/features/software-catalog/well-known-annotations">
            Read more
          </a>
        }
      />
    </EntitySwitch.Case>
  </EntitySwitch>
);

const entityWarningContent = (
  <>
    <EntitySwitch>
      <EntitySwitch.Case if={isOrphan}>
        <div style={span(12)}>
          <EntityOrphanWarning />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
    <EntitySwitch>
      <EntitySwitch.Case if={hasRelationWarnings}>
        <div style={span(12)}>
          <EntityRelationWarning />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
    <EntitySwitch>
      <EntitySwitch.Case if={hasCatalogProcessingErrors}>
        <div style={span(12)}>
          <EntityProcessingErrorsPanel />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
  </>
);

const overviewContent = (
  <div style={grid12}>
    <EntityMetadataBar />
    {entityWarningContent}
    <div style={span(6)}>
      <EntityAboutCard />
    </div>
    <div style={span(6)}>
      <EntityCatalogGraphCard height={400} />
    </div>
    <EntitySwitch>
      <EntitySwitch.Case if={hasServiceMetadata}>
        <div style={span(12)}>
          <EntityServiceMetadataCard />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
    <EntitySwitch>
      <EntitySwitch.Case if={hasNamespace}>
        <div style={span(12)}>
          <EntityAvailabilityCard />
        </div>
        <div style={span(12)}>
          <EntitySecurityCard />
        </div>
        <div style={span(12)}>
          <EntityCostCard />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
    <EntitySwitch>
      <EntitySwitch.Case if={isDatahubAvailable}>
        <div style={span(12)}>
          <EntityDatahubCard />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
    <EntitySwitch>
      <EntitySwitch.Case if={isArgocdAvailable}>
        <div style={span(12)}>
          <EntityArgoCDOverviewCard />
        </div>
      </EntitySwitch.Case>
    </EntitySwitch>
    <div style={span(4)}>
      <EntityLinksCard />
    </div>
    <div style={span(8)}>
      <EntityHasSubcomponentsCard />
    </div>
  </div>
);

const kubernetesContent = (
  <EntityKubernetesContent />
);

const kroDetailsContent = (
  <div style={grid12}>
    <div style={span(12)}>
      <IfKroOverviewAvailable>
        <KroOverviewCard />
      </IfKroOverviewAvailable>
    </div>
    <div style={span(12)}>
      <IfKroResourceGraphAvailable>
        <KroResourceGraph />
      </IfKroResourceGraphAvailable>
    </div>
  </div>
);

const dependenciesContent = (
  <div style={grid12}>
    <div style={span(6)}>
      <EntityDependsOnComponentsCard />
    </div>
    <div style={span(6)}>
      <EntityDependsOnResourcesCard />
    </div>
  </div>
);

/**
 * An application of the platform (it runs images with their SBOM, or is built on a line of the Python Framework):
 * its scorecard Quality & Security (Tech Insights; facts in plugins/sbom-backend/src/techInsights.ts).
 */
const isApplication = (entity: Entity) =>
  !(entity.metadata.tags ?? []).includes('framework-line') &&
  (!!entity.metadata.annotations?.['refresquito.io/sbom-images'] ||
    !!entity.metadata.annotations?.['refresquito.io/framework-line']);

/** the security assistant, about this project: its page with ?project=<name> (packages/app/.../SecAssistantPage.tsx) */
const AskSecurityAssistant = () => {
  const { entity } = useEntity();
  return (
    <div>
      <Button
        component={RouterLink}
        to={`/sec-assistant?project=${encodeURIComponent(entity.metadata.name)}`}
        variant="outlined"
        startIcon={<VerifiedUser />}
      >
        Ask the security assistant about this project
      </Button>
    </div>
  );
};

const qualityContent = (
  <div style={{ display: 'grid', gap: 16 }}>
    <AskSecurityAssistant />
    <EntityTechInsightsScorecardContent
      title="Quality & Security"
      description="What this application runs and how it is maintained: its catalog entry, the SBOM and vulnerabilities of its images, and the line of the Python Framework it is built on. Refreshed every hour."
    />
    {/* every test and the coverage of each file, from the quality report of its images */}
    <EntityQualityDetailContent />
  </div>
);

const serviceEntityPageWith = (extra?: ReactNode, overview?: ReactElement, Layout: PageLayout = EntityLayout) => (
  <Layout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      {overview ?? overviewContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/ci-cd" title={tabLabel(<RocketLaunch />, 'CI/CD')}>
      {cicdContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/kubernetes"
      title={tabLabel(<Cloud />, 'Kubernetes')}
      if={isKubernetesAvailable}
    >
      {kubernetesContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/topology"
      title={tabLabel(<BubbleChart />, 'Topology')}
      if={isKubernetesAvailable}
    >
      <FillTopology>
        <TopologyPage />
      </FillTopology>
    </EntityLayout.Route>
    <EntityLayout.Route path="/kro" title={tabLabel(<AccountTree />, 'Kro Details')} if={isKroAvailable}>
      {kroDetailsContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/api" title={tabLabel(<Api />, 'API')}>
      <div style={grid12}>
        <div style={span(6)}>
          <EntityProvidedApisCard />
        </div>
        <div style={span(6)}>
          <EntityConsumedApisCard />
        </div>
      </div>
    </EntityLayout.Route>
    <EntityLayout.Route path="/dependencies" title={tabLabel(<Hub />, 'Dependencies')}>
      {dependenciesContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/docs" title={tabLabel(<Description />, 'Docs')}>
      {techdocsContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/apache-spark"
      title={tabLabel(<Bolt />, 'Apache Spark')}
      if={isApacheSparkAvailable}
    >
      <EntityApacheSparkContent />
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/terraform"
      title={tabLabel(<Storage />, 'Terraform')}
      if={isTerraformAvailable}
    >
      <EntityTerraformContent />
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/datahub"
      title={tabLabel(<Dataset />, 'Data governance')}
      if={isDatahubAvailable}
    >
      <EntityDatahubContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/sbom" title={tabLabel(<Inventory />, 'SBOM')} if={isSbomAvailable}>
      <EntitySbomContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/quality" title={tabLabel(<VerifiedUser />, 'Quality & Security')} if={isApplication}>
      {qualityContent}
    </EntityLayout.Route>
    {/* the Keycloak groups, SSO clients and roles that govern it (attributes refresquito.* in Keycloak) */}
    <EntityLayout.Route path="/access" title={tabLabel(<Key />, 'Access')} if={isSecurityAvailable}>
      <EntitySecurityContent />
    </EntityLayout.Route>
    {/* the support: open an incident on this element, and its incidents (systems/support of refresquito-specs) */}
    <EntityLayout.Route path="/incidents" title={tabLabel(<SupportAgent />, 'Incidents')}>
      <EntitySupportContent />
    </EntityLayout.Route>
    {extra}
  </Layout>
);

const websiteEntityPageWith = (extra?: ReactNode, overview?: ReactElement, Layout: PageLayout = EntityLayout) => (
  <Layout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      {overview ?? overviewContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/ci-cd" title={tabLabel(<RocketLaunch />, 'CI/CD')}>
      {cicdContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/kubernetes"
      title={tabLabel(<Cloud />, 'Kubernetes')}
      if={isKubernetesAvailable}
    >
      {kubernetesContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/topology"
      title={tabLabel(<BubbleChart />, 'Topology')}
      if={isKubernetesAvailable}
    >
      <FillTopology>
        <TopologyPage />
      </FillTopology>
    </EntityLayout.Route>
    <EntityLayout.Route path="/kro" title={tabLabel(<AccountTree />, 'Kro Details')} if={isKroAvailable}>
      {kroDetailsContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/dependencies" title={tabLabel(<Hub />, 'Dependencies')}>
      {dependenciesContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/docs" title={tabLabel(<Description />, 'Docs')}>
      {techdocsContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/apache-spark"
      title={tabLabel(<Bolt />, 'Apache Spark')}
      if={isApacheSparkAvailable}
    >
      <EntityApacheSparkContent />
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/terraform"
      title={tabLabel(<Storage />, 'Terraform')}
      if={isTerraformAvailable}
    >
      <EntityTerraformContent />
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/datahub"
      title={tabLabel(<Dataset />, 'Data governance')}
      if={isDatahubAvailable}
    >
      <EntityDatahubContent />
    </EntityLayout.Route>
    {extra}
  </Layout>
);

const resourceGroupPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      <div style={grid12}>
        {entityWarningContent}
        <div style={span(6)}>
          <EntityAboutCard />
        </div>
        <div style={span(6)}>
          <EntityCatalogGraphCard height={400} />
        </div>
        <div style={span(4)}>
          <EntityLinksCard />
        </div>
        <div style={span(8)}>
          <IfKroOverviewAvailable>
            <KroOverviewCard />
          </IfKroOverviewAvailable>
        </div>
      </div>
    </EntityLayout.Route>
    <EntityLayout.Route path="/kro" title={tabLabel(<AccountTree />, 'Kro Details')} if={isKroAvailable}>
      {kroDetailsContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/kubernetes"
      title={tabLabel(<Cloud />, 'Kubernetes')}
      if={isKubernetesAvailable}
    >
      <EntityKubernetesContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/dependencies" title={tabLabel(<Hub />, 'Dependencies')}>
      {dependenciesContent}
    </EntityLayout.Route>
    <EntityLayout.Route path="/docs" title={tabLabel(<Description />, 'Docs')}>
      {techdocsContent}
    </EntityLayout.Route>
  </EntityLayout>
);

const defaultEntityPageWith = (extra?: ReactNode, overview?: ReactElement, Layout: PageLayout = EntityLayout) => (
  <Layout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      {overview ?? overviewContent}
    </EntityLayout.Route>
    {/* an image of the image catalog (Harbor): its vulnerabilities with the VEX, SBOM, provenance, history */}
    <EntityLayout.Route path="/image" title={tabLabel(<Inventory />, 'Image')} if={isImageAvailable}>
      <EntityImageContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/docs" title={tabLabel(<Description />, 'Docs')}>
      {techdocsContent}
    </EntityLayout.Route>
    <EntityLayout.Route
      path="/datahub"
      title={tabLabel(<Dataset />, 'Data governance')}
      if={isDatahubAvailable}
    >
      <EntityDatahubContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/sbom" title={tabLabel(<Inventory />, 'SBOM')} if={isSbomAvailable}>
      <EntitySbomContent />
    </EntityLayout.Route>
    {/* the Keycloak groups, SSO clients and roles that govern it (attributes refresquito.* in Keycloak) */}
    <EntityLayout.Route path="/access" title={tabLabel(<Key />, 'Access')} if={isSecurityAvailable}>
      <EntitySecurityContent />
    </EntityLayout.Route>
    {/* the support: open an incident on this element, and its incidents (systems/support of refresquito-specs) */}
    <EntityLayout.Route path="/incidents" title={tabLabel(<SupportAgent />, 'Incidents')}>
      <EntitySupportContent />
    </EntityLayout.Route>
    {extra}
  </Layout>
);
const defaultEntityPage = defaultEntityPageWith();

const componentPageWith = (extra?: ReactNode, overview?: ReactElement, Layout: PageLayout = EntityLayout) => (
  <EntitySwitch>
    <EntitySwitch.Case if={isComponentType('service')}>
      {serviceEntityPageWith(extra, overview, Layout)}
    </EntitySwitch.Case>
    <EntitySwitch.Case if={isComponentType('website')}>
      {websiteEntityPageWith(extra, overview, Layout)}
    </EntitySwitch.Case>
    <EntitySwitch.Case>{defaultEntityPageWith(extra, overview, Layout)}</EntitySwitch.Case>
  </EntitySwitch>
);

const apiPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      <div style={grid12}>
        {entityWarningContent}
        <div style={span(6)}>
          <EntityAboutCard />
        </div>
        <div style={span(6)}>
          <EntityCatalogGraphCard height={400} />
        </div>
        <div style={span(4)}>
          <EntityLinksCard />
        </div>
        <div style={span(6)}>
          <EntityProvidingComponentsCard />
        </div>
        <div style={span(6)}>
          <EntityConsumingComponentsCard />
        </div>
      </div>
    </EntityLayout.Route>
    <EntityLayout.Route path="/definition" title={tabLabel(<Schema />, 'Definition')}>
      <div style={grid12}>
        <div style={span(12)}>
          <EntityApiDefinitionCard />
        </div>
      </div>
    </EntityLayout.Route>
  </EntityLayout>
);

const userPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      <div style={grid12}>
        {entityWarningContent}
        <div style={span(6)}>
          <EntityUserProfileCard />
        </div>
        <div style={span(6)}>
          <EntityOwnershipCard />
        </div>
      </div>
    </EntityLayout.Route>
  </EntityLayout>
);

const groupPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      <div style={grid12}>
        {entityWarningContent}
        <div style={span(6)}>
          <EntityGroupProfileCard />
        </div>
        <div style={span(6)}>
          <EntityOwnershipCard />
        </div>
        <div style={span(6)}>
          <EntityMembersListCard />
        </div>
        <div style={span(6)}>
          <EntityLinksCard />
        </div>
      </div>
    </EntityLayout.Route>
  </EntityLayout>
);

const systemPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      <div style={grid12}>
        {entityWarningContent}
        <div style={span(6)}>
          <EntityAboutCard />
        </div>
        <div style={span(6)}>
          <EntityCatalogGraphCard height={400} />
        </div>
        <div style={span(4)}>
          <EntityLinksCard />
        </div>
        <div style={span(8)}>
          <EntityHasComponentsCard />
        </div>
        <div style={span(6)}>
          <EntityHasApisCard />
        </div>
        <div style={span(6)}>
          <EntityHasResourcesCard />
        </div>
        <div style={span(6)}>
          <EntityAssistantUsageCard />
        </div>
      </div>
    </EntityLayout.Route>
    <EntityLayout.Route path="/diagram" title={tabLabel(<GridView />, 'Diagram')}>
      <EntityCatalogGraphCard
        direction={Direction.TOP_BOTTOM}
        title="System Diagram"
        height={700}
        relations={[
          RELATION_PART_OF,
          RELATION_HAS_PART,
          RELATION_API_CONSUMED_BY,
          RELATION_API_PROVIDED_BY,
          RELATION_CONSUMES_API,
          RELATION_PROVIDES_API,
          RELATION_DEPENDENCY_OF,
          RELATION_DEPENDS_ON,
        ]}
        unidirectional={false}
      />
    </EntityLayout.Route>
  </EntityLayout>
);

const domainPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title={tabLabel(<Dashboard />, 'Overview')}>
      <div style={grid12}>
        {entityWarningContent}
        <div style={span(6)}>
          <EntityAboutCard />
        </div>
        <div style={span(6)}>
          <EntityCatalogGraphCard height={400} />
        </div>
        <div style={span(6)}>
          <EntityHasSystemsCard />
        </div>
      </div>
    </EntityLayout.Route>
  </EntityLayout>
);

const entityPageWith = (componentExtra?: ReactNode, componentOverview?: ReactElement, Layout: PageLayout = EntityLayout) => (
  <EntitySwitch>
    <EntitySwitch.Case if={isKind('component')} children={componentPageWith(componentExtra, componentOverview, Layout)} />
    <EntitySwitch.Case if={isKind('api')} children={apiPage} />
    <EntitySwitch.Case if={isKind('group')} children={groupPage} />
    <EntitySwitch.Case if={isKind('user')} children={userPage} />
    <EntitySwitch.Case if={isKind('system')} children={systemPage} />
    <EntitySwitch.Case if={isKind('domain')} children={domainPage} />
    <EntitySwitch.Case
      if={isKind('resourcegroup')}
      children={resourceGroupPage}
    />
    <EntitySwitch.Case>{defaultEntityPage}</EntitySwitch.Case>
  </EntitySwitch>
);

export const entityPage = entityPageWith();

/** In the console, a component that says its namespace gets the console's own Overview; any other, the classic one. */
const ConsoleOverview = () => {
  const { entity } = useEntity();
  if (!hasNamespace(entity)) return overviewContent;
  // the cards that read their own data stay as they are, inside the console's Overview
  return (
    <ServiceOverview
      slots={{
        availability: <EntityAvailabilityCard />,
        argo: isArgocdAvailable(entity) ? <EntityArgoCDOverviewCard /> : undefined,
        serviceMetadata: hasServiceMetadata(entity) ? <EntityServiceMetadataCard /> : undefined,
        datahub: isDatahubAvailable(entity) ? <EntityDatahubCard /> : undefined,
      }}
    />
  );
};

/**
 * The entity page inside the console (/console/entity/...): the same tabs, the console's Overview, plus Live, Network,
 * User journey, Changes, Security and Costs of a component that says its namespace. The classic portal keeps
 * entityPage as it is.
 */
export const consoleEntityPage = entityPageWith(
  <>
    <EntityLayout.Route path="/live" title={tabLabel(<MonitorHeart />, 'Live')} if={hasNamespace}>
      <EntityLiveContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/network" title={tabLabel(<Lan />, 'Network')} if={hasNamespace}>
      <EntityNetworkContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/dependencies" title={tabLabel(<Hub />, 'Dependencies')}>
      <EntityDependenciesContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/ci-cd" title={tabLabel(<RocketLaunch />, 'CI/CD')}>
      <EntityCicdContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/api" title={tabLabel(<Api />, 'API')}>
      <EntityApiContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/quality" title={tabLabel(<VerifiedUser />, 'Quality & Security')} if={isApplication}>
      <EntityQualityConsoleContent
        ask={<AskSecurityAssistant />}
        scorecard={<TechInsightsChecks />}
      />
    </EntityLayout.Route>
    {/* TechDocs, Kubernetes and Topology only route under the classic entity page: the console reads the docs itself */}
    <EntityLayout.Route path="/docs" title={tabLabel(<Description />, 'Docs')}>
      <EntityDocsContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/kubernetes" title={tabLabel(<Cloud />, 'Kubernetes')} if={isKubernetesAvailable}>
      <ClassicTabNote title="Kubernetes" tab="/kubernetes" instead={[['Live', '/live'], ['Network', '/network'], ['Changes', '/changes']]} />
    </EntityLayout.Route>
    <EntityLayout.Route path="/topology" title={tabLabel(<BubbleChart />, 'Topology')} if={isKubernetesAvailable}>
      <ClassicTabNote title="Topology" tab="/topology" instead={[['Dependencies', '/dependencies'], ['Network', '/network']]} />
    </EntityLayout.Route>
    <EntityLayout.Route path="/user-journey" title={tabLabel(<RouteIcon />, 'User journey')} if={hasNamespace}>
      <EntityUserJourneyContent />
    </EntityLayout.Route>
    <EntityLayout.Route path="/changes" title={tabLabel(<History />, 'Changes')} if={hasNamespace}>
      <ServiceChanges />
    </EntityLayout.Route>
    <EntityLayout.Route path="/security" title={tabLabel(<GppMaybe />, 'Security')} if={hasNamespace}>
      <ServiceSecurity />
    </EntityLayout.Route>
    <EntityLayout.Route path="/costs" title={tabLabel(<Savings />, 'Costs')} if={hasNamespace}>
      <ConsoleCosts />
    </EntityLayout.Route>
  </>,
  <ConsoleOverview />,
  ConsoleEntityLayout as PageLayout,
);
