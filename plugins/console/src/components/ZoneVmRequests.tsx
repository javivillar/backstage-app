import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { consoleVmName, type Zone, useVmRequests, type VmRequest, vmHref, vmStatus } from '../zone';
import { Link } from '@backstage/core-components';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { useClusterPost } from '../post';
import { ConfirmBar, PullList, ResultNote, useChange } from './Requests';
import { useI18n } from '../i18n';
import { componentTitle } from '../interconnection';
import { Id } from './ui';

/** Zone › Virtual machines: create a VM (backstage-admin), and the VMs requested from the console with what the host did. */
export const ZoneVmRequests = ({ zone }: { zone: Zone }) => {
  const req = useVmRequests();
  const { t } = useI18n();
  const post = useClusterPost();
  const spec = req.data?.policy;
  const allowed = !!req.data?.allowed;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ program: zone.programs[0]?.name ?? '', name: '', image: '', size: '' });
  const { note, busy, run } = useChange(req.reload);
  const [pending, setPending] = useState<{ text: string; go: () => void } | undefined>();
  const image = form.image || Object.keys(spec?.images ?? {})[0] || '';
  const size = form.size || Object.keys(spec?.sizes ?? {})[0] || '';
  const mine = (req.data?.vms ?? []).filter(v => v.zone === zone.name);
  const create = async () => {
    const done = await run(
      () => post('/zone/vms', { zone: zone.name, program: form.program, name: form.name.trim(), image, size }),
      a => t('vmr.opened', { n: a.pull?.number ?? '', name: form.name, program: form.program }),
    );
    if (done) {
      setOpen(false);
      setForm(f => ({ ...f, name: '' }));
    }
  };
  const remove = (v: VmRequest) =>
    setPending({
      text: t('vmr.confirmDelete', { name: v.name }),
      go: () => run(() => post('/zone/vms/delete', { zone: v.zone, program: v.program, name: v.name }), a => t('vmr.deleteOpened', { n: a.pull?.number ?? '', name: v.name })),
    });
  const pulls = req.data?.pulls ?? [];
  const program = zone.programs.find(p => p.name === form.program);
  const privateNet = program?.networks.find(n => n.role === 'private');
  return (
    <Card
      title={t('vmr.title')}
      sub={t('vmr.sub')}
    >
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="contained" disabled={!allowed || !spec} onClick={() => setOpen(o => !o)}>
          {t('vmr.create')}
        </Button>
        {!allowed && req.data && <Typography variant="body2" color="text.secondary">{t('vmr.onlyAdmin')}</Typography>}
        {req.error && <Typography variant="body2" color="error">{req.error}</Typography>}
        {spec && (
          <Typography variant="body2" color="text.secondary">
            {t('vmr.limits', { vms: spec.limits.vms ?? '—', cpu: spec.limits.cpu ?? '—', mem: spec.limits.memory_mb ? `${spec.limits.memory_mb / 1024} GiB` : '—' })}
          </Typography>
        )}
      </Box>
      {open && spec && (
        <Box component="form" onSubmit={e => { e.preventDefault(); create(); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', p: 1.5, border: 1, borderColor: 'divider', borderRadius: '8px', alignItems: 'start' }}>
          <TextField select size="small" label={t('zone.programme')} value={form.program} onChange={e => setForm(f => ({ ...f, program: e.target.value }))}>
            {zone.programs.map(p => (
              <MenuItem key={p.name} value={p.name}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" label={t('zone.name')} required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase() }))} helperText={`VM vm-${zone.name}-${form.program || '…'}-${form.name || '…'}`} inputProps={{ pattern: '[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?' }} />
          <TextField select size="small" label={t('img.image')} value={image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))}>
            {Object.entries(spec.images).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {k} ({v})
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t('vmr.size')} value={size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))}>
            {Object.entries(spec.sizes).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {k}: {v.cpu} CPU · {v.memory_mb / 1024} GiB · {v.disk_gb} GB disk
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
            {t('vmr.network', { program: form.program || '…', net: privateNet ? ` (${privateNet.name}, ${privateNet.cidr})` : '' })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, gridColumn: '1 / -1' }}>
            <Button type="submit" variant="contained" disabled={busy || !form.name || !form.program}>
              {t('vmr.openPr')}
            </Button>
            <Button variant="text" onClick={() => setOpen(false)}>
              {t('vmr.cancel')}
            </Button>
          </Box>
        </Box>
      )}
      {pending && <ConfirmBar text={pending.text} onYes={() => { const p = pending; setPending(undefined); p.go(); }} onNo={() => setPending(undefined)} />}
      <ResultNote note={note} />
      <PullList pulls={pulls} />
      {mine.length === 0 ? (
        <Typography color="text.secondary">{t('vmr.none')}</Typography>
      ) : (
        <Table
          head={['VM', t('zone.programme'), t('vmr.sizeImage'), t('zone.state'), '']}
          rows={mine.map(v => {
            const inOne = zone.programs.find(p => p.name === v.program)?.vms.find(x => x.name === consoleVmName(v));
            const st = inOne?.state === 'PENDING' ? { label: t('vmr.waiting'), tone: 'warn' as const, detail: t('vmr.waitingDetail') } : vmStatus(v);
            return [
              <span>
                <Link to={vmHref(consoleVmName(v))}>
                  <Id>{v.name}</Id>
                </Link>
                <br />
                <Typography component="span" variant="caption" color="text.secondary">
                  {v.requested_by?.replace(/^user:default\//, '') ?? ''}
                </Typography>
              </span>,
              v.program,
              v.component ? `${componentTitle(v.component, v.traffic)} · ${v.cpu ?? '?'} vCPU · ${(v.memory_mb ?? 0) / 1024} GiB · ${v.disk_gb ?? '?'} GB` : `${v.size} · ${v.image}`,
              <span>
                <Badge label={st.label} {...TONES[st.tone]} />
                {st.detail && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {st.detail}
                  </Typography>
                )}
              </span>,
              allowed ? (
                <Button size="small" variant="outlined" color="error" onClick={() => remove(v)}>
                  {t('vmr.delete')}
                </Button>
              ) : (
                ''
              ),
            ];
          })}
        />
      )}
    </Card>
  );
};
