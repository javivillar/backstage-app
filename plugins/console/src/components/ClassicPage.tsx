import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ConsoleClassicPage } from '../pages';
import { ClassicFrame } from './ClassicFrame';
import { ClassicLink } from './ClassicLink';

/** /console/<id>/*: a classic page under the console header. */
export const ClassicPage = ({ page }: { page: ConsoleClassicPage }) => {
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {page.title}
        </Typography>
        <ClassicLink path={page.classicPath} />
      </Box>
      <ClassicFrame entity>{page.element}</ClassicFrame>
    </Box>
  );
};
