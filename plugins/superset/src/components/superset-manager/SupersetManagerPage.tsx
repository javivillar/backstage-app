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
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

type Kind = 'connections' | 'datasets' | 'charts' | 'dashboards';

interface Row {
  id: number;
  name: string;
  backend?: string;
  connection?: string;
  kind?: string;
  vizType?: string;
  owners: string[];
  exploreUrl?: string;
  dashboardUrl?: string;
}

// Connections/datasets are fully editable from Backstage (create/update
// scaffolder templates); charts/dashboards are provision-only — Superset's
// own visual editor is where the real work happens for those two, see
// superset-actions.ts.
const KIND_CONFIG: Record<
  Kind,
  { label: string; templateNoun: string; editable: boolean }
> = {
  connections: { label: 'Connections', templateNoun: 'connection', editable: true },
  datasets: { label: 'Datasets', templateNoun: 'dataset', editable: true },
  charts: { label: 'Charts', templateNoun: 'chart', editable: false },
  dashboards: { label: 'Dashboards', templateNoun: 'dashboard', editable: false },
};

export const SupersetManagerPage = () => {
  const [tab, setTab] = useState<Kind>('connections');
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
        const baseUrl = await discoveryApi.getBaseUrl('superset-manager');
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

  const { label, templateNoun, editable } = KIND_CONFIG[tab];

  const goToCreate = () => {
    navigate(`/create/templates/default/superset-${tab === 'connections' || tab === 'datasets' ? 'create' : 'provision'}-${templateNoun}`);
  };

  const goToUpdate = (row: Row) => {
    const field = tab === 'connections' ? 'currentDatabaseName' : 'currentTableName';
    const formData = { [field]: row.name };
    navigate(
      `/create/templates/default/superset-update-${templateNoun}?formData=${encodeURIComponent(
        JSON.stringify(formData),
      )}`,
    );
  };

  const remove = async (row: Row) => {
    const baseUrl = await discoveryApi.getBaseUrl('superset-manager');
    const res = await fetchApi.fetch(`${baseUrl}/${tab}/${row.id}`, { method: 'DELETE' });
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
        title="Superset Manager"
        subtitle="Browse and manage the Superset resources you've created"
      />
      <Content>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs value={tab} onChange={(_e, v: Kind) => setTab(v)}>
            <Tab label="Connections" value="connections" />
            <Tab label="Datasets" value="datasets" />
            <Tab label="Charts" value="charts" />
            <Tab label="Dashboards" value="dashboards" />
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
                      <TableCell>Name</TableCell>
                      {tab === 'connections' && <TableCell>Backend</TableCell>}
                      {tab === 'datasets' && <TableCell>Connection</TableCell>}
                      {tab === 'datasets' && <TableCell>Kind</TableCell>}
                      {tab === 'charts' && <TableCell>Viz type</TableCell>}
                      {isAdmin && <TableCell>Owner(s)</TableCell>}
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>{row.name}</TableCell>
                        {tab === 'connections' && <TableCell>{row.backend}</TableCell>}
                        {tab === 'datasets' && <TableCell>{row.connection}</TableCell>}
                        {tab === 'datasets' && <TableCell>{row.kind}</TableCell>}
                        {tab === 'charts' && <TableCell>{row.vizType}</TableCell>}
                        {isAdmin && (
                          <TableCell>
                            {row.owners.map(o => (
                              <Chip key={o} size="small" label={o} sx={{ mr: 0.5 }} />
                            ))}
                          </TableCell>
                        )}
                        <TableCell align="right">
                          {editable ? (
                            <>
                              <Button size="small" onClick={() => goToUpdate(row)}>
                                Edit
                              </Button>
                              <Button size="small" color="error" onClick={() => remove(row)}>
                                Delete
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="small"
                              endIcon={<OpenInNewIcon fontSize="small" />}
                              href={row.exploreUrl ?? row.dashboardUrl}
                              target="_blank"
                              rel="noopener"
                            >
                              Open in Superset
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
    </Page>
  );
};
