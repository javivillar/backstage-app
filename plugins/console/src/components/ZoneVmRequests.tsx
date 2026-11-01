import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { type Zone, useVmRequests, type VmRequest, vmStatus } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';


function useVmPost() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return async (path: string, body: Record<string, string>) => {
    const res = await fetch(`${await discovery.getBaseUrl('cluster')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(answer.error ?? `${res.status} ${res.statusText}`);
  };
}

/** Zone › Virtual machines: create a VM (backstage-admin), and the VMs requested from the console with what the host did. */
export const ZoneVmRequests = ({ zone }: { zone: Zone }) => {
  const req = useVmRequests();
  const post = useVmPost();
  const spec = req.data?.policy;
  const allowed = !!req.data?.allowed;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ program: zone.programs[0]?.name ?? '', name: '', image: '', size: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>();
  const [pending, setPending] = useState<{ text: string; go: () => Promise<void> } | undefined>();
  const image = form.image || Object.keys(spec?.images ?? {})[0] || '';
  const size = form.size || Object.keys(spec?.sizes ?? {})[0] || '';
  const mine = (req.data?.vms ?? []).filter(v => v.zone === zone.name);
  const run = async (go: () => Promise<void>, ok: string) => {
    setMsg(undefined);
    try {
      await go();
      setMsg({ ok: true, text: ok });
      req.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const create = () =>
    run(async () => {
      await post('/zone/vms', { zone: zone.name, program: form.program, name: form.name.trim(), image, size });
      setOpen(false);
      setForm(f => ({ ...f, name: '' }));
    }, `Requested: ${form.name} is in git; Argo CD and Crossplane create it on the private network of ${form.program} in a few minutes.`);
  const remove = (v: VmRequest) =>
    setPending({
      text: `Delete ${v.name}? Its file leaves git and Crossplane destroys the VM and its disk.`,
      go: () => run(() => post('/zone/vms/delete', { zone: v.zone, program: v.program, name: v.name }), 'Deleted from git: Crossplane destroys the VM in a few minutes.'),
    });
  const program = zone.programs.find(p => p.name === form.program);
  const privateNet = program?.networks.find(n => n.role === 'private');
  return (
    <Card
      title="VMs requested from the console"
      sub="As code: one file per VM in git (console-vms-oneke), synced by Argo CD; Crossplane creates it in OpenNebula with the user of its programme, on its private network. Deleting it removes the file and the VM."
    >
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="contained" disabled={!allowed || !spec} onClick={() => setOpen(o => !o)} sx={{ textTransform: 'none' }}>
          Create VM
        </Button>
        {!allowed && req.data && <Typography variant="body2" color="text.secondary">Only backstage-admin can create VMs for now.</Typography>}
        {req.error && <Typography variant="body2" color="error">{req.error}</Typography>}
        {spec && (
          <Typography variant="body2" color="text.secondary">
            Limits per programme: {spec.limits.vms ?? '—'} VMs, {spec.limits.cpu ?? '—'} CPU, {spec.limits.memory_mb ? `${spec.limits.memory_mb / 1024} GiB` : '—'} · the host keeps memory free (a VM that does not fit waits)
          </Typography>
        )}
      </Box>
      {open && spec && (
        <Box component="form" onSubmit={e => { e.preventDefault(); create(); }} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', p: 1.5, border: 1, borderColor: 'divider', borderRadius: '10px', alignItems: 'start' }}>
          <TextField select size="small" label="Programme" value={form.program} onChange={e => setForm(f => ({ ...f, program: e.target.value }))}>
            {zone.programs.map(p => (
              <MenuItem key={p.name} value={p.name}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" label="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase() }))} helperText={`VM vm-${zone.name}-${form.program || '…'}-${form.name || '…'}`} inputProps={{ pattern: '[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?' }} />
          <TextField select size="small" label="Image" value={image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))}>
            {Object.entries(spec.images).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {k} ({v})
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Size" value={size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))}>
            {Object.entries(spec.sizes).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {k}: {v.cpu} CPU · {v.memory_mb / 1024} GiB · {v.disk_gb} GB disk
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
            Network: the private network of {form.program || 'the programme'}{privateNet ? ` (${privateNet.name}, ${privateNet.cidr})` : ''}, with its security group. No public address.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, gridColumn: '1 / -1' }}>
            <Button type="submit" variant="contained" disabled={!form.name || !form.program} sx={{ textTransform: 'none' }}>
              Request the VM
            </Button>
            <Button variant="text" onClick={() => setOpen(false)} sx={{ textTransform: 'none' }}>
              Cancel
            </Button>
          </Box>
        </Box>
      )}
      {pending && (
        <Box role="alertdialog" aria-label="Confirm" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', bgcolor: TONES.warn.bg, borderRadius: '8px', p: 1.25 }}>
          <Typography sx={{ flex: '1 1 260px' }}>{pending.text}</Typography>
          <Button variant="contained" onClick={() => { const p = pending; setPending(undefined); p.go(); }} sx={{ textTransform: 'none' }}>
            Confirm
          </Button>
          <Button variant="text" onClick={() => setPending(undefined)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
        </Box>
      )}
      {msg && (
        <Typography role="status" sx={{ bgcolor: msg.ok ? TONES.ok.bg : TONES.bad.bg, color: msg.ok ? TONES.ok.fg : TONES.bad.fg, borderRadius: '8px', p: 1.25 }}>
          {msg.text}
        </Typography>
      )}
      {mine.length === 0 ? (
        <Typography color="text.secondary">None requested yet.</Typography>
      ) : (
        <Table
          head={['VM', 'Programme', 'Size · image', 'State', '']}
          rows={mine.map(v => {
            const st = vmStatus(v);
            return [
              <span>
                <b>{v.name}</b>
                <br />
                <Typography component="span" variant="caption" color="text.secondary">
                  {v.requested_by?.replace(/^user:default\//, '') ?? ''}
                </Typography>
              </span>,
              v.program,
              `${v.size} · ${v.image}`,
              <span>
                <Badge label={st.label} {...TONES[st.tone]} />
                {st.detail && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {st.detail}
                  </Typography>
                )}
              </span>,
              allowed ? (
                <Button size="small" variant="text" color="error" onClick={() => remove(v)} sx={{ textTransform: 'none' }}>
                  Delete
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
