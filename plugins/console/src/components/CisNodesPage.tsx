import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { Fragment, useEffect, useState } from 'react';
import { useConsoleConfig } from '../config';
import { Badge } from './Badge';
import { ClassicLink } from './ClassicLink';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';

/** GET /api/sbom/compliance (wazuh-oneke security exporter): CIS benchmark of every node. */
type Failure = { checkId: number; cis: string; title: string; change?: 'first_run' | 'still_fail' | 'new_fail'; remediation?: string; rationale?: string };
type CisNode = {
  node: string;
  policy: string;
  profile?: string;
  scanEnd: string;
  score: number | null;
  inScope: number;
  passed: number;
  failed: number;
  accepted: number;
  status: 'clean' | 'failures';
  failures: Failure[];
};
export type Compliance = { configured: boolean; generated?: string; nodes: CisNode[]; stale?: Array<{ node: string; hoursSince: number }> };

const scoreTone = (s: number | null) => {
  if (s === null) return TONES.off;
  if (s >= 95) return TONES.ok;
  return s >= 85 ? TONES.warn : TONES.bad;
};

/** Cluster layer › CIS nodes, in the console: the hardening of every node and what to fix. */
export const CisNodesPage = () => {
  const cfg = useConsoleConfig();
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: Compliance; error?: string }>({ loading: true });
  const [open, setOpen] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl('sbom')}/compliance`);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return (await r.json()) as Compliance;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  const d = state.data;
  const nodes = [...(d?.nodes ?? [])].sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.node.localeCompare(b.node));
  const clean = nodes.filter(n => n.status === 'clean').length;
  const newFails = nodes.reduce((t, n) => t + n.failures.filter(f => f.change === 'new_fail').length, 0);
  const kpi = (label: string, value: string, tone?: keyof typeof TONES) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone ? TONES[tone].fg : undefined }}>{value}</Typography>
    </Paper>
  );
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            CIS hardening of {cfg.cluster.id}
          </Typography>
          <Typography color="text.secondary">
            CIS benchmark of every node, scanned by Wazuh{d?.generated ? ` · ${new Date(d.generated).toLocaleString()}` : ''}. Accepted exceptions do not count as failures.
          </Typography>
        </Box>
        <ClassicLink path="/cis-nodes">Details in the classic portal</ClassicLink>
      </Box>
      {state.loading && <Progress />}
      {state.error && <WarningPanel title="The CIS results could not be read" message={state.error} />}
      {d && !d.configured && <Typography color="text.secondary">Wazuh's security exporter is not configured in this portal.</Typography>}
      {d?.configured && (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {kpi('Nodes without failures', `${clean} / ${nodes.length}`, clean === nodes.length ? 'ok' : 'warn')}
            {kpi('Failed checks', String(nodes.reduce((t, n) => t + n.failed, 0)), nodes.some(n => n.failed) ? 'warn' : 'ok')}
            {kpi('New since the last scan', String(newFails), newFails ? 'bad' : undefined)}
            {kpi('Scans older than a day', String(d.stale?.length ?? 0), d.stale?.length ? 'warn' : undefined)}
          </Box>
          <Card title="Nodes" sub="The lowest score first. Open a node to see what failed and how to fix it.">
            <Box sx={{ display: 'grid' }}>
              {nodes.map(n => {
                const t = scoreTone(n.score);
                const isOpen = open === n.node;
                return (
                  <Fragment key={n.node}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) 160px minmax(0, 2fr) auto' }, gap: 1.5, alignItems: 'center', py: 1.25, borderTop: 1, borderColor: 'divider' }}>
                      <Box>
                        <Typography sx={{ fontWeight: 600 }}>{n.node}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {n.profile ?? n.policy} · scanned {new Date(n.scanEnd).toLocaleString()}
                        </Typography>
                      </Box>
                      <Box>
                        <Box sx={{ height: 8, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
                          <Box sx={{ height: '100%', width: `${n.score ?? 0}%`, bgcolor: t.fg }} />
                        </Box>
                        <Typography variant="caption" sx={{ color: t.fg, fontWeight: 600 }}>
                          {n.score === null ? 'no score' : `${n.score}%`} · {n.passed}/{n.inScope} pass
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {n.status === 'clean' ? <Badge label="No failures" {...TONES.ok} /> : <Badge label={`${n.failed} failed`} {...TONES.warn} />}
                        {n.failures.some(f => f.change === 'new_fail') && <Badge label="new failures" {...TONES.bad} />}
                        {n.accepted > 0 && <Badge outlined label={`${n.accepted} accepted`} />}
                      </Box>
                      <Button variant="text" disabled={!n.failures.length} onClick={() => setOpen(isOpen ? undefined : n.node)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'What failed'} on ${n.node}`} sx={{ textTransform: 'none' }}>
                        {isOpen ? 'Hide' : 'What failed'}
                      </Button>
                    </Box>
                    {isOpen && (
                      <Box sx={{ display: 'grid', gap: 1, pb: 1.5, pl: { md: 2 } }}>
                        {n.failures.map(f => (
                          <Box key={f.checkId} sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.25, display: 'grid', gap: 0.5 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                              <Badge outlined label={`CIS ${f.cis}`} />
                              <Typography sx={{ fontWeight: 600 }}>{f.title}</Typography>
                              {f.change === 'new_fail' && <Badge label="new" {...TONES.bad} />}
                            </Box>
                            {f.remediation && (
                              <Typography variant="body2" color="text.secondary">
                                <b>Fix:</b> {f.remediation}
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Fragment>
                );
              })}
            </Box>
          </Card>
        </>
      )}
    </Box>
  );
};
