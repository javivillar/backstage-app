import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useConsoleConfig } from '../config';
import { useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { appRank, healthColour, syncColour } from './ClusterOverviewPage';
import { Table } from './NetworkPage';

/** Component names of the catalog, to link an Argo CD application to its page when they share the name. */
function useComponentNames() {
  const catalog = useApi(catalogApiRef);
  const [names, setNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter: { kind: 'component' }, fields: ['metadata.name'] }).then(
      r => alive && setNames(new Set(r.items.map(e => e.metadata.name))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return names;
}

/** Cluster layer › Applications: every Argo CD application of this cluster, problems first. */
export const ApplicationsPage = () => {
  const cfg = useConsoleConfig();
  const { loading, data, error, reload } = useClusterOverview();
  const names = useComponentNames();
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [text, setText] = useState('');
  const apps = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (data?.apps ?? [])
      .filter(a => !onlyProblems || appRank(a) < 2)
      .filter(a => !t || a.name.toLowerCase().includes(t) || (a.namespace ?? '').toLowerCase().includes(t))
      .sort((a, b) => appRank(a) - appRank(b) || a.name.localeCompare(b.name));
  }, [data, onlyProblems, text]);
  const problems = (data?.apps ?? []).filter(a => appRank(a) < 2).length;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            Applications of {cfg.cluster.id}
          </Typography>
          <Typography color="text.secondary">Everything Argo CD deploys in this cluster, as it is now.</Typography>
        </Box>
        <Button variant="text" onClick={reload} disabled={loading} sx={{ textTransform: 'none' }}>
          Refresh
        </Button>
      </Box>
      {loading && !data && <Progress />}
      {error && <WarningPanel title="The applications could not be read" message={error} />}
      {data && (
        <Paper variant="outlined" component="section" sx={{ borderRadius: 2, p: 2, display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField size="small" label="Find an application" value={text} onChange={e => setText(e.target.value)} sx={{ minWidth: 240 }} />
            <Button
              variant="text"
              onClick={() => setOnlyProblems(v => !v)}
              aria-pressed={onlyProblems}
              sx={{ textTransform: 'none', border: '1px solid', borderColor: onlyProblems ? 'primary.main' : 'divider' }}
            >
              Only with problems ({problems})
            </Button>
            <Typography variant="body2" color="text.secondary">
              {apps.length} of {data.apps.length}
            </Typography>
          </Box>
          <Table
            head={['Application', 'Health', 'Sync', 'Namespace']}
            rows={apps.map(a => [
              names.has(a.name) ? (
                <Link to={`/console/entity/default/component/${a.name}`} style={{ fontWeight: 600 }}>
                  {a.name}
                </Link>
              ) : (
                <b>{a.name}</b>
              ),
              <Badge label={a.health} {...healthColour(a.health)} />,
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                <Badge label={a.sync} {...syncColour(a.sync)} />
                {a.autosync && <Badge outlined label="auto" />}
              </Box>,
              a.namespace ? <Link to={`/console/namespaces/${a.namespace}`}>{a.namespace}</Link> : '—',
            ])}
          />
        </Paper>
      )}
    </Box>
  );
};
