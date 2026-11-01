import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useConsoleConfig } from '../config';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';

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
  const kpi = (label: string, value: string, sub: string, tone?: keyof typeof TONES) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 600, color: tone ? TONES[tone].fg : undefined }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    </Paper>
  );
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          CIS Kubernetes cluster {cfg.cluster.id}
        </Typography>
        <Typography color="text.secondary">
          CIS Kubernetes Benchmark of the control plane, etcd, the nodes and the cluster policies, run daily by kube-bench and read by Wazuh
          {d?.generated ? ` · ${new Date(d.generated).toLocaleString()}` : ''}. The operating system of each node is in CIS Kubernetes nodes.
        </Typography>
      </Box>
      {state.loading && <Progress />}
      {state.error && <WarningPanel title="The benchmark could not be read" message={state.error} />}
      {d && d.configured === false && <WarningPanel severity="info" title="Not available" message="This Backstage has no Wazuh security exporter configured (sbom.vulnerabilitiesUrl), or wazuh-oneke is older than 0.25.10." />}
      {d && d.configured !== false && nodes.length === 0 && <WarningPanel severity="info" title="No run in the last 3 days" message="kube-bench has not reported: check its DaemonSet and CronJob in the namespace of Wazuh." />}
      {nodes.length > 0 && (
        <>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
            {kpi('Checks that pass', String(pass), `on ${nodes.length} runners`, 'ok')}
            {kpi('Checks that fail', String(fail), `${groups.length} different checks to fix`, fail ? 'bad' : 'ok')}
            {kpi('To verify by hand', String(warn), 'manual checks (WARN), not findings')}
            {kpi('New failures', String(groups.filter(g => g.isNew).length), 'passed in the previous run', groups.some(g => g.isNew) ? 'warn' : undefined)}
          </Box>
          <Card title="Every runner" sub="One per node (its role decides the targets: master, etcd, control plane, node) and one for the cluster-wide policies.">
            <Table
              head={['Runner', 'Role · targets', 'Benchmark', 'Pass', 'Fail', 'Warn', 'Last run']}
              rows={nodes.map(n => [
                <b>{n.node}</b>,
                `${n.role ?? ''}${n.targets ? ` · ${n.targets}` : ''}`,
                n.benchmark ?? '',
                String(n.total_pass ?? ''),
                Number(n.total_fail ?? 0) ? <Badge label={String(n.total_fail)} {...TONES.bad} /> : <Badge label="0" {...TONES.ok} />,
                String(n.total_warn ?? ''),
                n.last ? new Date(n.last).toLocaleString() : '',
              ])}
            />
          </Card>
          <Card title="What to fix" sub="Each failing check once, with the runners where it fails and the remediation of the benchmark.">
            {groups.length === 0 ? (
              <Typography color="text.secondary">Every check passes.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {groups.map(g => (
                  <Box key={g.id} component="details" sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', p: 1.25 }}>
                    <Box component="summary" sx={{ cursor: 'pointer', display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <b>{g.id}</b>
                      <span>{g.desc}</span>
                      {g.isNew && <Badge label="new" {...TONES.warn} />}
                      {g.scored === 'no' && <Badge label="not scored" {...TONES.off} />}
                      <Typography variant="caption" color="text.secondary">
                        {g.nodes.length} runner{g.nodes.length > 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'grid', gap: 0.75, mt: 1 }}>
                      {g.section && (
                        <Typography variant="body2" color="text.secondary">
                          {g.section}
                        </Typography>
                      )}
                      <Typography variant="body2">Fails on: {g.nodes.join(', ')}</Typography>
                      {g.remediation && (
                        <Typography variant="body2" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                          {g.remediation}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Card>
        </>
      )}
    </Box>
  );
};
