import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { Page, Header, Content } from '@backstage/core-components';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import AddIcon from '@mui/icons-material/Add';

type Kind = 'buckets' | 'table-buckets' | 'groups' | 'policies';

interface Row {
  name: string;
  owner?: string;
  arn?: string;
  versioningStatus?: string;
  size?: number;
  memberCount?: number;
  policyNames?: string[];
  status?: string;
}

const KIND_CONFIG: Record<Kind, { label: string; templateNoun: string }> = {
  buckets: { label: 'Buckets', templateNoun: 'bucket' },
  'table-buckets': { label: 'Table Buckets', templateNoun: 'table-bucket' },
  groups: { label: 'Groups', templateNoun: 'group' },
  policies: { label: 'Policies', templateNoun: 'policy' },
};

function PolicyPicker({
  open,
  group,
  onClose,
  onChanged,
}: {
  open: boolean;
  group: Row | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [availablePolicies, setAvailablePolicies] = useState<Row[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    (async () => {
      setError(undefined);
      try {
        const baseUrl = await discoveryApi.getBaseUrl('seaweedfs-manager');
        // Same ownership-scoped list the Policies tab uses — a non-admin
        // only ever sees policies they created; a backstage-admin sees all.
        const res = await fetchApi.fetch(`${baseUrl}/policies`);
        const body = (await res.json()) as { items: Row[] };
        setAvailablePolicies(body.items);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [open, discoveryApi, fetchApi]);

  if (!group) return null;

  const attached = group.policyNames ?? [];
  const attachable = availablePolicies.filter(p => !attached.includes(p.name));

  const attach = async () => {
    if (!selected) return;
    const baseUrl = await discoveryApi.getBaseUrl('seaweedfs-manager');
    const res = await fetchApi.fetch(`${baseUrl}/groups/${encodeURIComponent(group.name)}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_name: selected }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${res.status} ${res.statusText}`);
      return;
    }
    setSelected('');
    onChanged();
  };

  const detach = async (policyName: string) => {
    const baseUrl = await discoveryApi.getBaseUrl('seaweedfs-manager');
    const res = await fetchApi.fetch(
      `${baseUrl}/groups/${encodeURIComponent(group.name)}/policies/${encodeURIComponent(policyName)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${res.status} ${res.statusText}`);
      return;
    }
    onChanged();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Policies for group "{group.name}"</DialogTitle>
      <DialogContent>
        {error && <Typography color="error">Error: {error}</Typography>}
        <Typography variant="subtitle2" sx={{ mt: 1 }}>Attached</Typography>
        <Box sx={{ mb: 2 }}>
          {attached.length === 0 && <Typography color="textSecondary">None yet.</Typography>}
          {attached.map(p => (
            <Chip key={p} label={p} onDelete={() => detach(p)} sx={{ mr: 0.5, mb: 0.5 }} />
          ))}
        </Box>
        <Typography variant="subtitle2">
          Attach a policy{' '}
          <Typography component="span" variant="caption" color="textSecondary">
            (only policies you created are offered here, unless you're backstage-admin)
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="policy-select-label">Policy</InputLabel>
            <Select
              labelId="policy-select-label"
              label="Policy"
              value={selected}
              onChange={e => setSelected(e.target.value as string)}
            >
              {attachable.length === 0 && (
                <MenuItem value="" disabled>
                  No available policies of yours
                </MenuItem>
              )}
              {attachable.map(p => (
                <MenuItem key={p.name} value={p.name}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" size="small" disabled={!selected} onClick={attach}>
            Attach
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export const SeaweedfsManagerPage = () => {
  const [tab, setTab] = useState<Kind>('buckets');
  const [items, setItems] = useState<Row[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [policyPickerGroup, setPolicyPickerGroup] = useState<Row | null>(null);
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const navigate = useNavigate();

  const load = useCallback(
    async (kind: Kind) => {
      setLoading(true);
      setError(undefined);
      try {
        const baseUrl = await discoveryApi.getBaseUrl('seaweedfs-manager');
        const res = await fetchApi.fetch(`${baseUrl}/${kind}`);
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const body = (await res.json()) as { items: Row[]; isAdmin: boolean };
        setItems(body.items);
        setIsAdmin(body.isAdmin);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [discoveryApi, fetchApi],
  );

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  const { label, templateNoun } = KIND_CONFIG[tab];

  const goToCreate = () => {
    navigate(`/create/templates/default/seaweedfs-create-${templateNoun}`);
  };

  const remove = async (row: Row) => {
    const baseUrl = await discoveryApi.getBaseUrl('seaweedfs-manager');
    const path =
      tab === 'table-buckets'
        ? `table-buckets?arn=${encodeURIComponent(row.arn ?? '')}`
        : `${tab}/${encodeURIComponent(row.name)}`;
    const res = await fetchApi.fetch(`${baseUrl}/${path}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${res.status} ${res.statusText}`);
      return;
    }
    load(tab);
  };

  return (
    <Page themeId="tool">
      <Header
        title="SeaweedFS Manager"
        subtitle="Browse and manage the SeaweedFS object storage resources you've created"
      />
      <Content>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs value={tab} onChange={(_e, v: Kind) => setTab(v)}>
            <Tab label="Buckets" value="buckets" />
            <Tab label="Table Buckets" value="table-buckets" />
            <Tab label="Groups" value="groups" />
            <Tab label="Policies" value="policies" />
          </Tabs>
          <Button variant="contained" startIcon={<AddIcon />} onClick={goToCreate}>
            New {templateNoun.replace('-', ' ')}
          </Button>
        </Box>
        <Box sx={{ mt: 2 }}>
          {loading && <CircularProgress size={24} />}
          {error && <Typography color="error">Error: {error}</Typography>}
          {!loading && !error && (
            <>
              {isAdmin && (
                <Typography variant="caption" color="textSecondary" sx={{ mb: 1, display: 'block' }}>
                  Showing all {label.toLowerCase()} (backstage-admin) — the Owner column shows who
                  created each one. SeaweedFS's own Admin UI still shows every group/policy to any
                  authenticated user regardless of role — this filtering only applies here in Backstage.
                </Typography>
              )}
              {items.length === 0 ? (
                <Typography color="textSecondary" sx={{ py: 4 }}>
                  {isAdmin
                    ? `No ${label.toLowerCase()} found.`
                    : `You haven't created any ${label.toLowerCase()} yet — use "New ${templateNoun}" above.`}
                </Typography>
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      {tab === 'buckets' && <TableCell>Versioning</TableCell>}
                      {tab === 'groups' && <TableCell>Members</TableCell>}
                      {tab === 'groups' && <TableCell>Policies</TableCell>}
                      {isAdmin && <TableCell>Owner</TableCell>}
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map(row => (
                      <TableRow key={row.arn ?? row.name}>
                        <TableCell>{row.name}</TableCell>
                        {tab === 'buckets' && <TableCell>{row.versioningStatus || 'Not configured'}</TableCell>}
                        {tab === 'groups' && <TableCell>{row.memberCount ?? 0}</TableCell>}
                        {tab === 'groups' && (
                          <TableCell>
                            {(row.policyNames ?? []).map(p => (
                              <Chip key={p} size="small" label={p} sx={{ mr: 0.5, mb: 0.5 }} />
                            ))}
                          </TableCell>
                        )}
                        {isAdmin && <TableCell>{row.owner}</TableCell>}
                        <TableCell align="right">
                          {tab === 'groups' && (
                            <Button size="small" onClick={() => setPolicyPickerGroup(row)}>
                              Manage policies
                            </Button>
                          )}
                          <Button size="small" color="error" onClick={() => remove(row)}>
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </Box>
      </Content>
      <PolicyPicker
        open={policyPickerGroup !== null}
        group={policyPickerGroup}
        onClose={() => setPolicyPickerGroup(null)}
        onChanged={() => {
          load('groups');
          // Keep the dialog open (re-fetch group list picks up the new
          // attached-policy chips) but refresh the dialog's own view of the
          // group by clearing the stale reference — the user can reopen it.
          setPolicyPickerGroup(null);
        }}
      />
    </Page>
  );
};
