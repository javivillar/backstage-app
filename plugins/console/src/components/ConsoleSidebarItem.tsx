import { SidebarItem } from '@backstage/core-components';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import { useConsoleAccess } from '../access';

/** "Console" in the classic sidebar: only where the console is enabled and for the users allowed to open it. */
export const ConsoleSidebarItem = () => {
  const { enabled, allowed } = useConsoleAccess();
  if (!enabled || !allowed) return null;
  return <SidebarItem icon={DashboardCustomizeIcon} to="console" text="Console (beta)" />;
};
