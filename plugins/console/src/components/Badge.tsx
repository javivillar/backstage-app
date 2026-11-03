import Box from '@mui/material/Box';

/**
 * Small label. Not a MUI Chip on purpose: the classic portal's global CSS
 * restyles every MUI Chip with !important, which would hide the console colours.
 */
export const Badge = ({ label, bg, fg, outlined }: { label: string; bg?: string; fg?: string; outlined?: boolean }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block',
      fontSize: 12,
      fontWeight: 500,
      lineHeight: '20px',
      px: 1.125,
      borderRadius: '999px',
      whiteSpace: 'nowrap',
      bgcolor: outlined ? 'transparent' : bg ?? 'action.selected',
      color: fg ?? 'text.primary',
      border: '1px solid',
      borderColor: outlined ? 'divider' : 'transparent',
    }}
  >
    {label}
  </Box>
);
