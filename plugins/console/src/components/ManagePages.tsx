import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { useConsoleConfig } from '../config';
import { NAV_ICONS } from '../navIcons';
import { useClusterOverview } from '../overview';
import { useConsolePages } from '../pages';
import { Badge } from './Badge';
import { healthOf } from './EntityDependencies';
import { TONES } from './Flow';
import { rq } from './tokens';

type Row = Record<string, unknown>;
type Column = { key: string; label: string; render?: (r: Row) => ReactNode };
/** a host of the platform from its first label: host('iam') → https://iam.<domain> */
type HostOf = (sub: string) => string;
type Section = {
  label: string;
  plugin: string;
  path: string;
  columns: Column[];
  title: (r: Row) => string;
  facts?: (r: Row) => Array<[string, ReactNode]>;
  /** where the element is seen in its product (a new tab); undefined when it has no page of its own */
  open?: (r: Row, host: HostOf) => string | undefined;
};
/** One platform service of Manage: what it does (label), the product, its Argo CD application and its sections. */
export type ManageService = { id: string; label: string; product: string; app: string; sub: string; sections?: Section[]; home?: (host: HostOf) => string };

const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
const owner = (v: unknown) => String(v ?? '').replace(/^user:default\//, '').replace(/^group:default\//, '') || '—';
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));
const kcUrl = (host: HostOf, what: string) => `${host('iam')}/admin/RefresquitoTime/console/#/RefresquitoTime/${what}`;
const names = (v: unknown) => (Array.isArray(v) ? v.map(x => String((x as { name?: string })?.name ?? '')).filter(Boolean).join(', ') : '');
/** the governance score of a DataHub asset (datahub-backend governance.ts) */
const governed = (v: unknown) => {
  const sc = v as { score?: number; governed?: boolean } | undefined;
  if (!sc || typeof sc.score !== 'number') return '—';
  return <Badge label={`${Math.round(sc.score)} %`} {...TONES[sc.governed ? 'ok' : 'warn']} />;
};
const dataFacts = (r: Row): Array<[string, ReactNode]> => [
  ['Description', String(r.description || '—')],
  ['Domain', String((r.domain as { name?: string } | undefined)?.name ?? '—')],
  ['Owners', names(r.owners) || '—'],
  ['Classification', String(r.classification ?? '—')],
  ['Personal data', r.personalData ? 'yes' : 'no'],
  ['Retention', r.retentionDays ? `${String(r.retentionDays)} days` : '—'],
  ['Terms', names(r.terms) || '—'],
  ['Governed', governed(r.score)],
];
const gb = (b: unknown) => (typeof b === 'number' ? `${(b / 1024 ** 3).toFixed(b > 1024 ** 3 ? 1 : 3)} GB` : '—');

/** The services of Manage, in the order of the menu. Sections only for the ones the console draws itself. */
export const MANAGE_SERVICES: ManageService[] = [
  {
    id: 'keycloak',
    label: 'IAM',
    product: 'Keycloak',
    app: 'iam-oneke',
    sub: 'Users, groups and SSO clients of every application (realm RefresquitoTime).',
    home: host => kcUrl(host, 'users'),
    sections: [
      {
        label: 'Users',
        plugin: 'keycloak-manager',
        path: '/users',
        title: r => String(r.username),
        open: (r, host) => kcUrl(host, r.id ? `users/${enc(r.id)}/settings` : 'users'),
        columns: [
          { key: 'username', label: 'User' },
          { key: 'displayName', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
      },
      { label: 'Groups', plugin: 'keycloak-manager', path: '/groups', title: r => String(r.name), open: (r, host) => kcUrl(host, r.id ? `groups/${enc(r.id)}` : 'groups'), columns: [{ key: 'name', label: 'Group' }, { key: 'owner', label: 'Owner', render: r => (r.owner ? owner(r.owner) : <Badge label="no owner" {...TONES.warn} />) }] },
      {
        label: 'SSO clients',
        plugin: 'keycloak-manager',
        path: '/clients',
        title: r => String(r.clientId),
        open: (r, host) => kcUrl(host, r.id ? `clients/${enc(r.id)}/settings` : 'clients'),
        columns: [
          { key: 'clientId', label: 'Client' },
          { key: 'name', label: 'Name' },
          { key: 'publicClient', label: 'Type', render: r => (r.publicClient ? 'public (PKCE)' : 'confidential') },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
      },
    ],
  },
  {
    id: 'gravitee',
    label: 'API management',
    product: 'Gravitee',
    app: 'gravitee-oneke',
    sub: 'APIs published to the other applications and to partners, their plans and subscriptions.',
    home: host => `${host('gravitee')}/console/`,
    sections: [
      {
        label: 'APIs',
        plugin: 'gravitee-manager',
        path: '/apis',
        title: r => `${String(r.name)} ${String(r.version ?? '')}`.trim(),
        open: (r, host) => (r.id ? `${host('gravitee')}/console/#!/DEFAULT/apis/${enc(r.id)}` : undefined),
        columns: [
          { key: 'name', label: 'API' },
          { key: 'version', label: 'Version' },
          { key: 'contextPath', label: 'Path', render: r => <code>{String(r.contextPath ?? '—')}</code> },
          { key: 'state', label: 'State', render: r => <Badge label={String(r.state ?? '?')} {...TONES[r.state === 'STARTED' ? 'ok' : 'warn']} /> },
          { key: 'team', label: 'Team', render: r => owner(r.team ?? r.owner) },
        ],
        facts: r => [
          ['Description', String(r.description ?? '—')],
          ['Gateway', r.gatewayUrl ? <a href={String(r.gatewayUrl)} target="_blank" rel="noreferrer">{String(r.gatewayUrl)}</a> : '—'],
          ['Backend', <code>{String(r.backendUrl ?? '—')}</code>],
          ['Visibility', String(r.visibility ?? '—')],
          ['Lifecycle', `${String(r.lifecycleState ?? '—')} · ${String(r.deploymentState ?? '—')}`],
          ['Owner', owner(r.owner)],
        ],
      },
    ],
  },
  {
    id: 'datahub',
    label: 'Data management',
    product: 'DataHub',
    app: 'datahub-oneke',
    sub: 'The data assets of the zone, their classification, owners and lineage.',
    home: host => host('datahub'),
    sections: [
      {
        label: 'Datasets',
        plugin: 'datahub-manager',
        path: '/search?type=dataset&count=50',
        title: r => String(r.name),
        open: r => str(r.url),
        columns: [
          { key: 'name', label: 'Dataset' },
          { key: 'platform', label: 'Platform', render: r => String(r.platform ?? '—') },
          { key: 'classification', label: 'Classification', render: r => String(r.classification ?? '—') },
          { key: 'owners', label: 'Owners', render: r => names(r.owners) || '—' },
          { key: 'score', label: 'Governed', render: r => governed(r.score) },
        ],
        facts: dataFacts,
      },
      {
        label: 'Data products',
        plugin: 'datahub-manager',
        path: '/search?type=dataProduct&count=50',
        title: r => String(r.name),
        open: r => str(r.url),
        columns: [
          { key: 'name', label: 'Data product' },
          { key: 'platform', label: 'Platform', render: r => String(r.platform ?? '—') },
          { key: 'classification', label: 'Classification', render: r => String(r.classification ?? '—') },
          { key: 'owners', label: 'Owners', render: r => names(r.owners) || '—' },
          { key: 'score', label: 'Governed', render: r => governed(r.score) },
        ],
        facts: dataFacts,
      },
      {
        label: 'Pipelines',
        plugin: 'datahub-manager',
        path: '/search?type=dataFlow&count=50',
        title: r => String(r.name),
        open: r => str(r.url),
        columns: [
          { key: 'name', label: 'Pipeline' },
          { key: 'platform', label: 'Platform', render: r => String(r.platform ?? '—') },
          { key: 'classification', label: 'Classification', render: r => String(r.classification ?? '—') },
          { key: 'owners', label: 'Owners', render: r => names(r.owners) || '—' },
          { key: 'score', label: 'Governed', render: r => governed(r.score) },
        ],
        facts: dataFacts,
      },
    ],
  },
  {
    id: 'superset',
    label: 'Business intelligence',
    product: 'Superset',
    app: 'superset-oneke',
    sub: 'Dashboards, charts, datasets and the database connections they read.',
    home: host => host('superset'),
    sections: [
      {
        label: 'Dashboards',
        plugin: 'superset-manager',
        path: '/dashboards',
        title: r => String(r.name),
        open: r => str(r.dashboardUrl),
        columns: [
          { key: 'name', label: 'Dashboard', render: r => (r.dashboardUrl ? <a href={String(r.dashboardUrl)} target="_blank" rel="noreferrer">{String(r.name)}</a> : String(r.name)) },
          { key: 'owners', label: 'Owners', render: r => list(r.owners) || '—' },
        ],
      },
      { label: 'Charts', plugin: 'superset-manager', path: '/charts', title: r => String(r.name), open: r => str(r.exploreUrl), columns: [{ key: 'name', label: 'Chart' }, { key: 'vizType', label: 'Type' }, { key: 'owners', label: 'Owners', render: r => list(r.owners) || '—' }] },
      { label: 'Datasets', plugin: 'superset-manager', path: '/datasets', title: r => String(r.name), open: (r, host) => (r.id ? `${host('superset')}/explore/?datasource_type=table&datasource_id=${enc(r.id)}` : undefined), columns: [{ key: 'name', label: 'Dataset' }, { key: 'connection', label: 'Connection' }, { key: 'kind', label: 'Kind' }] },
      { label: 'Connections', plugin: 'superset-manager', path: '/connections', title: r => String(r.name), open: (_, host) => `${host('superset')}/databaseview/list/`, columns: [{ key: 'name', label: 'Connection' }, { key: 'backend', label: 'Database' }, { key: 'owners', label: 'Owners', render: r => list(r.owners) || '—' }] },
    ],
  },
  {
    id: 'camunda',
    label: 'Business process',
    product: 'Camunda',
    app: 'bpm-oneke',
    sub: 'Process definitions, running instances and their human tasks.',
    home: host => `${host('bpm')}/camunda/app/cockpit/`,
    sections: [
      {
        label: 'Process definitions',
        plugin: 'camunda-manager',
        path: '/process-definitions',
        title: r => String(r.name ?? r.key),
        open: r => str(r.cockpitUrl),
        columns: [
          { key: 'name', label: 'Process' },
          { key: 'key', label: 'Key', render: r => <code>{String(r.key)}</code> },
          { key: 'version', label: 'Version' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
        facts: r => [
          ['Key', <code>{String(r.key)}</code>],
          ['Latest version', String(r.version ?? '—')],
          ['Owner', owner(r.owner)],
          ['Cockpit', r.cockpitUrl ? <a href={String(r.cockpitUrl)} target="_blank" rel="noreferrer">Instances, incidents and tasks</a> : '—'],
        ],
      },
    ],
  },
  {
    id: 'seaweedfs',
    label: 'S3 buckets',
    product: 'SeaweedFS',
    app: 'seaweedfs-oneke',
    sub: 'Buckets of the applications, the groups that use them and their access policies.',
    home: host => host('admin-seaweedfs'),
    sections: [
      {
        label: 'Buckets',
        plugin: 'seaweedfs-manager',
        path: '/buckets',
        title: r => String(r.name),
        open: (r, host) => `${host('seaweedfs')}/files?path=${enc(`/buckets/${String(r.name)}`)}`,
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
        open: (_, host) => host('admin-seaweedfs'),
        columns: [
          { key: 'name', label: 'Group' },
          { key: 'memberCount', label: 'Members' },
          { key: 'policyNames', label: 'Policies', render: r => list(r.policyNames) || '—' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
        ],
      },
      { label: 'Policies', plugin: 'seaweedfs-manager', path: '/policies', title: r => String(r.name), open: (_, host) => host('admin-seaweedfs'), columns: [{ key: 'name', label: 'Policy' }] },
    ],
  },
  {
    id: 'alfresco',
    label: 'Document management system',
    product: 'Alfresco',
    app: 'alfrescodms-oneke',
    sub: 'Sites, users and the documents of the applications.',
    home: host => `${host('alfrescodms')}/share/`,
    sections: [
      {
        label: 'Sites',
        plugin: 'alfresco-manager',
        path: '/sites',
        title: r => String(r.title ?? r.id),
        open: (r, host) => (r.id ? `${host('alfrescodms')}/share/page/site/${enc(r.id)}/dashboard` : undefined),
        columns: [
          { key: 'title', label: 'Site' },
          { key: 'id', label: 'Id', render: r => <code>{String(r.id)}</code> },
          { key: 'visibility', label: 'Visibility', render: r => <Badge label={String(r.visibility ?? '?')} {...TONES[r.visibility === 'PUBLIC' ? 'warn' : 'ok']} /> },
          { key: 'role', label: 'My role', render: r => String(r.role ?? '—') },
        ],
        facts: r => [
          ['Id', <code>{String(r.id)}</code>],
          ['Description', String(r.description || '—')],
          ['Visibility', String(r.visibility ?? '—')],
          ['My role', String(r.role ?? '— (admin)')],
        ],
      },
    ],
  },
  {
    id: 'activepieces',
    label: 'Workflow integration',
    product: 'Activepieces',
    app: 'activepieces-oneke',
    sub: 'Projects and the automation flows that connect the applications.',
    home: host => host('activepieces'),
    sections: [
      {
        label: 'Projects',
        plugin: 'activepieces-manager',
        path: '/projects',
        title: r => String(r.displayName ?? r.id),
        open: r => str(r.url),
        columns: [
          { key: 'displayName', label: 'Project' },
          { key: 'owner', label: 'Owner', render: r => owner(r.owner) },
          { key: 'role', label: 'My role', render: r => String(r.role ?? '—') },
          { key: 'created', label: 'Created', render: r => (r.created ? new Date(String(r.created)).toLocaleDateString() : '—') },
        ],
        facts: r => [
          ['Owner', owner(r.owner)],
          ['My role', String(r.role ?? '— (admin)')],
          ['Can', [r.canReadFlows && 'read flows', r.canWriteFlows && 'edit flows', r.canManageMembers && 'manage members'].filter(Boolean).join(', ') || 'nothing'],
          ['Created', r.created ? new Date(String(r.created)).toLocaleString() : '—'],
          ['Flows', r.url ? <a href={String(r.url)} target="_blank" rel="noreferrer">Open the project in Activepieces</a> : '—'],
        ],
      },
    ],
  },
];

/** The hosts of the platform: the domain is the one of the classic Backstage (backstage.<domain>), else this page's. */
function useHostOf(): HostOf {
  const cfg = useConsoleConfig();
  let base: URL;
  try {
    base = new URL(cfg.classicBaseUrl || window.location.origin);
  } catch {
    base = new URL(window.location.origin);
  }
  const domain = base.hostname.split('.').slice(1).join('.');
  return sub => `${base.protocol}//${sub}.${domain}`;
}

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
const SectionView = ({ section, product }: { section: Section; product: string }) => {
  const st = useManagerList(section.plugin, section.path);
  const host = useHostOf();
  const urlOf = (r: Row) => section.open?.(r, host);
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
                {section.open && <th aria-label={`Open in ${product}`} />}
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
                  {section.open && (
                    <td style={{ width: 36 }}>
                      {urlOf(r) && (
                        <Box
                          component="a"
                          href={urlOf(r)}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${section.title(r)} in ${product}`}
                          aria-label={`Open ${section.title(r)} in ${product}`}
                          onClick={e => e.stopPropagation()}
                          sx={{ display: 'inline-grid', placeItems: 'center', color: rq.primary }}
                        >
                          <OpenInNew fontSize="small" />
                        </Box>
                      )}
                    </td>
                  )}
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
          {urlOf(picked) && (
            <Box>
              <Button size="small" variant="contained" disableElevation href={urlOf(picked)!} target="_blank" rel="noreferrer" endIcon={<OpenInNew fontSize="small" />} sx={{ textTransform: 'none' }}>
                Open in {product}
              </Button>
            </Box>
          )}
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
  const host = useHostOf();
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
          {s.home && (
            <Button href={s.home(host)} target="_blank" rel="noreferrer" variant="outlined" endIcon={<OpenInNew fontSize="small" />} sx={{ textTransform: 'none' }}>
              Open {s.product}
            </Button>
          )}
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
          <SectionView key={sections[tab].path} section={sections[tab]} product={s.product} />
        </>
      ) : (
        <Box>{classic ? classic.element : <Typography color="text.secondary">This portal does not include its manager.</Typography>}</Box>
      )}
    </Box>
  );
};
