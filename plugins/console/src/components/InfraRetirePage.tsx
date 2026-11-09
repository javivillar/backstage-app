import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useClusterPost } from '../post';
import { pullTarget, useInfra, useZone } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { InfraFrame } from './InfraPages';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { ResultNote, useChange } from './Requests';
import { Id } from './ui';

/**
 * Platform › Retire: destroy a OneKE cluster or remove a segregation, in one place. Both open the same pull requests
 * as Marketplace (delete a cluster) and a programme page (remove it), with the same rules; the name must be typed.
 */

type Target = { kind: 'cluster' | 'segregation'; zone: string; program: string; name: string };

/** Asks to type the name before opening the pull request. */
const TypeToConfirm = ({ target, busy, onYes, onNo }: { target: Target; busy: boolean; onYes: () => void; onNo: () => void }) => {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const id = `${target.zone}/${target.program}`;
  const ok = typed.trim() === id;
  return (
    <Box role="alertdialog" aria-label={t('rt.confirm')} sx={{ display: 'grid', gap: 1, bgcolor: TONES.warn.bg, color: TONES.warn.fg, borderRadius: '8px', p: 1.5 }}>
      <Typography>{target.kind === 'cluster' ? t('rt.confirmCluster', { name: target.name, id }) : t('rt.confirmSeg', { id })}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" label={t('rt.typeName', { id })} value={typed} onChange={e => setTyped(e.target.value)} sx={{ bgcolor: 'background.paper', minWidth: 260 }} />
        <Button variant="contained" color="error" disabled={!ok || busy} onClick={onYes} sx={{ textTransform: 'none' }}>
          {t('rt.openPr')}
        </Button>
        <Button onClick={onNo} sx={{ textTransform: 'none' }}>
          {t('rt.cancel')}
        </Button>
      </Box>
    </Box>
  );
};

export const RetirePage = () => {
  const { t } = useI18n();
  const infra = useInfra();
  const zone = useZone();
  const post = useClusterPost();
  const { note, busy, run } = useChange(() => { infra.reload(); zone.reload(); });
  const [target, setTarget] = useState<Target>();
  const admins = infra.data?.admins ?? [];
  const allowed = !!infra.data?.allowed;
  const segPending = new Set(
    (infra.data?.pulls ?? [])
      .filter(p => /^console\/segdel-/.test(p.branch))
      .map(p => pullTarget(p))
      .map(x => `${x.zone}/${x.program}`),
  );
  const go = (x: Target) => {
    setTarget(undefined);
    const id = `${x.zone}/${x.program}`;
    if (x.kind === 'cluster') run(() => post('/infra/clusters/delete', { zone: x.zone, program: x.program }), a => t('infra.deleteOpened', { n: a.pull?.number ?? '', target: id }));
    else run(() => post('/infra/segregations/delete', { zone: x.zone, program: x.program }), a => t('rt.segOpened', { n: a.pull?.number ?? '', id }));
  };
  return (
    <InfraFrame title={t('nav.retire')} crumb={t('nav.retire')} sub={t('rt.sub')}>
      {view => {
        const progs = view.zones.flatMap(z => z.programs.map(p => ({ z: z.name, p, id: `${z.name}/${p.name}` })));
        const clusters = progs.filter(x => x.p.cluster);
        const blocked = (x: (typeof progs)[number]) => {
          const vms = x.p.vms.filter(v => v.role !== 'zone router').length;
          if (segPending.has(x.id)) return { label: t('rt.segPending'), tone: TONES.info };
          if (admins.includes(x.id)) return { label: t('rt.own'), tone: TONES.off };
          if (x.p.cluster) return { label: t('rt.hasCluster', { name: x.p.cluster.name }), tone: TONES.warn };
          if (vms) return { label: t('rt.hasVms', { n: vms }), tone: TONES.warn };
          if (!allowed) return { label: t('rt.onlyAdmin'), tone: TONES.off };
          return undefined;
        };
        return (
          <>
            {!allowed && infra.data && <Typography color="text.secondary">{t('rt.readOnly')}</Typography>}
            {target && <TypeToConfirm target={target} busy={busy} onYes={() => go(target)} onNo={() => setTarget(undefined)} />}
            <ResultNote note={note} />
            <Card title={t('rt.clustersTitle')} sub={t('rt.clustersSub')}>
              {clusters.length === 0 ? (
                <Typography color="text.secondary">{t('rt.noClusters')}</Typography>
              ) : (
                <Table
                  head={[t('zone.programme'), t('shell.cluster'), t('cluster.nodes'), t('zone.state'), '']}
                  rows={clusters.map(x => {
                    const c = x.p.cluster!;
                    const own = admins.includes(x.id);
                    const deleting = infra.data?.clusters.some(f => f.zone === x.z && f.program === x.p.name && f.delete);
                    let state = <Badge label={c.state} {...TONES[/RUNNING/.test(c.state) ? 'ok' : 'warn']} />;
                    if (deleting) state = <Badge label={t('rt.deleting')} {...TONES.info} />;
                    return [
                      <Link to={`/console/infrastructure/platform/${x.z}/${x.p.name}`}>{x.id}</Link>,
                      <Id>{c.name}</Id>,
                      Object.entries(c.roles ?? {}).map(([r, n]) => `${n} ${r}`).join(' · '),
                      state,
                      own ? (
                        <Badge label={t('rt.own')} {...TONES.off} />
                      ) : (
                        <Button size="small" variant="outlined" color="error" disabled={!allowed || deleting || busy} onClick={() => setTarget({ kind: 'cluster', zone: x.z, program: x.p.name, name: c.name })} sx={{ textTransform: 'none' }}>
                          {t('rt.destroy')}
                        </Button>
                      ),
                    ];
                  })}
                />
              )}
            </Card>
            <Card title={t('rt.segTitle')} sub={t('rt.segSub')}>
              <Table
                head={[t('zone.programme'), t('inv.networks'), t('shell.cluster'), 'VMs', t('rt.canGo'), '']}
                rows={progs.map(x => {
                  const why = blocked(x);
                  return [
                    <Link to={`/console/infrastructure/platform/${x.z}/${x.p.name}`}>{x.id}</Link>,
                    <Id>{x.p.networks.map(n => n.name).join(', ') || '—'}</Id>,
                    x.p.cluster?.name ?? '—',
                    String(x.p.vms.filter(v => v.role !== 'zone router').length),
                    why ? <Badge label={why.label} {...why.tone} /> : <Badge label={t('rt.canRemove')} {...TONES.ok} />,
                    <Button size="small" variant="outlined" color="error" disabled={!!why || busy} onClick={() => setTarget({ kind: 'segregation', zone: x.z, program: x.p.name, name: x.id })} sx={{ textTransform: 'none' }}>
                      {t('rt.remove')}
                    </Button>,
                  ];
                })}
              />
            </Card>
          </>
        );
      }}
    </InfraFrame>
  );
};
