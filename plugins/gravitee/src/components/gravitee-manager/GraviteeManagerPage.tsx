import { useState, useEffect, useCallback } from 'react';
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
import Link from '@mui/material/Link';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import AddIcon from '@mui/icons-material/Add';

interface ApiRow {
  id: string;
  name: string;
  version: string;
  description?: string;
  contextPath?: string;
  gatewayUrl?: string;
  backendUrl?: string;
  state?: string;
  visibility?: string;
  lifecycleState?: string;
  team?: string;
  owner?: string;
  access: 'owner' | 'admin' | 'team';
  canEdit: boolean;
  consoleUrl?: string;
}

interface ListResponse {
  items: ApiRow[];
  teams: string[];
  isAdmin: boolean;
  canCreate: boolean;
  gatewayPathPrefix: string;
  publicUrl: string;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `${res.status} ${res.statusText}`;
}

const ACCESS_LABEL: Record<ApiRow['access'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  team: 'Team (read-only)',
};

function CreateDialog({
  open,
  teams,
  pathPrefix,
  onClose,
  onCreated,
}: {
  open: boolean;
  teams: string[];
  pathPrefix: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [team, setTeam] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setName('');
      setVersion('1.0');
      setDescription('');
      setSlug('');
      setBackendUrl('');
      setTeam(teams.length === 1 ? teams[0] : '');
      setError(undefined);
    }
  }, [open, teams]);

  const create = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('gravitee-manager');
      const res = await fetchApi.fetch(`${baseUrl}/apis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          version: version.trim(),
          description: description.trim(),
          slug: slug.trim(),
          backendUrl: backendUrl.trim(),
          team,
        }),
      });
      if (!res.ok) {
        setError(await errorText(res));
        return;
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  const ready = name.trim() && version.trim() && slug.trim() && backendUrl.trim() && team;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New gateway</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
          Creates a Gravitee HTTP proxy API that you own. It starts private and stopped, with no plans: add plans and
          policies, then deploy and start it, in the Gravitee Console.
        </Typography>
        {error && <Typography color="error">Error: {error}</Typography>}
        <TextField fullWidth margin="dense" label="Name" value={name} onChange={e => setName(e.target.value)} />
        <TextField fullWidth margin="dense" label="Version" value={version} onChange={e => setVersion(e.target.value)} />
        <TextField
          fullWidth
          margin="dense"
          label="Description (optional)"
          multiline
          minRows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <TextField
          fullWidth
          margin="dense"
          label="Path"
          helperText="Lowercase letters, digits and '-'"
          value={slug}
          onChange={e => setSlug(e.target.value.toLowerCase())}
          InputProps={{
            startAdornment: <InputAdornment position="start">{pathPrefix}/</InputAdornment>,
            endAdornment: <InputAdornment position="end">/</InputAdornment>,
          }}
        />
        <TextField
          fullWidth
          margin="dense"
          label="Backend URL"
          placeholder="http://my-service.my-namespace.svc.cluster.local:8080"
          value={backendUrl}
          onChange={e => setBackendUrl(e.target.value)}
        />
        <FormControl fullWidth margin="dense">
          <InputLabel id="gv-team-label">Team</InputLabel>
          <Select labelId="gv-team-label" label="Team" value={team} onChange={e => setTeam(e.target.value as string)}>
            {teams.map(t => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="textSecondary">
          Members of this team can see the gateway here (read-only). Only you can change or delete it.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!ready || saving} onClick={create}>
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export const GraviteeManagerPage = () => {
  const [data, setData] = useState<ListResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('gravitee-manager');
      const res = await fetchApi.fetch(`${baseUrl}/apis`);
      if (!res.ok) throw new Error(await errorText(res));
      setData((await res.json()) as ListResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [discoveryApi, fetchApi]);

  useEffect(() => {
    load();
  }, [load]);

  const items = data?.items ?? [];

  return (
    <Page themeId="tool">
      <Header title="Gravitee Manager" subtitle="Your API gateways — created here, configured in the Gravitee Console" />
      <Content>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2" color="textSecondary">
            {data && (data.teams.length ? `Your teams: ${data.teams.join(', ')}` : 'You are not in any gravitee-team-* group.')}
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!data?.canCreate}
            onClick={() => setCreating(true)}
          >
            New gateway
          </Button>
        </Box>
        <Box sx={{ mt: 2 }}>
          {loading && <CircularProgress size={24} />}
          {error && <Typography color="error">Error: {error}</Typography>}
          {!loading && !error && (
            <>
              {data?.isAdmin && (
                <Typography variant="caption" color="textSecondary" sx={{ mb: 1, display: 'block' }}>
                  Showing every API in Gravitee (admin).
                </Typography>
              )}
              {items.length === 0 ? (
                <Typography color="textSecondary" sx={{ py: 4 }}>
                  {data?.canCreate
                    ? 'No gateways yet — use "New gateway" above.'
                    : 'Nothing to show. Ask to be added to a gravitee-team-* group to create gateways.'}
                </Typography>
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Gateway</TableCell>
                      <TableCell>Public URL</TableCell>
                      <TableCell>Backend</TableCell>
                      <TableCell>Team</TableCell>
                      <TableCell>Owner</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Your access</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Typography variant="body2">{row.name}</Typography>
                          <Typography variant="caption" color="textSecondary">
                            v{row.version}
                            {row.description ? ` — ${row.description}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {row.gatewayUrl ? (
                            <Link href={row.gatewayUrl} target="_blank" rel="noopener">
                              {row.contextPath}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{row.backendUrl ?? '—'}</Typography>
                        </TableCell>
                        <TableCell>{row.team ?? '—'}</TableCell>
                        <TableCell>{row.owner ?? '—'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={row.state ?? '?'}
                            color={row.state === 'STARTED' ? 'success' : 'default'}
                            sx={{ mr: 0.5, mb: 0.5 }}
                          />
                          <Chip size="small" variant="outlined" label={row.visibility ?? '?'} sx={{ mr: 0.5, mb: 0.5 }} />
                          {row.lifecycleState && (
                            <Chip size="small" variant="outlined" label={row.lifecycleState} sx={{ mb: 0.5 }} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={ACCESS_LABEL[row.access]} color={row.canEdit ? 'primary' : 'default'} />
                        </TableCell>
                        <TableCell align="right">
                          {row.consoleUrl && (
                            <Button size="small" href={row.consoleUrl} target="_blank" rel="noopener">
                              Open in Console
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
      <CreateDialog
        open={creating}
        teams={data?.teams ?? []}
        pathPrefix={data?.gatewayPathPrefix ?? '/gateway'}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          load();
        }}
      />
    </Page>
  );
};
