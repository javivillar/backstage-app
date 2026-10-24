import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useFillViewport } from '../shared/useFillViewport';

/**
 * Around the Topology tab (community plugin), to make it fill the window. The page of the plugin is a routable
 * extension: it must be a child in the element tree of the routes (EntityPage), not rendered from in here, or Backstage
 * does not discover it ("Routable extension component ... was not discovered").
 * The plugin asks its card for 100 % of the height, but the
 * content of that card has none, so the canvas stayed at its minimum (about 150 px): here the card and its content
 * become a column whose last part, the canvas, takes what is left.
 */
export const FillTopology = ({ children }: { children: ReactNode }) => {
  const { ref, height } = useFillViewport<HTMLDivElement>([], { min: 400, bottom: 36 });
  return (
    <Box
      ref={ref}
      sx={{
        height,
        '& .pf-ri__topology, & .bs-topology-wrapper': { height: '100%', display: 'flex', flexDirection: 'column' },
        '& .bs-topology-wrapper > div:last-child': { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
        '& .bs-topology-wrapper > div:last-child > *': { flex: 1, minHeight: 0 },
      }}
    >
      {children}
    </Box>
  );
};
