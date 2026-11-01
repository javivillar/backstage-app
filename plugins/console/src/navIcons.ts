import type { SvgIconComponent } from '@mui/icons-material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import ApiIcon from '@mui/icons-material/Api';
import AppsIcon from '@mui/icons-material/Apps';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import CodeIcon from '@mui/icons-material/Code';
import ComputerIcon from '@mui/icons-material/Computer';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DatasetIcon from '@mui/icons-material/Dataset';
import DescriptionIcon from '@mui/icons-material/Description';
import EngineeringIcon from '@mui/icons-material/Engineering';
import BadgeIcon from '@mui/icons-material/Badge';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import GradeIcon from '@mui/icons-material/Grade';
import GridViewIcon from '@mui/icons-material/GridView';
import HubIcon from '@mui/icons-material/Hub';
import InsightsIcon from '@mui/icons-material/Insights';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import KeyIcon from '@mui/icons-material/Key';
import LanIcon from '@mui/icons-material/Lan';
import LayersIcon from '@mui/icons-material/Layers';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import LocalPoliceIcon from '@mui/icons-material/LocalPolice';
import MapIcon from '@mui/icons-material/Map';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import PaymentsIcon from '@mui/icons-material/Payments';
import RouterIcon from '@mui/icons-material/Router';
import ShieldIcon from '@mui/icons-material/Shield';
import StorageIcon from '@mui/icons-material/Storage';
import StorefrontIcon from '@mui/icons-material/Storefront';
import VerifiedIcon from '@mui/icons-material/Verified';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

/**
 * The icon of every entry of the console menus, by path (one place to change them: the proposal of the mock-up
 * "Console Menu Icons"). An entry without one shows no icon.
 */
export const NAV_ICONS: Record<string, SvgIconComponent> = {
  '/console/infrastructure/platform': LanIcon,
  '/console/infrastructure/marketplace': StorefrontIcon,
  '/console/infrastructure': MapIcon,
  '/console/infrastructure/vms': ComputerIcon,
  '/console/infrastructure/networks': RouterIcon,
  '/console/infrastructure/security-groups': LocalPoliceIcon,
  '/console/clusters': GridViewIcon,
  '/console/cluster': DashboardIcon,
  '/console/cluster/scale': OpenInFullIcon,
  '/console/network': HubIcon,
  '/console/applications': AppsIcon,
  '/console/storage': StorageIcon,
  '/console/cis-nodes': VerifiedUserIcon,
  '/console/cis-cluster': VerifiedIcon,
  '/console/images': LayersIcon,
  '/console': MenuBookIcon,
  '/console/create': AddCircleIcon,
  '/console/apis': ApiIcon,
  '/console/dependencies': AccountTreeIcon,
  '/console/docs': DescriptionIcon,
  '/console/quality': GradeIcon,
  '/console/costs': PaymentsIcon,
  '/console/ops-assistant': EngineeringIcon,
  '/console/sec-assistant': ShieldIcon,
  '/console/functional-assistant': LightbulbIcon,
  '/console/architect-assistant': ArchitectureIcon,
  '/console/developer-assistant': CodeIcon,
  '/console/manage': AppsIcon,
  '/console/app/support': SupportAgentIcon,
  '/console/app/personnelsecurity': BadgeIcon,
  '/console/keycloak': KeyIcon,
  '/console/gravitee': ApiIcon,
  '/console/datahub': DatasetIcon,
  '/console/superset': InsightsIcon,
  '/console/camunda': AccountTreeIcon,
  '/console/seaweedfs': Inventory2Icon,
  '/console/alfresco': DescriptionIcon,
  '/console/activepieces': HubIcon,
};
