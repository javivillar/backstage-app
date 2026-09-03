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
import AddIcon from '@mui/icons-material/Add';

type Kind = 'users' | 'groups' | 'clients';

interface Row {
  username?: string;
  name?: string;
  clientId?: string;
  email?: string;
  publicClient?: boolean;
  owner?: string;
}

const KIND_CONFIG: Record<Kind, { label: string; idField: keyof Row; templateNoun: string }> = {
  users: { label: 'Users', idField: 'username', templateNoun: 'user' },
  groups: { label: 'Groups', idField: 'name', templateNoun: 'group' },
  clients: { label: 'Clients', idField: 'clientId', templateNoun: 'client' },
};

export const KeycloakManagerPage = () => {
  const [tab, setTab] = useState<Kind>('users');
  const [items, setItems] = useState<Row[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const navigate = useNavigate();

  const load = useCallback(
    async (kind: Kind) => {
      setLoading(true);
      setError(undefined);
      try {
        const baseUrl = await discoveryApi.getBaseUrl('keycloak-manager');
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

  const { label, idField, templateNoun } = KIND_CONFIG[tab];

  const goToTemplate = (action: 'update' | 'delete', row: Row) => {
    const templateName = `keycloak-${action}-${templateNoun}`;
    const formData = { [idField]: row[idField] };
    navigate(
      `/create/templates/default/${templateName}?formData=${encodeURIComponent(
        JSON.stringify(formData),
      )}`,
    );
  };

  const goToCreate = () => {
    navigate(`/create/templates/default/keycloak-create-${templateNoun}`);
  };

  return (
    <Page themeId="tool">
      <Header
        title="Keycloak Manager"
        subtitle="Browse and manage the Keycloak identity objects you've created"
      />
      <Content>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs value={tab} onChange={(_e, v: Kind) => setTab(v)}>
            <Tab label="Users" value="users" />
            <Tab label="Groups" value="groups" />
            <Tab label="Clients" value="clients" />
          </Tabs>
          <Button variant="contained" startIcon={<AddIcon />} onClick={goToCreate}>
            New {templateNoun}
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
                  created each one.
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
                      <TableCell>{String(idField)}</TableCell>
                      {tab === 'users' && <TableCell>Email</TableCell>}
                      {tab === 'clients' && <TableCell>Type</TableCell>}
                      {isAdmin && <TableCell>Owner</TableCell>}
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row[idField]}</TableCell>
                        {tab === 'users' && <TableCell>{row.email}</TableCell>}
                        {tab === 'clients' && (
                          <TableCell>{row.publicClient ? 'Public' : 'Confidential'}</TableCell>
                        )}
                        {isAdmin && (
                          <TableCell>
                            <Chip size="small" label={row.owner ?? 'unrecorded'} />
                          </TableCell>
                        )}
                        <TableCell align="right">
                          <Button size="small" onClick={() => goToTemplate('update', row)}>
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => goToTemplate('delete', row)}
                          >
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
    </Page>
  );
};
