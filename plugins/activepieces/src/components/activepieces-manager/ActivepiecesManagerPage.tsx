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

interface ProjectRow {
  id: string;
  displayName: string;
  owner?: string;
  role?: string;
  canManage: boolean;
  canManageMembers: boolean;
  canReadFlows: boolean;
  canWriteFlows: boolean;
  url: string;
}

interface FlowRow {
  id: string;
  displayName: string;
  folder?: string;
  status: string;
  url: string;
}

interface MemberRow {
  memberId: string;
  email: string;
  name: string;
  role: string;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `${res.status} ${res.statusText}`;
}

function MembersDialog({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: ProjectRow | null;
  onClose: () => void;
}) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [pending, setPending] = useState<Array<{ email: string }>>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('Viewer');
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!project) return;
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
      const [mRes, rRes] = await Promise.all([
        fetchApi.fetch(`${baseUrl}/projects/${encodeURIComponent(project.id)}/members`),
        fetchApi.fetch(`${baseUrl}/roles`),
      ]);
      if (!mRes.ok) throw new Error(await errorText(mRes));
      const m = (await mRes.json()) as { items: MemberRow[]; pending: Array<{ email: string }> };
      setMembers(m.items);
      setPending(m.pending);
      if (rRes.ok) setRoles(((await rRes.json()) as { items: string[] }).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project, discoveryApi, fetchApi]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!project) return null;

  const save = async () => {
    const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
    const res = await fetchApi.fetch(`${baseUrl}/projects/${encodeURIComponent(project.id)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), role }),
    });
    if (!res.ok) {
      setError(await errorText(res));
      return;
    }
    setUsername('');
    load();
  };

  const remove = async (memberId: string) => {
    const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
    const res = await fetchApi.fetch(
      `${baseUrl}/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      setError(await errorText(res));
      return;
    }
    load();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Members of "{project.displayName}"</DialogTitle>
      <DialogContent>
        {error && <Typography color="error">Error: {error}</Typography>}
        <Typography variant="subtitle2" sx={{ mt: 1 }}>Current members</Typography>
        <Box sx={{ mb: 2 }}>
          {members.length === 0 && <Typography color="textSecondary">None yet.</Typography>}
          {members.map(m => (
            <Chip
              key={m.memberId}
              label={`${m.email} (${m.role})`}
              onDelete={() => remove(m.memberId)}
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
          {pending.map(p => (
            <Chip
              key={p.email}
              variant="outlined"
              label={`${p.email} (invited — joins at first Activepieces login)`}
              sx={{ mr: 0.5, mb: 0.5 }}
            />
          ))}
        </Box>
        <Typography variant="subtitle2">
          Add a member or change their role{' '}
          <Typography component="span" variant="caption" color="textSecondary">
            (Backstage username, e.g. "jdoe"). The role decides what they can do inside Activepieces.
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
          <TextField size="small" label="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="ap-role-label">Role</InputLabel>
            <Select labelId="ap-role-label" label="Role" value={role} onChange={e => setRole(e.target.value as string)}>
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" size="small" disabled={!username.trim()} onClick={save}>
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

function FlowsDialog({ project, onClose }: { project: ProjectRow | null; onClose: () => void }) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [renaming, setRenaming] = useState<FlowRow | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<FlowRow | null>(null);
  const [error, setError] = useState<string | undefined>();

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
      return fetchApi.fetch(`${baseUrl}/projects/${encodeURIComponent(project?.id ?? '')}/flows${path}`, init);
    },
    [discoveryApi, fetchApi, project],
  );

  const load = useCallback(async () => {
    if (!project) return;
    setError(undefined);
    try {
      const res = await call('');
      if (!res.ok) throw new Error(await errorText(res));
      setFlows(((await res.json()) as { items: FlowRow[] }).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project, call]);

  useEffect(() => {
    load();
  }, [load]);

  if (!project) return null;

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const create = async () => {
    const res = await call('', json({ displayName: name.trim(), folder: folder.trim() }));
    if (!res.ok) {
      setError(await errorText(res));
      return;
    }
    setName('');
    setFolder('');
    load();
  };

  const rename = async () => {
    if (!renaming) return;
    const res = await call(`/${encodeURIComponent(renaming.id)}`, json({ displayName: newName.trim() }));
    setRenaming(null);
    if (!res.ok) {
      setError(await errorText(res));
      return;
    }
    load();
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await call(`/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
    setDeleting(null);
    if (!res.ok && res.status !== 204) {
      setError(await errorText(res));
      return;
    }
    load();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Flows of "{project.displayName}"</DialogTitle>
      <DialogContent>
        {error && <Typography color="error">Error: {error}</Typography>}
        {project.canWriteFlows && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              New flow{' '}
              <Typography component="span" variant="caption" color="textSecondary">
                (created empty and disabled — you build and publish it in Activepieces)
              </Typography>
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', my: 1 }}>
              <TextField size="small" label="Flow name" value={name} onChange={e => setName(e.target.value)} />
              <TextField
                size="small"
                label="Folder (optional)"
                value={folder}
                onChange={e => setFolder(e.target.value)}
              />
              <Button variant="contained" size="small" disabled={!name.trim()} onClick={create}>
                Create
              </Button>
            </Box>
          </>
        )}
        {flows.length === 0 ? (
          <Typography color="textSecondary" sx={{ py: 2 }}>
            No flows yet.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Flow</TableCell>
                <TableCell>Folder</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {flows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.displayName}</TableCell>
                  <TableCell>{row.folder ?? '—'}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell align="right">
                    <Button size="small" href={row.url} target="_blank" rel="noopener">
                      Open
                    </Button>
                    {project.canWriteFlows && (
                      <>
                        <Button
                          size="small"
                          onClick={() => {
                            setNewName(row.displayName);
                            setRenaming(row);
                          }}
                        >
                          Rename
                        </Button>
                        <Button size="small" color="error" onClick={() => setDeleting(row)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename flow</DialogTitle>
        <DialogContent>
          <TextField fullWidth sx={{ mt: 1 }} label="Flow name" value={newName} onChange={e => setNewName(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>Cancel</Button>
          <Button variant="contained" disabled={!newName.trim()} onClick={rename}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete flow</DialogTitle>
        <DialogContent>
          <Typography>Delete "{deleting?.displayName}"? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={remove}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

function RenameDialog({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setName(project?.displayName ?? '');
    setError(undefined);
  }, [project]);

  if (!project) return null;

  const save = async () => {
    const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
    const res = await fetchApi.fetch(`${baseUrl}/projects/${encodeURIComponent(project.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name.trim() }),
    });
    if (!res.ok) {
      setError(await errorText(res));
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename project</DialogTitle>
      <DialogContent>
        {error && <Typography color="error">Error: {error}</Typography>}
        <TextField fullWidth sx={{ mt: 1 }} label="Project name" value={name} onChange={e => setName(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim()} onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export const ActivepiecesManagerPage = () => {
  const [items, setItems] = useState<ProjectRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [membersProject, setMembersProject] = useState<ProjectRow | null>(null);
  const [renameProject, setRenameProject] = useState<ProjectRow | null>(null);
  const [flowsProject, setFlowsProject] = useState<ProjectRow | null>(null);
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
      const res = await fetchApi.fetch(`${baseUrl}/projects`);
      if (!res.ok) throw new Error(await errorText(res));
      const body = (await res.json()) as { items: ProjectRow[]; isAdmin: boolean };
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

  const remove = async (row: ProjectRow) => {
    const baseUrl = await discoveryApi.getBaseUrl('activepieces-manager');
    const res = await fetchApi.fetch(`${baseUrl}/projects/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      setError(await errorText(res));
      return;
    }
    load();
  };

  return (
    <Page themeId="tool">
      <Header
        title="Activepieces Manager"
        subtitle="Your Activepieces projects — created here, modelled in Activepieces"
      />
      <Content>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/create/templates/default/activepieces-create-project')}
          >
            New project
          </Button>
        </Box>
        <Box sx={{ mt: 2 }}>
          {loading && <CircularProgress size={24} />}
          {error && <Typography color="error">Error: {error}</Typography>}
          {!loading && !error && (
            <>
              {isAdmin && (
                <Typography variant="caption" color="textSecondary" sx={{ mb: 1, display: 'block' }}>
                  Showing all Backstage-managed projects (backstage-admin) — the Role column shows your own
                  role on each one, which may be none if you're viewing it purely as an admin.
                </Typography>
              )}
              {items.length === 0 ? (
                <Typography color="textSecondary" sx={{ py: 4 }}>
                  {isAdmin
                    ? 'No projects found.'
                    : 'You are not a member of any project yet — use "New project" above.'}
                </Typography>
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Project</TableCell>
                      <TableCell>Created by</TableCell>
                      <TableCell>Your role</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>{row.displayName}</TableCell>
                        <TableCell>{row.owner ?? '—'}</TableCell>
                        <TableCell>{row.role ?? '—'}</TableCell>
                        <TableCell align="right">
                          <Button size="small" href={row.url} target="_blank" rel="noopener">
                            Open in Activepieces
                          </Button>
                          {row.canManage && (
                            <Button size="small" onClick={() => setRenameProject(row)}>
                              Rename
                            </Button>
                          )}
                          {row.canReadFlows && (
                            <Button size="small" onClick={() => setFlowsProject(row)}>
                              Flows
                            </Button>
                          )}
                          {row.canManageMembers && (
                            <Button size="small" onClick={() => setMembersProject(row)}>
                              Manage members
                            </Button>
                          )}
                          {row.canManage && (
                            <Button size="small" color="error" onClick={() => remove(row)}>
                              Delete
                            </Button>
                          )}
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
      <MembersDialog open={membersProject !== null} project={membersProject} onClose={() => setMembersProject(null)} />
      <FlowsDialog project={flowsProject} onClose={() => setFlowsProject(null)} />
      <RenameDialog
        project={renameProject}
        onClose={() => setRenameProject(null)}
        onSaved={() => {
          setRenameProject(null);
          load();
        }}
      />
    </Page>
  );
};
