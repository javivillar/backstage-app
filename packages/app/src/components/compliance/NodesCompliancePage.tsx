import { Fragment, useEffect, useState } from 'react';
import { Content, ContentHeader, Header, InfoCard, Page, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';

/** A failed check in scope of one node (wazuh-oneke files/sca_collector.py, kind result). */
export type CisFailure = {
  checkId: number;
  cis: string;
  title: string;
  change?: 'first_run' | 'still_fail' | 'new_fail';
  expired?: boolean;
  review?: string | null;
  rationale?: string;
  remediation?: string;
};

export type CisNode = {
  node: string;
  agentId: string;
  policy: string;
  profile?: string;
  scanEnd: string;
  score: number | null;
  wazuhScore: number | null;
  checks: number;
  inScope: number;
  passed: number;
  failed: number;
  invalid: number;
  accepted: number;
  acceptedFailing: number;
  outOfScope: number;
  notApplicable: number;
  status: 'clean' | 'failures';
  failures: CisFailure[];
  exceptions: { checkId: number; cis: string; title: string; result: string; review: string }[];
};

export type CisScope = {
  profile?: string;
  exceptionsRegister?: string;
  outOfScope: { reason?: string; count: number };
  notApplicable: { reason?: string; count: number }[];
  accepted: { id: number; cis: string; title: string; reason: string; compensating?: string; review: string; expired: boolean }[];
};

/** GET /api/sbom/compliance: the security exporter of wazuh-oneke (GET /compliance, USE-CASES.md Part M). */
export type Compliance = {
  configured: boolean;
  generated?: string;
  nodes: CisNode[];
  stale?: { node: string; policy: string; scanEnd: string; hoursSince: number }[];
  scope?: Record<string, CisScope>;
};

function useCompliance() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: Compliance; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('sbom')}/compliance`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as Compliance;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  return state;
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');

/** green only at 100 %: one failure in scope is a finding */
export function ScoreChip({ score }: { score: number | null }) {
  if (score === null) return <Chip size="small" variant="outlined" label="not evaluated" />;
  let bg = '#c62828';
  if (score >= 100) bg = '#2e7d32';
  else if (score >= 90) bg = '#ed6c02';
  return <Chip size="small" label={`${score.toFixed(1)} %`} sx={{ bgcolor: bg, color: '#fff', fontWeight: 600 }} />;
}

function ChangeChip({ failure }: { failure: CisFailure }) {
  if (failure.expired) return <Chip size="small" label={`exception expired ${failure.review ?? ''}`} sx={{ bgcolor: '#c62828', color: '#fff' }} />;
  if (failure.change === 'new_fail') return <Chip size="small" label="regression" sx={{ bgcolor: '#c62828', color: '#fff', fontWeight: 600 }} />;
  if (failure.change === 'first_run') return <Chip size="small" variant="outlined" label="first scan" />;
  return <Chip size="small" variant="outlined" label="still failing" />;
}

function Failures({ node }: { node: CisNode }) {
  const [open, setOpen] = useState<number | undefined>();
  if (node.failures.length === 0) {
    return (
      <Typography variant="body2" sx={{ p: 1 }}>
        No failure in scope on this scan.
      </Typography>
    );
  }
  return (
    <Table size="small" aria-label={`failures of ${node.node}`}>
      <TableHead>
        <TableRow>
          <TableCell>CIS</TableCell>
          <TableCell>Check</TableCell>
          <TableCell>Since</TableCell>
          <TableCell />
        </TableRow>
      </TableHead>
      <TableBody>
        {node.failures.map(f => (
          <Fragment key={f.checkId}>
            <TableRow hover>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{f.cis}</TableCell>
              <TableCell>{f.title}</TableCell>
              <TableCell>
                <ChangeChip failure={f} />
              </TableCell>
              <TableCell padding="checkbox">
                {(f.remediation || f.rationale) && (
                  <IconButton size="small" aria-label={`how to fix ${f.cis}`} onClick={() => setOpen(open === f.checkId ? undefined : f.checkId)}>
                    {open === f.checkId ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                )}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} sx={{ py: 0, borderBottom: open === f.checkId ? undefined : 'none' }}>
                <Collapse in={open === f.checkId} unmountOnExit>
                  <Box sx={{ py: 1, display: 'grid', gap: 0.5 }}>
                    {f.rationale && (
                      <Typography variant="body2">
                        <b>Why:</b> {f.rationale}
                      </Typography>
                    )}
                    {f.remediation && (
                      <Typography variant="body2">
                        <b>Fix:</b> {f.remediation}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      Wazuh SCA check {f.checkId}. Fix it in the node image (refresquito-images) or, if it cannot apply to a Kubernetes node,
                      accept it as an exception (wazuh-oneke files/sca_scope.yaml).
                    </Typography>
                  </Box>
                </Collapse>
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export function NodesTable({ nodes }: { nodes: CisNode[] }) {
  const [open, setOpen] = useState<string | undefined>(nodes.find(n => n.failed > 0)?.node);
  return (
    <Table size="small" aria-label="nodes">
      <TableHead>
        <TableRow>
          <TableCell>Node</TableCell>
          <TableCell title="Checks in scope that pass, of those that pass or fail">Score in scope</TableCell>
          <TableCell>Failed</TableCell>
          <TableCell title="Accepted exceptions (failing now / total)">Exceptions</TableCell>
          <TableCell title="Level 2 of the benchmark: the image applies Level 1">Level 2</TableCell>
          <TableCell title="Another choice than the image made (firewall utility, time daemon, partitions)">Not applicable</TableCell>
          <TableCell title="Checks Wazuh could not evaluate on the node">Not evaluated</TableCell>
          <TableCell title="Wazuh's own score of the policy: every check of both levels">Wazuh score</TableCell>
          <TableCell>Scan</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {nodes.map(n => (
          <Fragment key={`${n.node}/${n.policy}`}>
            <TableRow hover onClick={() => setOpen(open === n.node ? undefined : n.node)} sx={{ cursor: 'pointer' }}>
              <TableCell sx={{ fontWeight: 600 }}>{n.node}</TableCell>
              <TableCell>
                <ScoreChip score={n.score} />
              </TableCell>
              <TableCell>{n.failed}</TableCell>
              <TableCell>
                {n.acceptedFailing}/{n.accepted}
              </TableCell>
              <TableCell>{n.outOfScope}</TableCell>
              <TableCell>{n.notApplicable}</TableCell>
              <TableCell>{n.invalid}</TableCell>
              <TableCell>{n.wazuhScore === null ? '' : `${n.wazuhScore} %`}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{when(n.scanEnd)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={9} sx={{ py: 0, borderBottom: open === n.node ? undefined : 'none' }}>
                <Collapse in={open === n.node} unmountOnExit>
                  <Box sx={{ py: 1 }}>
                    <Failures node={n} />
                  </Box>
                </Collapse>
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export function ScopeCard({ policy, scope, nodes }: { policy: string; scope: CisScope; nodes: CisNode[] }) {
  const failingOn = (id: number) => nodes.filter(n => n.exceptions.some(e => e.checkId === id && e.result === 'failed')).length;
  return (
    <InfoCard title="What counts" subheader={`${scope.profile ?? policy} — Wazuh policy ${policy}`}>
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography variant="body2">
          Left out of the score: <b>{scope.outOfScope.count}</b> checks of Level 2 ({scope.outOfScope.reason}), and{' '}
          {scope.notApplicable.map((g, i) => (
            <span key={i}>
              {i > 0 && '; '}
              <b>{g.count}</b> not applicable: {g.reason}
            </span>
          ))}
          .
        </Typography>
        <Typography variant="subtitle2">Accepted exceptions</Typography>
        {scope.accepted.length === 0 ? (
          <Typography variant="body2">None.</Typography>
        ) : (
          <Table size="small" aria-label="accepted exceptions">
            <TableHead>
              <TableRow>
                <TableCell>CIS</TableCell>
                <TableCell>Check</TableCell>
                <TableCell>Why it is accepted</TableCell>
                <TableCell>Compensating control</TableCell>
                <TableCell>Review</TableCell>
                <TableCell title="Nodes where the check fails on the newest scan">Failing on</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {scope.accepted.map(e => (
                <TableRow key={e.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.cis}</TableCell>
                  <TableCell>{e.title}</TableCell>
                  <TableCell>{e.reason}</TableCell>
                  <TableCell>{e.compensating}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {e.expired ? <Chip size="small" label={`expired ${e.review}`} sx={{ bgcolor: '#c62828', color: '#fff' }} /> : e.review}
                  </TableCell>
                  <TableCell>
                    {failingOn(e.id)} of {nodes.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {scope.exceptionsRegister && (
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            Register of exceptions of the node image: {scope.exceptionsRegister}. An exception is accepted in wazuh-oneke
            files/sca_scope.yaml; after its review date it counts as a failure again.
          </Typography>
        )}
      </Box>
    </InfoCard>
  );
}

/**
 * The CIS benchmark of the operating system of every node, from Wazuh's SCA, scored with the scope of the platform:
 * only the checks the node image claims (CIS Ubuntu 22.04 Level 1 Server) count, the accepted exceptions are shown
 * with their reason and review date. Source: the security exporter of wazuh-oneke (GET /compliance), through
 * sbom-backend. The CIS benchmark of Kubernetes (kube-bench) is in Wazuh's dashboard "CIS Kubernetes Benchmark".
 */
export const NodesCompliancePage = () => {
  const { loading, data, error } = useCompliance();
  const policies = [...new Set((data?.nodes ?? []).map(n => n.policy))];
  const scores = (data?.nodes ?? []).flatMap(n => (n.score === null ? [] : [n.score]));
  const worst = scores.length > 0 ? Math.min(...scores) : null;
  return (
    <Page themeId="tool">
      <Header title="CIS nodes" subtitle="CIS benchmark of the operating system of each node, from Wazuh" />
      <Content>
        <ContentHeader title={data?.generated ? `Read from Wazuh ${when(data.generated)}` : ''} />
        {loading && <Progress />}
        {error && (
          <WarningPanel severity="error" title="The CIS compliance of the nodes could not be read">
            {error}
          </WarningPanel>
        )}
        {data && !data.configured && (
          <WarningPanel severity="info" title="Not turned on">
            Wazuh does not score the nodes on this installation: wazuh-oneke 0.25.0 or later with manager.scaCis.enabled, and
            sbom.vulnerabilitiesUrl in the configuration of Backstage.
          </WarningPanel>
        )}
        {data?.configured && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            {(data.stale ?? []).length > 0 && (
              <WarningPanel severity="warning" title="Nodes without a recent scan">
                {data.stale!.map(s => `${s.node} (last scan ${when(s.scanEnd)}, ${s.hoursSince} h ago)`).join(', ')}: their agent is
                stopped or SCA is off, so their result is not current.
              </WarningPanel>
            )}
            <InfoCard
              title="Nodes"
              subheader={
                data.nodes.length === 0
                  ? undefined
                  : `${data.nodes.length} nodes, lowest score ${worst === null ? '—' : `${worst.toFixed(1)} %`}. Click a node for its failures.`
              }
            >
              {data.nodes.length === 0 ? (
                <Typography variant="body2">
                  No scored scan in the last days yet: the agents scan once a day, and the masters only when their agent group
                  runs SCA.
                </Typography>
              ) : (
                <NodesTable nodes={data.nodes} />
              )}
            </InfoCard>
            {policies.map(p =>
              data.scope?.[p] ? <ScopeCard key={p} policy={p} scope={data.scope[p]} nodes={data.nodes.filter(n => n.policy === p)} /> : null,
            )}
          </Box>
        )}
      </Content>
    </Page>
  );
};
