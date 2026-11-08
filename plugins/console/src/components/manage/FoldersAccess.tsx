import { parseEntityRef } from '@backstage/catalog-model';
import { Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useManageOwners } from '../../manage';
import { useHostOf } from '../ManagePages';

/**
 * Manage › Monitoring › Folders and access (read only): who edits and who sees each folder of Grafana. Every service of
 * the platform and every business application has its folder (Services/<service>, Applications/<application>) and two
 * Keycloak groups, grafana-<name>-editors and grafana-<name>-viewers, that the access job of observability-oneke turns
 * into Grafana teams with Edit and View on it (MONITORING.md). The groups and their members are read from the catalog
 * (the Keycloak groups are Group entities); who is in them is changed in Manage › IAM.
 */

const GROUP = /^grafana-(.+)-(editors|viewers)$/;
type Row = { name: string; kind: 'applications' | 'services'; editors?: string[]; viewers?: string[] };

/** The folders and their groups, from the names of the groups (pure, for the tests). */
export function foldersOf(groups: Array<{ name: string; members: string[] }>, applications: Set<string>): Row[] {
  const rows = new Map<string, Row>();
  for (const g of groups) {
    const m = GROUP.exec(g.name);
    if (!m) continue;
    const row = rows.get(m[1]) ?? { name: m[1], kind: applications.has(m[1]) ? 'applications' : 'services' };
    row[m[2] as 'editors' | 'viewers'] = g.members;
    rows.set(m[1], row);
  }
  return [...rows.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

const Members = ({ group, members }: { group: string; members?: string[] }) => {
  const { lang } = useI18n();
  if (!members) return <Typography variant="body2" color="text.secondary">—</Typography>;
  const shown = members.slice(0, 4).join(', ');
  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      <Box component={Link} to={`/console/entity/default/group/${encodeURIComponent(group)}`} sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>{group}</Box>
      <Typography variant="caption" color="text.secondary">
        {members.length === 0 ? (lang === 'es' ? 'sin miembros' : 'no members') : `${shown}${members.length > 4 ? ` +${members.length - 4}` : ''}`}
      </Typography>
    </Box>
  );
};

export const FoldersAccess = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const catalog = useApi(catalogApiRef);
  const owners = useManageOwners();
  const host = useHostOf();
  const [state, setState] = useState<{ loading: boolean; groups: Array<{ name: string; members: string[] }>; error?: string }>({ loading: true, groups: [] });
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    catalog
      .getEntities({ filter: { kind: 'Group' }, fields: ['metadata.name', 'relations'] })
      .then(r => {
        if (!alive) return;
        const groups = r.items
          .filter(e => GROUP.test(e.metadata.name))
          .map(e => ({ name: e.metadata.name, members: (e.relations ?? []).filter(x => x.type === 'hasMember').map(x => parseEntityRef(x.targetRef).name) }));
        setState({ loading: false, groups });
      })
      .catch(e => alive && setState({ loading: false, groups: [], error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [catalog]);

  const apps = useMemo(() => new Set((owners.data ?? []).filter(o => o.kind === 'application').map(o => o.name)), [owners.data]);
  const rows = useMemo(() => foldersOf(state.groups, apps).filter(r => !q || r.name.includes(q.toLowerCase())), [state.groups, apps, q]);

  if (state.loading || owners.loading) return <Progress />;
  if (state.error) return <WarningPanel title={tx('Could not read the groups of the catalog', 'No se pudieron leer los grupos del catálogo')} message={state.error} />;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="body2" color="text.secondary">
        {tx(
          'Read only. Each folder grants Edit to the members of grafana-<name>-editors and View to those of grafana-<name>-viewers; the org roles of Grafana see nothing (admins see everything). The access job of observability-oneke applies it every 15 minutes. Who is in each group is changed in Manage › IAM.',
          'Solo lectura. Cada carpeta da Edit a los miembros de grafana-<nombre>-editors y View a los de grafana-<nombre>-viewers; los roles de organización de Grafana no ven nada (los administradores lo ven todo). El job de acceso de observability-oneke lo aplica cada 15 minutos. Quién está en cada grupo se cambia en Manage › IAM.',
        )}
      </Typography>
      <TextField size="small" placeholder={tx('Search folders', 'Buscar carpetas')} value={q} onChange={e => setQ(e.target.value)} sx={{ maxWidth: 360 }} />
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th': { textAlign: 'left', fontWeight: 500, color: 'text.secondary', fontSize: 12, p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { p: 1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top' } }}>
          <thead>
            <tr>
              <th>{tx('Folder', 'Carpeta')}</th>
              <th>{tx('Edit', 'Editan')}</th>
              <th>{tx('View', 'Ven')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const uid = `${r.kind === 'applications' ? 'app' : 'svc'}-${r.name}`.slice(0, 40);
              return (
                <tr key={r.name}>
                  <td>
                    <Box component="a" href={`${host('grafana')}/dashboards/f/${encodeURIComponent(uid)}/`} target="_blank" rel="noreferrer" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {r.kind === 'applications' ? 'Applications' : 'Services'}/{r.name}
                    </Box>
                  </td>
                  <td><Members group={`grafana-${r.name}-editors`} members={r.editors} /></td>
                  <td><Members group={`grafana-${r.name}-viewers`} members={r.viewers} /></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3}>{tx('No Grafana groups in the catalog.', 'No hay grupos de Grafana en el catálogo.')}</td>
              </tr>
            )}
          </tbody>
        </Box>
      </Box>
    </Box>
  );
};
