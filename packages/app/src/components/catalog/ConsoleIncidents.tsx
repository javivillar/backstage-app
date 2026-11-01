import { stringifyEntityRef } from '@backstage/catalog-model';
import { Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { keycloakOIDCAuthApiRef } from '@internal/plugin-keycloak';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { fetchChanges, fetchIncidents, SUPPORT_APPLICATION, type SupportChange, type SupportIncident, supportLinks, supportUrl } from './EntitySupportContent';

const TONE = { ok: { bg: '#E3F4E8', fg: '#1E6B34' }, warn: { bg: '#FFF0DD', fg: '#8A4300' }, bad: { bg: '#FDECEA', fg: '#B3261E' }, info: { bg: '#E5F0FC', fg: '#0B5CAD' }, off: { bg: '#EEF1F4', fg: '#5A6878' } };
const STATES: Record<string, string> = { open: 'Open', in_progress: 'In progress', waiting: 'Waiting', resolved: 'Resolved', closed: 'Closed', requested: 'Requested', approved: 'Approved', in_execution: 'In execution' };
const priorityTone = (p: string): keyof typeof TONE => {
  const n = Number(String(p).replace(/\D/g, ''));
  if (n && n <= 2) return 'bad';
  if (n === 3) return 'warn';
  return 'off';
};
const Pill = ({ label, tone }: { label: string; tone: keyof typeof TONE }) => (
  <Box component="span" sx={{ display: 'inline-block', px: 1, py: 0.1, borderRadius: 999, fontSize: 12, fontWeight: 500, bgcolor: TONE[tone].bg, color: TONE[tone].fg, whiteSpace: 'nowrap' }}>
    {label}
  </Box>
);
const Card = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.25, minWidth: 0 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
        {title}
      </Typography>
      {action}
    </Box>
    {children}
  </Box>
);
const tableSx = { width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th': { textAlign: 'left', fontWeight: 500, color: 'text.secondary', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { p: 1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top' } } as const;

/**
 * The Incidents tab inside the console: the incidents not closed of the element and the changes planned on it, from the
 * support (found in the catalog), read with the Keycloak token of the person; open one, ask for a change.
 */
export const ConsoleIncidents = () => {
  const { entity } = useEntity();
  const catalog = useApi(catalogApiRef);
  const keycloak = useApi(keycloakOIDCAuthApiRef);
  const ref = stringifyEntityRef(entity);
  const [base, setBase] = useState<string | null | undefined>();
  const [data, setData] = useState<{ loading: boolean; incidents?: SupportIncident[]; total?: number; changes?: SupportChange[]; error?: string }>({ loading: true });
  const [sel, setSel] = useState(0);
  useEffect(() => {
    let alive = true;
    catalog
      .getEntities({ filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': SUPPORT_APPLICATION }, fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'] })
      .then(({ items }) => alive && setBase(supportUrl(items)))
      .catch(() => alive && setBase(null));
    return () => {
      alive = false;
    };
  }, [catalog]);
  useEffect(() => {
    if (!base) return undefined;
    let alive = true;
    keycloak
      .getAccessToken(undefined, { optional: true })
      .then(async token => {
        if (!token) throw new Error('Sign in to Backstage with Keycloak to see them here.');
        const [page, changes] = await Promise.all([fetchIncidents(base, ref, token), fetchChanges(base, ref, token).catch(() => [] as SupportChange[])]);
        return { incidents: page.items, total: page.total, changes };
      })
      .then(
        d => alive && setData({ loading: false, ...d }),
        (e: Error) => alive && setData({ loading: false, error: e instanceof TypeError ? 'The support could not be reached (down, or it does not accept this portal: CORS).' : e.message }),
      );
    return () => {
      alive = false;
    };
  }, [base, keycloak, ref]);

  if (base === undefined) return <Progress />;
  if (base === null) return <WarningPanel severity="info" title="No support" message="The support (application support) is not deployed: the catalog says nowhere where it is." />;
  const links = supportLinks(base, entity);
  const incidents = data.incidents ?? [];
  const picked = incidents[Math.min(sel, incidents.length - 1)];
  const high = incidents.filter(i => priorityTone(i.priority) === 'bad').length;
  const kpi = (label: string, value: string, sub: string, tone?: keyof typeof TONE) => (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.5, bgcolor: 'background.paper' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 600, color: tone ? TONE[tone].fg : undefined }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    </Box>
  );
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button variant="contained" href={links.open} target="_blank" rel="noreferrer" sx={{ textTransform: 'none' }}>
          Open an incident
        </Button>
        <Button variant="outlined" href={links.change} target="_blank" rel="noreferrer" sx={{ textTransform: 'none' }}>
          Ask for a change
        </Button>
        <Button href={links.incidents} target="_blank" rel="noreferrer" sx={{ textTransform: 'none' }}>
          Open in the support
        </Button>
      </Box>
      {data.loading && <Progress />}
      {data.error && <WarningPanel severity="warning" title="The support did not answer" message={data.error} />}
      {!data.loading && !data.error && (
        <>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
            {kpi('Open', String(data.total ?? incidents.length), high ? `${high} of priority 1 or 2` : 'none urgent', incidents.length ? 'bad' : 'ok')}
            {kpi('Planned changes', String(data.changes?.length ?? 0), data.changes?.[0] ? `next ${new Date(data.changes[0].planned_on).toLocaleDateString()}` : 'none planned')}
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.3fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
            <Card title="Incidents not closed">
              {incidents.length === 0 ? (
                <Typography color="text.secondary">No incident open on it.</Typography>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Box component="table" sx={tableSx}>
                    <thead>
                      <tr>
                        <th>Id</th>
                        <th>Title</th>
                        <th>Priority</th>
                        <th>State</th>
                        <th>Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((x, i) => (
                        <Box component="tr" key={x.id} tabIndex={0} onClick={() => setSel(i)} onKeyDown={e => e.key === 'Enter' && setSel(i)} sx={{ cursor: 'pointer', bgcolor: x === picked ? 'rgba(26,141,255,0.10)' : undefined }}>
                          <td>#{x.id}</td>
                          <td>{x.title}</td>
                          <td>
                            <Pill label={x.priority} tone={priorityTone(x.priority)} />
                          </td>
                          <td>{STATES[x.state] ?? x.state}</td>
                          <td>{new Date(x.opened_at).toLocaleString()}</td>
                        </Box>
                      ))}
                    </tbody>
                  </Box>
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">
                With your Keycloak sign-in: a requester sees their own incidents, the support team all of them.
              </Typography>
            </Card>
            {picked && (
              <Card title={`#${picked.id} · ${picked.title}`} action={<Pill label={`priority ${picked.priority}`} tone={priorityTone(picked.priority)} />}>
                <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 14px', m: 0, fontSize: 14 }}>
                  <Box component="dt" sx={{ color: 'text.secondary' }}>
                    State
                  </Box>
                  <Box component="dd" sx={{ m: 0 }}>
                    {STATES[picked.state] ?? picked.state}
                  </Box>
                  <Box component="dt" sx={{ color: 'text.secondary' }}>
                    Opened by
                  </Box>
                  <Box component="dd" sx={{ m: 0 }}>
                    {picked.requester_name ?? picked.requester} · {new Date(picked.opened_at).toLocaleString()}
                  </Box>
                  <Box component="dt" sx={{ color: 'text.secondary' }}>
                    Assigned to
                  </Box>
                  <Box component="dd" sx={{ m: 0 }}>
                    {picked.assignee ?? 'nobody yet'}
                  </Box>
                </Box>
                <Box>
                  <Button variant="outlined" size="small" href={`${base}/incidents/${picked.id}`} target="_blank" rel="noreferrer" sx={{ textTransform: 'none' }}>
                    Open #{picked.id} in the support
                  </Button>
                </Box>
              </Card>
            )}
          </Box>
          <Card title="Planned changes">
            {(data.changes ?? []).length === 0 ? (
              <Typography color="text.secondary">No change planned on it.</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Box component="table" sx={tableSx}>
                  <thead>
                    <tr>
                      <th>Id</th>
                      <th>What</th>
                      <th>Risk</th>
                      <th>State</th>
                      <th>When</th>
                      <th>Asked by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.changes ?? []).map(c => (
                      <tr key={c.id}>
                        <td>#{c.id}</td>
                        <td>
                          {c.what} {c.urgent && <Pill label="urgent" tone="bad" />}
                        </td>
                        <td>
                          <Pill label={c.risk} tone={{ low: 'ok', medium: 'warn', high: 'bad' }[c.risk] as keyof typeof TONE ?? 'off'} />
                        </td>
                        <td>{STATES[c.state] ?? c.state}</td>
                        <td>{new Date(c.planned_on).toLocaleString()}</td>
                        <td>{c.requester_name ?? c.requester}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )}
          </Card>
        </>
      )}
    </Box>
  );
};
