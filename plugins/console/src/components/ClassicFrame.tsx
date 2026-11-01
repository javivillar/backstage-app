import Box from '@mui/material/Box';
import type { MouseEvent, PropsWithChildren } from 'react';
import { useNavigate } from 'react-router-dom';
import { consolePathForClassic, useConsolePages } from '../pages';
import { rq } from './tokens';

/**
 * Frame for classic Backstage content inside the console: hides the classic page header (the console draws its own)
 * and keeps links to pages the console also shows inside the console.
 */
/** The classic entity tabs and cards in the look of the console (MUI class names are kept in production builds). */
const entityLook = {
  '& .MuiTabs-root': { borderBottom: '1px solid', borderColor: 'divider', minHeight: 44, bgcolor: 'transparent !important', boxShadow: 'none !important' },
  '& .MuiTabs-root .MuiTab-root': { textTransform: 'none', fontWeight: 500, fontSize: 14, minHeight: 44, minWidth: 'auto', px: 1.75, color: 'text.primary' },
  '& .MuiTabs-root .MuiTab-root.Mui-selected': { color: rq.primary, fontWeight: 600 },
  '& .MuiTabs-indicator': { bgcolor: `${rq.primary} !important`, height: 2 },
  '& .MuiCard-root': { borderRadius: '12px !important', boxShadow: 'none !important', border: '1px solid', borderColor: 'divider', transform: 'none !important' },
  '& .MuiCardHeader-title': { fontSize: '16px !important', fontWeight: '600 !important' },
  // the header area of the classic page above the tabs (title, labels) is replaced by the console header
  '& main > header + *': { bgcolor: 'transparent', boxShadow: 'none' },
  '& main > div > div[class*="MuiBox"]': { px: 0 },
};

export const ClassicFrame = ({ children, entity }: PropsWithChildren<{ entity?: boolean }>) => {
  const navigate = useNavigate();
  const pages = useConsolePages();
  const keepInConsole = (ev: MouseEvent) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = (ev.target as HTMLElement).closest('a');
    if (!a || a.target === '_blank' || a.origin !== window.location.origin) return;
    const to = consolePathForClassic(a.pathname, pages);
    if (!to) return;
    ev.preventDefault();
    navigate(to + a.search + a.hash);
  };
  return (
    <Box
      onClickCapture={keepInConsole}
      sx={{
        // Class names are minified in the production build: match the structure of the classic Page instead.
        '& main > header': { display: 'none !important' },
        '& main': { height: 'auto !important', minHeight: 0, overflowY: 'visible' },
        ...(entity ? entityLook : {}),
      }}
    >
      {children}
    </Box>
  );
};
