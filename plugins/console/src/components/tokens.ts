/**
 * Literal colours of the console, from the design tokens (theme/consoleTheme.tsx, light values). Prefer the theme
 * (palette, useRq()) in new code; these keep older components on the same palette. Business applications green,
 * Refresquito services blue.
 */
export const rq = {
  navy: '#0f2a44',
  blue: '#0c4595',
  primary: '#0c4595',
  accent: '#b45309',
  biz: { bg: '#dcfae5', fg: '#04250e' },
  svc: { bg: '#d6e3f3', fg: '#0c4595' },
  border: 'divider',
};
