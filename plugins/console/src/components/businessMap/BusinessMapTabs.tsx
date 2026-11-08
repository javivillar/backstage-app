import Box from '@mui/material/Box';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';

/** The views of the business map; each keeps the customer picked (?ns=) when moving to another. */
export const BUSINESS_MAP_VIEWS: Array<{ key: string; path: string }> = [
  { key: 'bm.view.map', path: '/console/business-map' },
  { key: 'bm.view.explorer', path: '/console/business-map/explorer' },
  { key: 'bm.view.heat', path: '/console/business-map/heat' },
  { key: 'bm.view.glass', path: '/console/business-map/glass' },
  { key: 'bm.view.matrix', path: '/console/business-map/matrix' },
];

/** The customer of the business map pages: ?ns= in the URL, so a view can be shared and the tabs keep it. */
export function useCustomer(): [string | undefined, (ns: string) => void] {
  const [params, setParams] = useSearchParams();
  const ns = params.get('ns') ?? undefined;
  const set = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('ns', value);
    next.delete('process');
    setParams(next, { replace: true });
  };
  return [ns, set];
}

/** Map · Explorer · Heat map · Glass · Matrix: the view tabs on every business map page. */
export const BusinessMapTabs = () => {
  const { t } = useI18n();
  const rq = useRq();
  const { pathname } = useLocation();
  const [ns] = useCustomer();
  const here = pathname.replace(/\/+$/, '');
  return (
    <Box component="nav" aria-label={t('bm.views')} sx={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
      {BUSINESS_MAP_VIEWS.map(v => {
        const on = here === v.path;
        return (
          <Box
            key={v.path}
            component={Link}
            to={ns ? `${v.path}?ns=${encodeURIComponent(ns)}` : v.path}
            aria-current={on ? 'page' : undefined}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 32,
              px: 1.5,
              borderRadius: '6px',
              fontSize: 14,
              fontWeight: on ? 500 : 400,
              textDecoration: 'none',
              color: rq.ink,
              bgcolor: on ? rq.active : 'transparent',
              '&:hover': { bgcolor: rq.active },
              '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 },
            }}
          >
            {t(v.key)}
          </Box>
        );
      })}
    </Box>
  );
};
