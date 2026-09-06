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
import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

interface Row {
  id: string;
  key: string;
  name: string;
  version: number;
  owner?: string;
  cockpitUrl: string;
}

// Single resource type (process definitions) — no tabs needed, unlike
// SupersetManagerPage. Instances/tasks are out of scope here: their
// isolation is already handled natively by the engine once a developer
// logs into Cockpit/Tasklist (see AUTHZ.md § bpm-oneke §6).
export const CamundaManagerPage = () => {
  const [items, setItems] = useState<Row[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('camunda-manager');
      const res = await fetchApi.fetch(`${baseUrl}/process-definitions`);
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
  }, [discoveryApi, fetchApi]);

  useEffect(() => {
    load();
  }, [load]);

  const goToCreate = () => navigate('/create/templates/default/camunda-provision-process');

  const goToUpdate = (row: Row) => {
    const formData = { processKey: row.key };
    navigate(
      `/create/templates/default/camunda-update-process?formData=${encodeURIComponent(JSON.stringify(formData))}`,
    );
  };

  const remove = async (row: Row) => {
    const baseUrl = await discoveryApi.getBaseUrl('camunda-manager');
    const res = await fetchApi.fetch(`${baseUrl}/process-definitions/${encodeURIComponent(row.key)}`, {
      method: 'DELETE',
    });
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
        title="Camunda Manager"
        subtitle="Browse and manage the Camunda process definitions you've provisioned"
      />
      <Content>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={goToCreate}>
            New process
          </Button>
        </Box>
        {loading && <CircularProgress size={24} />}
        {error && <Typography color="error">Error: {error}</Typography>}
        {!loading && !error && (
          <>
            {isAdmin && (
              <Typography variant="caption" color="textSecondary" sx={{ mb: 1, display: 'block' }}>
                Showing all process definitions (backstage-admin) — the Owner column shows who
                provisioned each one.
              </Typography>
            )}
            {items.length === 0 ? (
              <Typography color="textSecondary" sx={{ py: 4 }}>
                {isAdmin
                  ? 'No process definitions found.'
                  : 'You haven\'t provisioned any processes yet — use "New process" above.'}
              </Typography>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Key</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Version</TableCell>
                    {isAdmin && <TableCell>Owner</TableCell>}
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map(row => (
                    <TableRow key={row.key}>
                      <TableCell>{row.key}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.version}</TableCell>
                      {isAdmin && (
                        <TableCell>{row.owner && <Chip size="small" label={row.owner} />}</TableCell>
                      )}
                      <TableCell align="right">
                        <Button size="small" onClick={() => goToUpdate(row)}>
                          Edit
                        </Button>
                        <Button size="small" color="error" onClick={() => remove(row)}>
                          Delete
                        </Button>
                        <Button
                          size="small"
                          endIcon={<OpenInNewIcon fontSize="small" />}
                          href={row.cockpitUrl}
                          target="_blank"
                          rel="noopener"
                        >
                          Cockpit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Content>
    </Page>
  );
};
