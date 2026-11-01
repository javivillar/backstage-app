import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useClusterPost } from '../post';
import type { ActionResult } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { ConfirmBar, ResultNote, useChange } from './Requests';

export type OpsTarget = { zone: string; program: string; vm?: string };
type Op = { kind: string; label: string; confirm: string; danger?: boolean };

const VM_OPS: Op[] = [
  { kind: 'vm-reboot', label: 'Reboot', confirm: 'Reboot the VM? Its processes stop and it starts again (about a minute).' },
  { kind: 'vm-poweroff', label: 'Stop', confirm: 'Stop the VM? It powers off cleanly (ACPI) and keeps its disk and address; Start brings it back.', danger: true },
  { kind: 'vm-resume', label: 'Start', confirm: 'Start the VM again?' },
];
const clusterOps = (own: boolean): Op[] => [
  {
    kind: 'cluster-restart',
    label: 'Restart',
    confirm: own
      ? 'Restart the cluster of this console? The host drains the workers, powers every node off and on again (cluster.sh restart): the portal and the console are down 10 to 20 minutes.'
      : 'Restart the cluster? The host drains the workers, waits for Longhorn to detach the volumes, powers every node off and on again (cluster.sh restart): its applications are down 10 to 20 minutes.',
    danger: true,
  },
  ...(own
    ? []
    : [
        { kind: 'cluster-stop', label: 'Stop', confirm: 'Stop the cluster? Its applications stop until Start (cluster.sh stop: drain, detach, power off by groups). Its VMs keep their disks.', danger: true },
        { kind: 'cluster-start', label: 'Start', confirm: 'Start the cluster? The host powers on the VNF, the masters and the workers, and uncordons what Stop drained.' },
      ]),
];

const stateTone = (s: string) => {
  if (s === 'done') return TONES.ok;
  if (s === 'failed' || s === 'refused') return TONES.bad;
  return TONES.off;
};

/**
 * One-off operations on a VM of the console or a cluster: a file committed to main (configuration/actions), run once
 * by the host within 5 minutes. Shows the last one the host ran for this target.
 */
export const OpsActions = ({ target, allowed, own = false, results = [], onDone }: { target: OpsTarget; allowed: boolean; own?: boolean; results?: ActionResult[]; onDone?: () => void }) => {
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => onDone?.());
  const [pending, setPending] = useState<Op | undefined>();
  const ops = target.vm ? VM_OPS : clusterOps(own);
  const last = results.find(r => r.zone === target.zone && r.program === target.program && (target.vm ? r.vm === target.vm : !r.vm));
  const name = target.vm ?? `the cluster of ${target.zone}/${target.program}`;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {ops.map(o => (
          <Button key={o.kind} size="small" variant="outlined" color={o.danger ? 'error' : 'primary'} disabled={!allowed || busy} onClick={() => setPending(o)} sx={{ textTransform: 'none' }}>
            {o.label}
          </Button>
        ))}
        {last && (
          <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
            Last: {last.kind.replace(/^(vm|cluster)-/, '')} <Badge label={last.state} {...stateTone(last.state)} /> {last.at ? new Date(last.at).toLocaleString() : ''}
          </Typography>
        )}
      </Box>
      {pending && (
        <ConfirmBar
          text={pending.confirm}
          onYes={() => {
            const o = pending;
            setPending(undefined);
            run(
              () => post('/infra/actions', { kind: o.kind, zone: target.zone, program: target.program, ...(target.vm ? { vm: target.vm } : {}) }),
              () => `Asked: ${o.label.toLowerCase()} ${name}. The host runs it within 5 minutes.`,
            );
          }}
          onNo={() => setPending(undefined)}
        />
      )}
      <ResultNote note={note} />
    </Box>
  );
};
