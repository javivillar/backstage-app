import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { Page, Header, Content } from '@backstage/core-components';
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
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';

const SITE_ROLES = ['SiteManager', 'SiteCollaborator', 'SiteContributor', 'SiteConsumer'] as const;
type SiteRoleValue = (typeof SITE_ROLES)[number];

interface SiteRow {
  id: string;
  title: string;
  description?: string;
  visibility: string;
  role?: string;
}

interface MemberRow {
  personId: string;
  role: string;
}

function MembersDialog({
  open,
  site,
  onClose,
}: {
  open: boolean;
  site: SiteRow | null;
  onClose: () => void;
}) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [newPersonId, setNewPersonId] = useState('');
  const [newRole, setNewRole] = useState<SiteRoleValue>('SiteConsumer');
  const [error, setError] = useState<string | undefined>();

  const loadMembers = useCallback(async () => {
    if (!site) return;
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('alfresco-manager');
      const res = await fetchApi.fetch(`${baseUrl}/sites/${encodeURIComponent(site.id)}/members`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { items: MemberRow[] };
      setMembers(body.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site, discoveryApi, fetchApi]);

  useEffect(() => {
    if (open) loadMembers();
  }, [open, loadMembers]);

  if (!site) return null;

  const addOrPromote = async () => {
    if (!newPersonId.trim()) return;
    const baseUrl = await discoveryApi.getBaseUrl('alfresco-manager');
    const res = await fetchApi.fetch(`${baseUrl}/sites/${encodeURIComponent(site.id)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: newPersonId.trim(), role: newRole }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${res.status} ${res.statusText}`);
      return;
    }
    setNewPersonId('');
    loadMembers();
  };

  const remove = async (personId: string) => {
    const baseUrl = await discoveryApi.getBaseUrl('alfresco-manager');
    const res = await fetchApi.fetch(
      `${baseUrl}/sites/${encodeURIComponent(site.id)}/members/${encodeURIComponent(personId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${res.status} ${res.statusText}`);
      return;
    }
    loadMembers();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Members of "{site.id}"</DialogTitle>
      <DialogContent>
        {error && <Typography color="error">Error: {error}</Typography>}
        <Typography variant="subtitle2" sx={{ mt: 1 }}>Current members</Typography>
        <Box sx={{ mb: 2 }}>
          {members.length === 0 && <Typography color="textSecondary">None yet.</Typography>}
          {members.map(m => (
            <Chip
              key={m.personId}
              label={`${m.personId} (${m.role})`}
              onDelete={() => remove(m.personId)}
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
        </Box>
        <Typography variant="subtitle2">
          Add or promote a member{' '}
          <Typography component="span" variant="caption" color="textSecondary">
            (identify by their Backstage/Alfresco username, e.g. "jdoe")
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
          <TextField
            size="small"
            label="Username"
            value={newPersonId}
            onChange={e => setNewPersonId(e.target.value)}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="role-select-label">Role</InputLabel>
            <Select
              labelId="role-select-label"
              label="Role"
              value={newRole}
              onChange={e => setNewRole(e.target.value as SiteRoleValue)}
            >
              {SITE_ROLES.map(r => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" size="small" disabled={!newPersonId.trim()} onClick={addOrPromote}>
            Save
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export const AlfrescoManagerPage = () => {
  const [items, setItems] = useState<SiteRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [membersSite, setMembersSite] = useState<SiteRow | null>(null);
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('alfresco-manager');
      const res = await fetchApi.fetch(`${baseUrl}/sites`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { items: SiteRow[]; isAdmin: boolean };
      setItems(body.items);
      setIsAdmin(body.isAdmin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [discoveryApi, fetchApi]);

  useEffect(() => {
    load();
  }, [load]);

  const goToCreate = () => {
    navigate('/create/templates/default/alfresco-create-site');
  };

  const remove = async (row: SiteRow) => {
    const baseUrl = await discoveryApi.getBaseUrl('alfresco-manager');
    const res = await fetchApi.fetch(`${baseUrl}/sites/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${res.status} ${res.statusText}`);
      return;
    }
    load();
  };

  return (
    <Page themeId="tool">
      <Header
        title="Alfresco Manager"
        subtitle="Browse and manage the Alfresco Sites you've created"
      />
      <Content>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={goToCreate}>
            New site
          </Button>
        </Box>
        <Box sx={{ mt: 2 }}>
          {loading && <CircularProgress size={24} />}
          {error && <Typography color="error">Error: {error}</Typography>}
          {!loading && !error && (
            <>
              {isAdmin && (
                <Typography variant="caption" color="textSecondary" sx={{ mb: 1, display: 'block' }}>
                  Showing all sites (backstage-admin) — the Role column shows your own role on each
                  one, which may be none if you're viewing it purely as an admin.
                </Typography>
              )}
              {items.length === 0 ? (
                <Typography color="textSecondary" sx={{ py: 4 }}>
                  {isAdmin
                    ? 'No sites found.'
                    : 'You are not a member of any site yet — use "New site" above.'}
                </Typography>
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Site ID</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell>Visibility</TableCell>
                      <TableCell>Your role</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>{row.id}</TableCell>
                        <TableCell>{row.title}</TableCell>
                        <TableCell>{row.visibility}</TableCell>
                        <TableCell>{row.role ?? '—'}</TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => setMembersSite(row)}>
                            Manage members
                          </Button>
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
      <MembersDialog open={membersSite !== null} site={membersSite} onClose={() => setMembersSite(null)} />
    </Page>
  );
};
