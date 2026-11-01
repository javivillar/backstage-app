import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { NAV_ICONS } from '../navIcons';
import { useClusterOverview } from '../overview';
import { useConsolePages } from '../pages';
import { Badge } from './Badge';
import { healthOf } from './EntityDependencies';
import { TONES } from './Flow';
import { rq } from './tokens';

type Row = Record<string, unknown>;
type Column = { key: string; label: string; render?: (r: Row) => ReactNode };
type Section = { label: string; plugin: string; path: string; columns: Column[]; title: (r: Row) => string; facts?: (r: Row) => Array<[string, ReactNode]> };
/** One platform service of Manage: what it does (label), the product, its Argo CD application and its sections. */
export type ManageService = { id: string; label: string; product: string; app: string; sub: string; sections?: Section[] };

const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
const owner = (v: unknown) => String(v ?? '').replace(/^user:default\//, '').replace(/^group:default\//, '') || '—';
const gb = (b: unknown) => (typeof b === 'number' ? `${(b / 1024 ** 3).toFixed(b > 1024 ** 3 ? 1 : 3)} GB` : '—');

/** The services of Manage, in the order of the menu. Sections only for the ones the console draws itself. */
export const MANAGE_SERVICES: ManageService[] = [
  {
    id: 'keycloak',
    label: 'IAM',
    product: 'Keycloak',
    app: 'iam-oneke',
    sub: 'Users, groups and SSO clients of every application (realm RefresquitoTime).',
    sections: [
      {
        label: 'Users',
        plugin: 'keycloak-manager',
        path: '/users',
        title: r => String(r.username),
        columns: [
          { key: 'username', label: 'User' },
          { key: 'displayName', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
      },
      { label: 'Groups', plugin: 'keycloak-manager', path: '/groups', title: r => String(r.name), columns: [{ key: 'name', label: 'Group' }, { key: 'owner', label: 'Owner', render: r => (r.owner ? owner(r.owner) : <Badge label="no owner" {...TONES.warn} />) }] },
      {
        label: 'SSO clients',
        plugin: 'keycloak-manager',
        path: '/clients',
        title: r => String(r.clientId),
        columns: [
          { key: 'clientId', label: 'Client' },
          { key: 'name', label: 'Name' },
          { key: 'publicClient', label: 'Type', render: r => (r.publicClient ? 'public (PKCE)' : 'confidential') },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
      },
    ],
  },
  { id: 'gravitee', label: 'API management', product: 'Gravitee', app: 'gravitee-oneke', sub: 'APIs published to the other applications and to partners, their plans and subscriptions.' },
  { id: 'datahub', label: 'Data management', product: 'DataHub', app: 'datahub-oneke', sub: 'The data assets of the zone, their classification, owners and lineage.' },
  {
    id: 'superset',
    label: 'Business intelligence',
    product: 'Superset',
    app: 'superset-oneke',
    sub: 'Dashboards, charts, datasets and the database connections they read.',
    sections: [
      {
        label: 'Dashboards',
        plugin: 'superset-manager',
        path: '/dashboards',
        title: r => String(r.name),
        columns: [
          { key: 'name', label: 'Dashboard', render: r => (r.dashboardUrl ? <a href={String(r.dashboardUrl)} target="_blank" rel="noreferrer">{String(r.name)}</a> : String(r.name)) },
          { key: 'owners', label: 'Owners', render: r => list(r.owners) || '—' },
        ],
      },
      { label: 'Charts', plugin: 'superset-manager', path: '/charts', title: r => String(r.name), columns: [{ key: 'name', label: 'Chart' }, { key: 'vizType', label: 'Type' }, { key: 'owners', label: 'Owners', render: r => list(r.owners) || '—' }] },
      { label: 'Datasets', plugin: 'superset-manager', path: '/datasets', title: r => String(r.name), columns: [{ key: 'name', label: 'Dataset' }, { key: 'connection', label: 'Connection' }, { key: 'kind', label: 'Kind' }] },
      { label: 'Connections', plugin: 'superset-manager', path: '/connections', title: r => String(r.name), columns: [{ key: 'name', label: 'Connection' }, { key: 'backend', label: 'Database' }, { key: 'owners', label: 'Owners', render: r => list(r.owners) || '—' }] },
    ],
  },
  { id: 'camunda', label: 'Business process', product: 'Camunda', app: 'bpm-oneke', sub: 'Process definitions, running instances and their human tasks.' },
  {
    id: 'seaweedfs',
    label: 'S3 buckets',
    product: 'SeaweedFS',
    app: 'seaweedfs-oneke',
    sub: 'Buckets of the applications, the groups that use them and their access policies.',
    sections: [
      {
        label: 'Buckets',
        plugin: 'seaweedfs-manager',
        path: '/buckets',
        title: r => String(r.name),
        columns: [
          { key: 'name', label: 'Bucket' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
          { key: 'size', label: 'Size', render: r => gb(r.size) },
          { key: 'versioningStatus', label: 'Versioning', render: r => String(r.versioningStatus || 'off') },
        ],
      },
      {
        label: 'Groups',
        plugin: 'seaweedfs-manager',
        path: '/groups',
        title: r => String(r.name),
        columns: [
          { key: 'name', label: 'Group' },
          { key: 'memberCount', label: 'Members' },
          { key: 'policyNames', label: 'Policies', render: r => list(r.policyNames) || '—' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
      },
      { label: 'Policies', plugin: 'seaweedfs-manager', path: '/policies', title: r => String(r.name), columns: [{ key: 'name', label: 'Policy' }] },
    ],
  },
  { id: 'alfresco', label: 'Document management system', product: 'Alfresco', app: 'alfrescodms-oneke', sub: 'Sites, users and the documents of the applications.' },
  { id: 'activepieces', label: 'Workflow integration', product: 'Activepieces', app: 'activepieces-oneke', sub: 'Projects and the automation flows that connect the applications.' },
];

/** GET a manager backend: { items }. */
function useManagerList(plugin?: string, path?: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; items?: Row[]; error?: string }>({ loading: !!plugin });
  useEffect(() => {
    if (!plugin || !path) return undefined;
    let alive = true;
    setState({ loading: true });
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl(plugin)}${path}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`);
      return (body.items ?? (Array.isArray(body) ? body : [])) as Row[];
    })().then(
      items => alive && setState({ loading: false, items }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, plugin, path]);
  return state;
}

const ServiceIcon = ({ id, size = 22 }: { id: string; size?: number }) => {
  const Icon = NAV_ICONS[`/console/${id}`];
  return (
    <Box component="span" aria-hidden sx={{ width: size + 14, height: size + 14, borderRadius: '9px', display: 'inline-grid', placeItems: 'center', bgcolor: 'rgba(26,141,255,0.10)', color: rq.blue, flexShrink: 0 }}>
      {Icon && <Icon sx={{ fontSize: size }} />}
    </Box>
  );
};

/** One tile of the hub: the first section counts, the state of its Argo CD application. */
const Tile = ({ s }: { s: ManageService }) => {
  const first = s.sections?.[0];
  const counts = useManagerList(first?.plugin, first?.path);
  const ov = useClusterOverview();
  const h = healthOf(s.app.replace(/-oneke$/, ''), ov.data?.apps ?? []);
  return (
    <Box
      component={Link}
      to={`/console/manage/${s.id}`}
      sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1, color: 'text.primary', textDecoration: 'none', '&:hover': { borderColor: rq.blue } }}
    >
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
        <ServiceIcon id={s.id} />
        <Box>
          <Typography sx={{ fontWeight: 600 }}>{s.label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {s.product}
          </Typography>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {s.sub}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge label={h.tone === 'off' ? 'state unknown' : h.label} {...TONES[h.tone]} />
        {first && counts.items && (
          <Typography variant="body2">
            <b>{counts.items.length}</b> {first.label.toLowerCase()}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

/** Portal › Manage: every platform service of the cluster, by what it does. */
export const ManageHubPage = () => (
  <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1240 }}>
    <Box>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
        Manage
      </Typography>
      <Typography color="text.secondary">Every platform service of this cluster, what it holds and its state. Open one to manage it.</Typography>
    </Box>
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
      {MANAGE_SERVICES.map(s => (
        <Tile key={s.id} s={s} />
      ))}
    </Box>
  </Box>
);

/** The table of one section with a search box, and the detail of the selected row beside it. */
const SectionView = ({ section }: { section: Section }) => {
  const st = useManagerList(section.plugin, section.path);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const rows = useMemo(() => (st.items ?? []).filter(r => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())), [st.items, q]);
  const picked = rows[Math.min(sel, rows.length - 1)];
  if (st.loading) return <Progress />;
  if (st.error) return <WarningPanel title={`${section.label} could not be read`} message={st.error} />;
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 320px' }, alignItems: 'start' }}>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.5, bgcolor: 'background.paper', display: 'grid', gap: 1, minWidth: 0 }}>
        <TextField size="small" placeholder={`Search ${section.label.toLowerCase()}`} value={q} onChange={e => { setQ(e.target.value); setSel(0); }} inputProps={{ 'aria-label': `Search ${section.label}` }} />
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th': { textAlign: 'left', fontWeight: 500, color: 'text.secondary', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { p: 1, borderBottom: 1, borderColor: 'divider' } }}>
            <thead>
              <tr>
                {section.columns.map(c => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Box
                  component="tr"
                  key={i}
                  tabIndex={0}
                  onClick={() => setSel(i)}
                  onKeyDown={e => e.key === 'Enter' && setSel(i)}
                  sx={{ cursor: 'pointer', bgcolor: r === picked ? 'rgba(26,141,255,0.10)' : undefined, '&:hover td': { bgcolor: 'action.hover' } }}
                >
                  {section.columns.map(c => (
                    <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>
                  ))}
                </Box>
              ))}
            </tbody>
          </Box>
        </Box>
        {rows.length === 0 && <Typography color="text.secondary">Nothing{q ? ' matches' : ''}.</Typography>}
      </Box>
      {picked && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1, position: { lg: 'sticky' }, top: 12 }}>
          <Typography sx={{ fontWeight: 600 }}>{section.title(picked)}</Typography>
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 12px', m: 0, fontSize: 14 }}>
            {(section.facts?.(picked) ?? section.columns.map(c => [c.label, c.render ? c.render(picked) : String(picked[c.key] ?? '—')] as [string, ReactNode])).map(([k, v]) => (
              <Fragment key={k}>
                <Box component="dt" sx={{ color: 'text.secondary' }}>
                  {k}
                </Box>
                <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
                  {v}
                </Box>
              </Fragment>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

/** Portal › Manage › a service: the shared layout; its own sections, or its classic page inside the frame. */
export const ManageServicePage = () => {
  const { id = '' } = useParams();
  const pages = useConsolePages();
  const s = MANAGE_SERVICES.find(x => x.id === id);
  const classic = pages.find(p => p.id === id);
  const [tab, setTab] = useState(0);
  const ov = useClusterOverview();
  if (!s) return <WarningPanel title="Not found" message={`There is no service ${id} in Manage.`} />;
  const h = healthOf(s.app.replace(/-oneke$/, ''), ov.data?.apps ?? []);
  const sections = s.sections ?? [];
  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 1340 }}>
      <Box>
        <Link to="/console/manage">← Manage</Link>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <ServiceIcon id={s.id} size={26} />
          <Box>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 600, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {s.label} <Badge label={s.product} outlined />
            </Typography>
            <Typography color="text.secondary">{s.sub}</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge label={h.tone === 'off' ? 'state unknown' : h.label} {...TONES[h.tone]} />
          {classic && sections.length > 0 && (
            <Button component={Link} to={`/console/${classic.id}`} variant="outlined" sx={{ textTransform: 'none' }}>
              Create and change (full manager)
            </Button>
          )}
        </Box>
      </Box>
      {sections.length > 0 ? (
        <>
          <Box role="tablist" aria-label={`Sections of ${s.label}`} sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
            {sections.map((sec, i) => (
              <Button
                key={sec.label}
                role="tab"
                aria-selected={tab === i}
                onClick={() => setTab(i)}
                sx={{ textTransform: 'none', borderRadius: 0, color: tab === i ? 'text.primary' : 'text.secondary', borderBottom: 2, borderColor: tab === i ? rq.blue : 'transparent', mb: '-1px' }}
              >
                {sec.label}
              </Button>
            ))}
          </Box>
          <SectionView key={sections[tab].path} section={sections[tab]} />
        </>
      ) : (
        <Box>{classic ? classic.element : <Typography color="text.secondary">This portal does not include its manager.</Typography>}</Box>
      )}
    </Box>
  );
};
