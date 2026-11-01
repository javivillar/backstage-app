import { Link } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { classicUrl, useConsoleConfig } from '../config';
import { entityPath } from './classify';
import { consoleEntityBase } from './ServiceData';

/**
 * A classic tab that Backstage can only draw under its own entity route (Kubernetes, Topology): what the console
 * shows instead, and the classic tab one click away.
 */
export const ClassicTabNote = ({ title, tab, instead }: { title: string; tab: string; instead: Array<[string, string]> }) => {
  const { entity } = useEntity();
  const cfg = useConsoleConfig();
  const base = consoleEntityBase(entity);
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2.5, bgcolor: 'background.paper', display: 'grid', gap: 1.25, maxWidth: 760 }}>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography color="text.secondary">
        The console shows the same in its own tabs:{' '}
        {instead.map(([label, path], i) => (
          <span key={path}>
            {i > 0 && ', '}
            <Link to={`${base}${path}`}>{label}</Link>
          </span>
        ))}
        .
      </Typography>
      <Typography>
        <a href={classicUrl(cfg, `${entityPath(entity)}${tab}`)} target="_blank" rel="noreferrer">
          Open the {title} tab of the classic portal
        </a>
      </Typography>
    </Box>
  );
};
