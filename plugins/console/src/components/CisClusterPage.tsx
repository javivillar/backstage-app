import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useConsoleConfig } from '../config';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { useI18n } from '../i18n';
import { Id, Kpis, TitleRow } from './ui';

/** GET /api/sbom/kubebench (wazuh-oneke security exporter): the CIS Kubernetes Benchmark of every node. */
type Failure = { id: string; section?: string; section_text?: string; node_type?: string; desc?: string; scored?: string; change?: string; expected?: string; actual?: string; remediation?: string };
/** Wazuh keeps the totals as text: read them with Number(). */
type KubeNode = { node: string; role?: string; benchmark?: string; targets?: string; last?: string; status?: string; total_pass?: number | string; total_fail?: number | string; total_warn?: number | string; failures: Failure[] };
type Kubebench = { configured?: boolean; generated?: string; nodes: KubeNode[] };

/** The same check failing on several nodes is one thing to fix: grouped by check id. */
export function groupFailures(nodes: KubeNode[]): Array<{ id: string; desc?: string; section?: string; scored?: string; remediation?: string; nodes: string[]; isNew: boolean }> {
  const by = new Map<string, { id: string; desc?: string; section?: string; scored?: string; remediation?: string; nodes: string[]; isNew: boolean }>();
  for (const n of nodes) {
    for (const f of n.failures) {
      const g = by.get(f.id) ?? { id: f.id, desc: f.desc, section: f.section_text, scored: f.scored, remediation: f.remediation, nodes: [], isNew: false };
      g.nodes.push(n.node);
      g.isNew = g.isNew || f.change === 'new_fail';
      by.set(f.id, g);
    }
  }
  const key = (id: string) => id.split('.').map(p => p.padStart(4, '0')).join('.');
  return [...by.values()].sort((a, b) => key(a.id).localeCompare(key(b.id)));
}

/** Kubernetes › CIS Kubernetes cluster: kube-bench on every node (RKE2 CIS profile) and what to fix. */
export const CisClusterPage = () => {
  const cfg = useConsoleConfig();
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: Kubebench; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl('sbom')}/kubebench`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error?.message ?? body.error ?? `${r.status} ${r.statusText}`);
      return body as Kubebench;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  const d = state.data;
  const nodes = d?.nodes ?? [];
  const groups = groupFailures(nodes);
  const pass = nodes.reduce((t, n) => t + Number(n.total_pass ?? 0), 0);
  const fail = nodes.reduce((t, n) => t + Number(n.total_fail ?? 0), 0);
  const warn = nodes.reduce((t, n) => t + Number(n.total_warn ?? 0), 0);
  const { t } = useI18n();
  const fresh = groups.filter(g => g.isNew).length;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[cfg.cluster.id, '/console/cluster'], [t('nav.cisCluster')]]}
        title={t('cis.title', { cluster: cfg.cluster.id })}
        sub={`${t('cis.sub')}${d?.generated ? ` · ${new Date(d.generated).toLocaleString()}` : ''}`}
        finding={nodes.length > 0 && (groups.length ? t('cis.finding', { n: groups.length, fail }) : t('cis.findingOk'))}
        findingTone={groups.length ? 'warn' : 'pos'}
      />
      {state.loading && <Progress />}
      {state.error && <WarningPanel title="The benchmark could not be read" message={state.error} />}
      {d && d.configured === false && <WarningPanel severity="info" title="Not available" message="This Backstage has no Wazuh security exporter configured (sbom.vulnerabilitiesUrl), or wazuh-oneke is older than 0.25.10." />}
      {d && d.configured !== false && nodes.length === 0 && <WarningPanel severity="info" title="No run in the last 3 days" message="kube-bench has not reported: check its DaemonSet and CronJob in the namespace of Wazuh." />}
      {nodes.length > 0 && (
        <>
          <Kpis
            items={[
              { label: t('cis.pass'), value: pass, note: t('cis.onRunners', { n: nodes.length }), tone: 'good' },
              { label: t('cis.fail'), value: fail, note: t('cis.toFix', { n: groups.length }), tone: fail ? 'bad' : 'good' },
              { label: t('cis.manual'), value: warn, note: t('cis.manualNote') },
              { label: t('cis.new'), value: fresh, note: t('cis.newNote'), tone: fresh ? 'bad' : undefined },
            ]}
          />
          <Card title={t('cis.whatToFix')} sub={t('cis.whatToFixSub')}>
            {groups.length === 0 ? (
              <Typography color="text.secondary">{t('cis.allPass')}</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {groups.map(g => (
                  <Box key={g.id} component="details" sx={{ border: 1, borderColor: 'divider', borderRadius: '6px', px: 1.5, py: 1 }}>
                    <Box component="summary" sx={{ cursor: 'pointer', display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <Id>{g.id}</Id>
                      <span>{g.desc}</span>
                      {g.isNew && <Badge label="new" {...TONES.warn} />}
                      {g.scored === 'no' && <Badge label="not scored" {...TONES.off} />}
                      <Typography variant="caption" color="text.secondary">
                        {t(g.nodes.length > 1 ? 'cis.nRunners' : 'cis.oneRunner', { n: g.nodes.length })}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'grid', gap: 0.75, mt: 1 }}>
                      {g.section && (
                        <Typography variant="body2" color="text.secondary">
                          {g.section}
                        </Typography>
                      )}
                      <Typography variant="body2">{t('cis.failsOn')} {g.nodes.join(', ')}</Typography>
                      {g.remediation && (
                        <Typography variant="body2" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1.25, borderRadius: '6px', fontSize: 12 }}>
                          {g.remediation}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Card>
          <Card title={t('cis.runners')} sub={t('cis.runnersSub')}>
            <Table
              head={[t('cis.runner'), t('cis.role'), 'Benchmark', 'Pass', 'Fail', 'Warn', t('cis.lastRun')]}
              rows={nodes.map(n => [
                <Id>{n.node}</Id>,
                `${n.role ?? ''}${n.targets ? ` · ${n.targets}` : ''}`,
                n.benchmark ?? '',
                String(n.total_pass ?? ''),
                Number(n.total_fail ?? 0) ? <Badge label={String(n.total_fail)} {...TONES.bad} /> : <Badge label="0" {...TONES.ok} />,
                String(n.total_warn ?? ''),
                n.last ? new Date(n.last).toLocaleString() : '',
              ])}
            />
          </Card>
        </>
      )}
    </Box>
  );
};
