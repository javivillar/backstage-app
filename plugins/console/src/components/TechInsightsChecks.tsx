import { Progress } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Cancel from '@mui/icons-material/Cancel';
import { useEffect, useState } from 'react';
import { TONES } from './Flow';

type CheckResult = { check: { id: string; name?: string; description?: string }; result: boolean | unknown };

/**
 * The checks of Tech Insights for the entity, read from its backend (POST /checks/run/<namespace>/<kind>/<name>): the
 * scorecard inside the console, where the plugin's own card cannot route.
 */
export const TechInsightsChecks = () => {
  const { entity } = useEntity();
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; checks?: CheckResult[]; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const base = await discovery.getBaseUrl('tech-insights');
      const ref = `${encodeURIComponent(entity.metadata.namespace ?? 'default')}/${encodeURIComponent(entity.kind)}/${encodeURIComponent(entity.metadata.name)}`;
      const r = await fetch(`${base}/checks/run/${ref}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!r.ok) throw new Error(`Tech Insights answered ${r.status}`);
      return (await r.json()) as CheckResult[];
    })().then(
      checks => alive && setState({ loading: false, checks }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, entity]);
  if (state.loading) return <Progress />;
  if (state.error) return <Typography color="text.secondary">{state.error}</Typography>;
  const checks = state.checks ?? [];
  const passed = checks.filter(c => c.result === true).length;
  return (
    <Box sx={{ display: 'grid' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {passed} of {checks.length} checks pass
      </Typography>
      {checks.map(c => {
        const ok = c.result === true;
        return (
          <Box key={c.check.id} sx={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', gap: 1, alignItems: 'start', py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
            {ok ? <CheckCircle fontSize="small" sx={{ color: TONES.ok.fg }} /> : <Cancel fontSize="small" sx={{ color: TONES.bad.fg }} />}
            <Box>
              <Typography sx={{ fontSize: 14 }}>{c.check.name ?? c.check.id}</Typography>
              {!ok && c.check.description && (
                <Typography variant="caption" color="text.secondary">
                  {c.check.description}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
