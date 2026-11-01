import Box from '@mui/material/Box';
import type { MouseEvent, PropsWithChildren } from 'react';
import { useNavigate } from 'react-router-dom';
import { consolePathForClassic, useConsolePages } from '../pages';

/**
 * Frame for classic Backstage content inside the console: hides the classic page header (the console draws its own)
 * and keeps links to pages the console also shows inside the console.
 */
export const ClassicFrame = ({ children }: PropsWithChildren<{}>) => {
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
      }}
    >
      {children}
    </Box>
  );
};
