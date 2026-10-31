import { Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useConsoleAccess } from '../access';
import { classicUrl, useConsoleConfig } from '../config';
import { ClusterFrame } from './ClusterFrame';
import { ClustersPage } from './ClustersPage';
import { ConsoleShell, useEmbedded } from './ConsoleShell';
import { PlannedPage } from './PlannedPage';
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

/** /console/*: off unless console.enabled, and only for console.allowedGroups. */
export const ConsoleRouter = () => {
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
    <ConsoleShell embedded={embedded}>
      <Routes>
        <Route path="/" element={<PortalHome />} />
        <Route path="/clusters" element={<ClustersPage />} />
        <Route path="/clusters/:id" element={<ClusterFrame />} />
        <Route
          path="/cluster"
          element={
            <PlannedPage
              title={`Cluster ${cfg.cluster.id}`}
              phase="3"
              summary="Nodes, Refresquito services installed, scale, network, storage, hardening and backups of this cluster, read from Kubernetes, Argo CD and Longhorn."
              classic={[
                { label: 'Topology', path: '/topology' },
                { label: 'CIS nodes', path: '/cis-nodes' },
                { label: 'Costs', path: '/costs' },
                { label: 'Images', path: '/images' },
              ]}
            />
          }
        />
        <Route
          path="/infrastructure"
          element={
            <PlannedPage
              title={`Infrastructure of ${cfg.cluster.zone ?? cfg.cluster.id}`}
              phase="4"
              summary="The OpenNebula of the zone (hosts, VMs, networks, security groups) and the marketplace of programme clusters. Only in zone clusters."
              classic={[{ label: 'Topology', path: '/topology' }]}
            />
          }
        />
        <Route path="*" element={<Message title="Page not found">This page of the console does not exist.</Message>} />
      </Routes>
    </ConsoleShell>
  );
};
