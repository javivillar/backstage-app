import GlobalStyles from '@mui/material/GlobalStyles';
import { type Theme, ThemeProvider, createTheme, useTheme } from '@mui/material/styles';
import { type PropsWithChildren, useMemo } from 'react';
import plex400 from '../fonts/ibm-plex-sans-latin-400-normal.woff2';
import plex500 from '../fonts/ibm-plex-sans-latin-500-normal.woff2';
import plex600 from '../fonts/ibm-plex-sans-latin-600-normal.woff2';
import mono400 from '../fonts/ibm-plex-mono-latin-400-normal.woff2';
import mono500 from '../fonts/ibm-plex-mono-latin-500-normal.woff2';

/**
 * The look of the console (mock-up "framed sheet"): a tinted frame, a white sheet for the page, one near-black primary
 * button, colour only on data and state, IBM Plex Sans (served by the app: no CDN), mono only for identifiers.
 * Type scale 12 / 14 / 16 / 22 / 28; radii 4 / 6 / 8 / 16.
 */
export type RqTokens = {
  frame: string; sheet: string; raised: string; active: string; border: string; rule: string; control: string;
  ink: string; muted: string; data: string; dataSoft: string; primary: string; onPrimary: string;
  positive: string; negative: string; warning: string;
  pos: { bg: string; fg: string }; neg: { bg: string; fg: string }; warn: { bg: string; fg: string }; info: { bg: string; fg: string }; neu: { bg: string; fg: string };
  shadow: string;
};

export const LIGHT: RqTokens = {
  frame: '#f2f5f8', sheet: '#ffffff', raised: '#f5f7fa', active: '#e6ebf1', border: '#e6e9ed', rule: '#eff1f4', control: '#7d8895',
  ink: '#121820', muted: '#56606b', data: '#0c4595', dataSoft: '#d6e3f3', primary: '#0f2a44', onPrimary: '#ffffff',
  positive: '#1e7b4f', negative: '#c4242a', warning: '#92400e',
  pos: { bg: '#dcfae5', fg: '#04250e' }, neg: { bg: '#ffedea', fg: '#831c1e' }, warn: { bg: '#fff6e0', fg: '#7a3a06' }, info: { bg: '#d6e3f3', fg: '#0c4595' }, neu: { bg: '#e9edf1', fg: '#303841' },
  shadow: '0 6px 20px rgba(15,23,32,0.14)',
};

export const DARK: RqTokens = {
  frame: '#0d1218', sheet: '#141a21', raised: '#1a2129', active: '#222b35', border: '#26303a', rule: '#1f2730', control: '#66788a',
  ink: '#eef2f6', muted: '#a3adb8', data: '#6aa6f0', dataSoft: '#1b3550', primary: '#eef2f6', onPrimary: '#0d1218',
  positive: '#4cc488', negative: '#ff7a70', warning: '#f0b35a',
  pos: { bg: '#15301f', fg: '#8fe0b2' }, neg: { bg: '#3a1a1a', fg: '#ffb3ab' }, warn: { bg: '#3a2a12', fg: '#f6c98a' }, info: { bg: '#1b3550', fg: '#9cc4f5' }, neu: { bg: '#252e38', fg: '#c9d1da' },
  shadow: '0 6px 20px rgba(0,0,0,0.5)',
};

export const FONT = '"IBM Plex Sans", "Helvetica Neue", Arial, system-ui, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace';

/** The tokens of the current theme (light or dark), for the few places that need a literal colour. */
export function useRq(): RqTokens {
  return useTheme().palette.mode === 'dark' ? DARK : LIGHT;
}

function consoleTheme(outer: Theme): Theme {
  const t = outer.palette.mode === 'dark' ? DARK : LIGHT;
  return createTheme(outer, {
    palette: {
      primary: { main: t.primary, contrastText: t.onPrimary },
      secondary: { main: t.data },
      success: { main: t.positive },
      warning: { main: t.warning },
      error: { main: t.negative },
      info: { main: t.data },
      text: { primary: t.ink, secondary: t.muted },
      divider: t.border,
      background: { default: t.frame, paper: t.sheet },
      action: { hover: t.raised, selected: t.active },
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: FONT,
      fontSize: 14,
      h1: { fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: 0 },
      h2: { fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: 0 },
      h3: { fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: 0 },
      h4: { fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: 0 },
      h5: { fontSize: 16, lineHeight: '22px', fontWeight: 600, letterSpacing: 0 },
      h6: { fontSize: 16, lineHeight: '22px', fontWeight: 600, letterSpacing: 0 },
      subtitle1: { fontSize: 14, lineHeight: '20px', fontWeight: 500 },
      subtitle2: { fontSize: 12, lineHeight: '16px', fontWeight: 500 },
      body1: { fontSize: 14, lineHeight: '20px' },
      body2: { fontSize: 14, lineHeight: '20px' },
      caption: { fontSize: 12, lineHeight: '16px' },
      overline: { fontSize: 12, lineHeight: '16px', fontWeight: 500, letterSpacing: 0, textTransform: 'none' },
      button: { fontSize: 14, fontWeight: 500, textTransform: 'none' },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: 6, fontWeight: 500, transition: 'background-color .15s ease-out, border-color .15s ease-out' },
          outlined: { borderColor: t.control, color: t.ink, '&:hover': { borderColor: t.control, backgroundColor: t.raised } },
          text: { color: t.ink, '&:hover': { backgroundColor: t.active } },
          containedPrimary: { backgroundColor: t.primary, color: t.onPrimary, '&:hover': { backgroundColor: t.primary, opacity: 0.9 } },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, rounded: { borderRadius: 8 } } },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: 8, borderColor: t.border, boxShadow: 'none' } },
      },
      MuiCardHeader: { styleOverrides: { title: { fontSize: 16, lineHeight: '22px', fontWeight: 600 }, subheader: { fontSize: 12, color: t.muted } } },
      MuiTableCell: {
        styleOverrides: {
          head: { fontSize: 12, lineHeight: '16px', fontWeight: 500, color: t.muted, textTransform: 'none', letterSpacing: 0, borderBottomColor: t.border, whiteSpace: 'nowrap' },
          body: { fontSize: 14, borderBottomColor: t.rule, fontVariantNumeric: 'tabular-nums' },
        },
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: t.ink, height: 2 } } },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 500, fontSize: 14, minHeight: 40, color: t.muted, '&.Mui-selected': { color: t.ink } },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 6, backgroundColor: t.sheet, '& .MuiOutlinedInput-notchedOutline': { borderColor: t.control }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.data, borderWidth: 1, boxShadow: `0 0 0 1px ${t.data}` } },
        },
      },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 12, backgroundColor: t.ink, color: t.sheet, borderRadius: 4 }, arrow: { color: t.ink } } },
      MuiMenu: { styleOverrides: { paper: { border: `1px solid ${t.border}`, boxShadow: t.shadow, borderRadius: 8 } } },
      MuiMenuItem: { styleOverrides: { root: { fontSize: 14, borderRadius: 6, margin: '0 4px', '&.Mui-selected': { backgroundColor: t.active } } } },
      MuiLink: { styleOverrides: { root: { color: t.data } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 500, fontSize: 12, height: 22 } } },
      MuiLinearProgress: { styleOverrides: { root: { backgroundColor: t.rule, borderRadius: 3 }, bar: { backgroundColor: t.data } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 6, fontSize: 14 } } },
      MuiDivider: { styleOverrides: { root: { borderColor: t.border } } },
    },
  });
}

const fontFaces = `
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url(${plex400}) format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 500; font-display: swap; src: url(${plex500}) format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url(${plex600}) format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url(${mono400}) format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500; font-display: swap; src: url(${mono500}) format('woff2'); }
`;

/** Gives the console its own theme on top of the portal's (same mode), the fonts and the frame colour. */
export const ConsoleTheme = ({ children }: PropsWithChildren) => {
  const outer = useTheme();
  const theme = useMemo(() => consoleTheme(outer), [outer]);
  const t = theme.palette.mode === 'dark' ? DARK : LIGHT;
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles
        styles={`${fontFaces}
body.rq-console { background: ${t.frame}; }
.rq-console-root { font-family: ${FONT}; color: ${t.ink}; font-size: 14px; line-height: 20px; }
.rq-console-root code, .rq-console-root pre, .rq-console-root kbd, .rq-console-root samp, .rq-console-root .rq-mono { font-family: ${MONO}; }
.rq-console-root ::selection { background: ${t.dataSoft}; }
.rq-console-root a:focus-visible, .rq-console-root button:focus-visible { outline: 2px solid ${t.data}; outline-offset: 1px; }
`}
      />
      {children}
    </ThemeProvider>
  );
};
