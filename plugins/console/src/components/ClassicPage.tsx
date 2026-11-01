import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { classicUrl, useConsoleConfig } from '../config';
import type { ConsoleClassicPage } from '../pages';
import { ClassicFrame } from './ClassicFrame';

/** /console/<id>/*: a classic page under the console header. */
export const ClassicPage = ({ page }: { page: ConsoleClassicPage }) => {
  const cfg = useConsoleConfig();
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {page.title}
        </Typography>
        <a href={classicUrl(cfg, page.classicPath)}>Open in the classic portal</a>
      </Box>
      <ClassicFrame>{page.element}</ClassicFrame>
    </Box>
  );
};
