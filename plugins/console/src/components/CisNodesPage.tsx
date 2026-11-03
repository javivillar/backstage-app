import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Fragment, useEffect, useState } from 'react';
import { useConsoleConfig } from '../config';
import { Badge } from './Badge';
import { ClassicLink } from './ClassicLink';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { useRq } from '../theme/consoleTheme';
import { useI18n } from '../i18n';
import { Id, Kpis, TitleRow, choose } from './ui';

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
  const { t } = useI18n();
  const rqT = useRq();
  // the same check failing on several nodes is fixed once, in the image: grouped, the most widespread first
  const common = [...nodes.reduce((m, n) => {
    for (const f of n.failures) {
      const g = m.get(f.cis) ?? { cis: f.cis, title: f.title, remediation: f.remediation, nodes: 0 };
      g.nodes++;
      m.set(f.cis, g);
    }
    return m;
  }, new Map<string, { cis: string; title: string; remediation?: string; nodes: number }>()).values()].sort((x, y) => y.nodes - x.nodes || x.cis.localeCompare(y.cis));
  const failed = nodes.reduce((sum, n) => sum + n.failed, 0);
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[cfg.cluster.id, '/console/cluster'], [t('page.cis-nodes')]]}
        title={t('cisn.title', { cluster: cfg.cluster.id })}
        sub={`${t('cisn.sub')}${d?.generated ? ` · ${new Date(d.generated).toLocaleString()}` : ''}`}
        finding={d?.configured && nodes.length > 0 && (common.length ? t('cisn.finding', { n: common.length, nodes: nodes.length }) : t('cisn.findingOk'))}
        findingTone={common.length ? 'warn' : 'pos'}
        actions={<ClassicLink path="/cis-nodes">{t('cisn.classic')}</ClassicLink>}
      />
      {state.loading && <Progress />}
      {state.error && <WarningPanel title="The CIS results could not be read" message={state.error} />}
      {d && !d.configured && <Typography color="text.secondary">{t('cisn.notConfigured')}</Typography>}
      {d?.configured && (
        <>
          <Kpis
            items={[
              { label: t('cisn.clean'), value: `${clean} / ${nodes.length}`, tone: clean === nodes.length ? 'good' : undefined },
              { label: t('cisn.failed'), value: failed, tone: failed ? 'bad' : 'good' },
              { label: t('cisn.new'), value: newFails, tone: newFails ? 'bad' : undefined },
              { label: t('cisn.stale'), value: d.stale?.length ?? 0, tone: d.stale?.length ? 'bad' : undefined },
            ]}
          />
          {common.length > 0 && (
            <Card title={t('cisn.top')} sub={t('cisn.topSub')}>
              <Table
                head={['CIS', t('cisn.check'), t('cisn.nodes'), t('cisn.fix')]}
                rows={common.slice(0, 5).map(g => [<Id>{g.cis}</Id>, g.title, t('cisn.ofNodes', { n: g.nodes, total: nodes.length }), g.remediation ? <Typography variant="body2" color="text.secondary">{g.remediation}</Typography> : '—'])}
              />
            </Card>
          )}
          <Card title={t('cisn.nodes')} sub={t('cisn.nodesSub')}>
            <Box sx={{ display: 'grid' }}>
              {nodes.map(n => {
                const tone = scoreTone(n.score);
                const isOpen = open === n.node;
                return (
                  <Fragment key={n.node}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) 160px minmax(0, 2fr) auto' }, gap: 1.5, alignItems: 'center', py: 1.25, borderTop: 1, borderColor: 'divider' }}>
                      <Box>
                        <Typography component="div"><Id>{n.node}</Id></Typography>
                        <Typography variant="caption" color="text.secondary">
                          {n.profile ?? n.policy} · scanned {new Date(n.scanEnd).toLocaleString()}
                        </Typography>
                      </Box>
                      <Box>
                        <Box sx={{ height: 6, borderRadius: 3, bgcolor: rqT.rule, overflow: 'hidden' }}>
                          <Box sx={{ height: '100%', width: `${n.score ?? 0}%`, bgcolor: choose([[tone === TONES.ok, rqT.positive], [tone === TONES.bad, rqT.negative], [tone === TONES.warn, rqT.warning]], rqT.control) }} />
                        </Box>
                        <Typography variant="caption" sx={{ color: tone.fg, fontWeight: 500 }}>
                          {n.score === null ? 'no score' : `${n.score}%`} · {n.passed}/{n.inScope} pass
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {n.status === 'clean' ? <Badge label="No failures" {...TONES.ok} /> : <Badge label={`${n.failed} failed`} {...TONES.warn} />}
                        {n.failures.some(f => f.change === 'new_fail') && <Badge label="new failures" {...TONES.bad} />}
                        {n.accepted > 0 && <Badge outlined label={`${n.accepted} accepted`} />}
                      </Box>
                      <Button variant="text" disabled={!n.failures.length} onClick={() => setOpen(isOpen ? undefined : n.node)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'What failed'} on ${n.node}`} sx={{ textTransform: 'none' }}>
                        {isOpen ? t('cisn.hide') : t('cisn.whatFailed')}
                      </Button>
                    </Box>
                    {isOpen && (
                      <Box sx={{ display: 'grid', gap: 1, pb: 1.5, pl: { md: 2 } }}>
                        {n.failures.map(f => (
                          <Box key={f.checkId} sx={{ border: 1, borderColor: 'divider', borderRadius: '6px', p: 1.25, display: 'grid', gap: 0.5 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                              <Badge outlined label={`CIS ${f.cis}`} />
                              <Typography sx={{ fontWeight: 500 }}>{f.title}</Typography>
                              {f.change === 'new_fail' && <Badge label="new" {...TONES.bad} />}
                            </Box>
                            {f.remediation && (
                              <Typography variant="body2" color="text.secondary">
                                <b style={{ fontWeight: 500 }}>{t('cisn.fix')}:</b> {f.remediation}
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
