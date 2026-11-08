import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';

/** STUB of worker F so its branch compiles: worker E owns the view tabs (Map · Heat map · Glass · Matrix). */
export const BusinessMapTabs = () => (
  <Box component="nav" aria-label="Business map views" sx={{ display: 'flex', gap: 2 }}>
    <Link to="/console/business-map">Map</Link>
    <Link to="/console/business-map/heat">Heat map</Link>
    <Link to="/console/business-map/glass">Glass</Link>
    <Link to="/console/business-map/matrix">Matrix</Link>
  </Box>
);
