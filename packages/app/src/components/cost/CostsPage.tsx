import { useEffect, useMemo, useState } from 'react';
import { Content, Header, InfoCard, Page, Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { CATALOG_FILTER_EXISTS, catalogApiRef, EntityRefLink } from '@backstage/plugin-catalog-react';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { NAMESPACE_ANNOTATION } from '../catalog/usePrometheus';
import {
  addCounts,
  Allocation,
  ByPriority,
  deploymentsCost,
  describeCounts,
  incidentCount,
  incidentsCost,
  useIncidentCounts,
  describePrices,
  efficiency,
  IDLE,
  money,
  NamespaceDeployments,
  pct,
  perMonth,
  UNALLOCATED,
  useAllocations,
  useDeployments,
  usePricing,
} from './openCost';
import { chargeByAssistant, chargeBySystem, PLATFORM, tokens, useAssistantUsage, userName, useSystemsIndex } from './assistantUsage';

type Row = {
  ns: string;
  entity?: Entity;
  system: string;
  week?: Allocation;
  day?: Allocation;
  deploys?: NamespaceDeployments;
  deployCost?: number;
  incidents?: ByPriority;
  incidentCost?: number;
};

/** a month: the resources at the pace of the last 24 hours, plus the deployments and the incidents of this month */
const monthly = (...parts: (number | undefined)[]) =>
  parts.every(p => p === undefined) ? undefined : parts.reduce<number>((s, p) => s + (p ?? 0), 0);

/**
 * The entity of each namespace (a component first: the service of an application or of the platform), and the
 * namespace of each entity (its reference in lowercase), to charge the incidents of an element to its namespace.
 */
function useEntitiesByNamespace() {
  const catalog = useApi(catalogApiRef);
  const [value, setValue] = useState<{ byNs: Map<string, Entity>; nsOfRef: Map<string, string> }>({
    byNs: new Map(),
    nsOfRef: new Map(),
  });
  useEffect(() => {
    catalog
      .getEntities({
        filter: { [`metadata.annotations.${NAMESPACE_ANNOTATION}`]: CATALOG_FILTER_EXISTS },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'spec.system'],
      })
      .then(({ items }) => {
        const m = new Map<string, Entity>();
        const refs = new Map<string, string>();
        for (const e of items) {
          const ns = e.metadata.annotations?.[NAMESPACE_ANNOTATION];
          if (!ns) continue;
          refs.set(stringifyEntityRef(e).toLocaleLowerCase('en-US'), ns);
          const prev = m.get(ns);
          if (!prev || (prev.kind !== 'Component' && e.kind === 'Component')) m.set(ns, e);
        }
        setValue({ byNs: m, nsOfRef: refs });
      })
      .catch(() => setValue({ byNs: new Map(), nsOfRef: new Map() }));
  }, [catalog]);
  return value;
}

const Figure = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div>
    <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.65 }}>{label}</div>
    <div style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1.25 }}>{value}</div>
    {note && <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{note}</div>}
  </div>
);

/**
 * Page /costs: what each namespace of the cluster costs (OpenCost, through the proxy /opencost), with its entity of the
 * catalog and its system, and the capacity of the nodes nobody reserved. Our prices, not a bill.
 */
export const CostsPage = ({ variant = 'classic' }: { variant?: 'classic' | 'console' }) => {
  const pricing = usePricing();
  const { loading, weekLoading, error, week, day } = useAllocations();
  const deployments = useDeployments();
  const incidents = useIncidentCounts();
  const { byNs, nsOfRef } = useEntitiesByNamespace();
  const usage = useAssistantUsage();
  const systemsIndex = useSystemsIndex();
  const c = pricing.currency;
  // what the assistants consumed this month, charged to the system each question was about
  const assistantCharges = useMemo(
    () => (usage.value ? chargeBySystem(usage.value, systemsIndex, pricing.assistants) : undefined),
    [usage.value, systemsIndex, pricing.assistants],
  );
  const byAssistant = useMemo(() => (usage.value ? chargeByAssistant(usage.value, pricing.assistants) : []), [usage.value, pricing.assistants]);

  // the incidents of each namespace (those of its elements), and those on elements without a namespace (the platform)
  const incidentsByNs = useMemo(() => {
    const m = new Map<string, ByPriority>();
    let elsewhere: ByPriority = {};
    for (const [ref, counts] of incidents.value ?? []) {
      const ns = nsOfRef.get(ref);
      if (ns) m.set(ns, addCounts(m.get(ns) ?? {}, counts));
      else elsewhere = addCounts(elsewhere, counts);
    }
    return { m, elsewhere };
  }, [incidents.value, nsOfRef]);

  const rows: Row[] = useMemo(() => {
    const deploys = deployments.value?.byNamespace;
    const names = new Set([
      ...(week?.keys() ?? []),
      ...(day?.keys() ?? []),
      ...(deploys?.keys() ?? []),
      ...incidentsByNs.m.keys(),
    ]);
    names.delete(IDLE);
    names.delete(UNALLOCATED);
    return [...names]
      .map(ns => {
        const entity = byNs.get(ns);
        const system = (entity?.spec?.system as string | undefined) ?? '';
        const d = deploys?.get(ns);
        const deployCost = deployments.value ? deploymentsCost(d?.count, pricing) : undefined;
        const inc = incidentsByNs.m.get(ns);
        const incidentCost = incidents.value ? incidentsCost(inc, pricing) : undefined;
        return { ns, entity, system, week: week?.get(ns), day: day?.get(ns), deploys: d, deployCost, incidents: inc, incidentCost };
      })
      .sort((a, b) => (b.week?.total ?? 0) - (a.week?.total ?? 0) || (b.day?.total ?? 0) - (a.day?.total ?? 0));
  }, [week, day, byNs, deployments.value, incidents.value, incidentsByNs, pricing]);

  const systems = useMemo(() => {
    type S = { week: number; day: number; deploy: number; incident: number; count: number; assistants?: number; questions?: number };
    const m = new Map<string, S>();
    const none = (): S => ({ week: 0, day: 0, deploy: 0, incident: 0, count: 0 });
    for (const r of rows) {
      const k = r.system || '(no system)';
      const s = m.get(k) ?? none();
      m.set(k, {
        ...s,
        week: s.week + (r.week?.total ?? 0),
        day: s.day + (r.day?.total ?? 0),
        deploy: s.deploy + (r.deployCost ?? 0),
        incident: s.incident + (r.incidentCost ?? 0),
        count: s.count + 1,
      });
    }
    // a system can be asked about before it has a namespace
    for (const [system, charge] of assistantCharges?.bySystem ?? []) {
      const k = system === PLATFORM ? '(no system)' : system;
      const s = m.get(k) ?? none();
      m.set(k, { ...s, assistants: (s.assistants ?? 0) + (charge.cost ?? 0), questions: (s.questions ?? 0) + charge.questions });
    }
    return [...m.entries()].sort((a, b) => b[1].week - a[1].week || (b[1].assistants ?? 0) - (a[1].assistants ?? 0));
  }, [rows, assistantCharges]);

  let body;
  if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="Costs are not available" message={`OpenCost could not be queried: ${error.message}`} />;
  else {
    // the week comes from OpenCost tens of seconds after the day
    const wk = (n?: number) => (weekLoading ? '…' : money(n, c));
    const totalWeek = rows.reduce((s, r) => s + (r.week?.total ?? 0), 0);
    const totalDay = rows.reduce((s, r) => s + (r.day?.total ?? 0), 0);
    const idleWeek = week?.get(IDLE)?.total;
    const deployCount = rows.reduce((s, r) => s + (r.deploys?.count ?? 0), 0);
    const deployTotal = deployments.value ? deploymentsCost(deployCount, pricing) : undefined;
    let deployNote: string;
    if (deployments.loading) deployNote = 'counting…';
    else if (deployments.error) deployNote = 'not counted in this installation';
    else if (pricing.perDeployment === undefined) deployNote = 'no price per deployment configured';
    else deployNote = `${money(deployTotal, c)} at ${money(pricing.perDeployment, c)} each`;
    const allIncidents = [...incidentsByNs.m.values()].reduce(addCounts, incidentsByNs.elsewhere);
    const incidentTotal = incidents.value ? incidentsCost(allIncidents, pricing) : undefined;
    const elsewhere = incidentCount(incidentsByNs.elsewhere);
    let incidentNote: string;
    if (incidents.loading) incidentNote = 'counting…';
    else if (incidents.error) incidentNote = `not available: ${incidents.error.message}`;
    else {
      incidentNote = [
        describeCounts(allIncidents),
        pricing.perIncident ? money(incidentTotal, c) : 'no price per incident configured',
        elsewhere ? `${elsewhere} on elements without a namespace (the platform)` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    const assistantTotal = assistantCharges?.total;
    const assistantCost = assistantTotal?.cost;
    let assistantNote: string;
    if (usage.loading) assistantNote = 'counting…';
    else if (usage.error) assistantNote = `not available: ${usage.error.message}`;
    else if (!assistantTotal?.questions) assistantNote = 'no question this month';
    else {
      assistantNote = [
        `${Math.round(assistantTotal.questions)} questions · ${tokens(assistantTotal.tokens)} tokens`,
        assistantCost === undefined ? 'no price for their models configured' : '',
        assistantTotal.unreported ? `${Math.round(assistantTotal.unreported)} without tokens reported` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    let assistantValue = '—';
    if (assistantTotal) assistantValue = assistantCost !== undefined ? money(assistantCost, c) : `${tokens(assistantTotal.tokens)} tokens`;
    const since = deployments.value?.trackedSince;
    const sinceThisMonth = since && since.slice(0, 7) === deployments.value?.month;
    const perMonthTotal = monthly(totalDay * 30.4, deployTotal, incidentTotal, assistantCost);
    if (variant === 'console') {
      const maxSys = Math.max(1, ...systems.map(([, x]) => x.week || x.day * 7));
      const maxNs = Math.max(1, ...rows.map(r => r.week?.total ?? (r.day?.total ?? 0) * 7));
      const tiles: Array<[string, string, string]> = [
        ['Last 7 days', wk(totalWeek), `${rows.length} namespaces`],
        ['Per month', money(perMonthTotal, c), 'at the pace of the last 24 hours, plus this month'],
        ['Deployments', deployments.value ? String(deployCount) : '—', sinceThisMonth ? `${deployNote}; since ${new Date(since!).toLocaleDateString('es-ES')}` : deployNote],
        ['Incidents', incidents.value ? String(incidentCount(allIncidents)) : '—', incidentNote],
        ['Assistants', assistantValue, assistantNote],
        ['Capacity nobody reserved', wk(idleWeek), 'last 7 days: nodes paid, not requested'],
      ];
      const meter = (v?: number) => {
        if (v === undefined) return <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>;
        let col = '#1E6B34';
        if (v < 30) col = '#B95000';
        else if (v > 95) col = '#B3261E';
        return (
          <Box sx={{ display: 'grid', gap: 0.4, minWidth: 80 }} title={v < 30 ? 'reserves much more than it uses' : undefined}>
            <Box sx={{ height: 5, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${Math.min(100, v)}%`, bgcolor: col }} />
            </Box>
            <Box component="small" sx={{ fontSize: 11.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {pct(v)} of reserved
            </Box>
          </Box>
        );
      };
      const cardSx = { border: 1, borderColor: 'divider', borderRadius: '14px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.5, minWidth: 0 } as const;
      const th = { textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'text.secondary', p: 1, borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
      const td = { p: 1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' } as const;
      const entityPath = (e: Entity) => `/console/entity/${e.metadata.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.metadata.name}`;
      body = (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
            {tiles.map(([label, value, note], i) => (
              <Box key={label} sx={{ ...cardSx, gap: 0.5, alignContent: 'start', ...(i === 1 ? { borderColor: '#0060C0', boxShadow: 'inset 0 0 0 1px #0060C0' } : {}) }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Box sx={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</Box>
                <Typography variant="caption" color="text.secondary">
                  {note}
                </Typography>
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
            <Box component="section" aria-label="By system" sx={cardSx}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 16 }}>
                By system
              </Typography>
              {systems.map(([name, x]) => (
                <Box key={name} sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 30%) minmax(0, 1fr) auto', gap: 1.25, alignItems: 'center', fontSize: 13.5 }}>
                  <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name === '(no system)' ? (
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        no system
                      </Box>
                    ) : (
                      <Box component="a" href={`/console/entity/default/system/${name}`} sx={{ color: '#0060C0', textDecoration: 'none', fontWeight: 500 }}>
                        {name}
                      </Box>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block">
                      {x.count} namespaces{x.questions ? ` · ${Math.round(x.questions)} questions` : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ height: 10, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden', display: 'flex' }}>
                    <Box title={`resources ${wk(x.week)}`} sx={{ width: `${((x.week || x.day * 7) / maxSys) * 100}%`, bgcolor: '#1A8DFF' }} />
                  </Box>
                  <Box sx={{ textAlign: 'right', minWidth: 120 }}>
                    <b>{wk(x.week)}</b>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {money(monthly(x.day * 30.4, deployTotal === undefined ? undefined : x.deploy, incidentTotal === undefined ? undefined : x.incident, assistantCost === undefined ? undefined : x.assistants), c)} / month · {pct(totalWeek ? (x.week / totalWeek) * 100 : undefined)}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            <Box component="section" aria-label="Assistants this month" sx={cardSx}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 16 }}>
                Assistants this month
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {usage.value?.all ? 'Every question, by assistant and who asked it.' : 'By assistant; who asked is shown only for your own questions.'}
              </Typography>
              {usage.error && <Typography variant="body2">Not available: {usage.error.message}</Typography>}
              {byAssistant.map(a => (
                <Box key={`${a.assistant}/${a.user ?? ''}`} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1, borderTop: 1, borderColor: 'divider', pt: 1, fontSize: 13.5 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <b>{a.assistant}</b> <Box component="span" sx={{ color: 'text.secondary' }}>· {userName(a.user)}</Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {Math.round(a.questions)} questions · {tokens(a.tokens)} tokens · {[...a.models].join(', ')}
                    </Typography>
                  </Box>
                  <Box sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(a.cost, c)}</Box>
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="section" aria-label="By namespace" sx={cardSx}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 16 }}>
              By namespace
            </Typography>
            <Typography variant="caption" color="text.secondary">
              A namespace pays what its pods reserve or use, whichever is more: a low &quot;used&quot; means it reserves more than it needs.
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr>
                    <Box component="th" sx={th}>Namespace</Box>
                    <Box component="th" sx={th}>Last 7 days</Box>
                    <Box component="th" sx={th}>Per month</Box>
                    <Box component="th" sx={th}>Deployments</Box>
                    <Box component="th" sx={th}>Incidents</Box>
                    <Box component="th" sx={th}>CPU used</Box>
                    <Box component="th" sx={th}>Memory used</Box>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const a = r.week ?? r.day;
                    return (
                      <tr key={r.ns}>
                        <Box component="td" sx={td}>
                          <Box component="a" href={r.entity ? entityPath(r.entity) : `/console/namespaces/${r.ns}`} sx={{ color: '#0060C0', textDecoration: 'none', fontWeight: 500 }}>
                            {r.entity?.metadata.title ?? r.entity?.metadata.name ?? r.ns}
                          </Box>
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontFamily: 'monospace' }}>
                            {r.ns}
                          </Typography>
                        </Box>
                        <Box component="td" sx={td}>
                          <Box sx={{ display: 'grid', gap: 0.4, minWidth: 110 }}>
                            <span>{wk(r.week?.total)}</span>
                            <Box sx={{ height: 5, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
                              <Box sx={{ height: '100%', width: `${((r.week?.total ?? (r.day?.total ?? 0) * 7) / maxNs) * 100}%`, bgcolor: '#1A8DFF' }} />
                            </Box>
                          </Box>
                        </Box>
                        <Box component="td" sx={td}>{money(monthly(perMonth(r.day), r.deployCost, r.incidentCost), c)}</Box>
                        <Box component="td" sx={td} title={r.deploys?.versions.map(v => v.image).join('\n')}>
                          {deployments.value ? `${r.deploys?.count ?? 0}${r.deployCost ? ` · ${money(r.deployCost, c)}` : ''}` : '—'}
                        </Box>
                        <Box component="td" sx={td} title={describeCounts(r.incidents)}>
                          {incidents.value ? `${incidentCount(r.incidents)}${r.incidentCost ? ` · ${money(r.incidentCost, c)}` : ''}` : '—'}
                        </Box>
                        <Box component="td" sx={td}>{meter(a ? efficiency(a.cpuUsed, a.cpuRequested) : undefined)}</Box>
                        <Box component="td" sx={td}>{meter(a ? efficiency(a.ramUsed, a.ramRequested) : undefined)}</Box>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            </Box>
          </Box>
        </Box>
      );
    } else
    body = (
      <>
        <InfoCard title="The cluster">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 28 }}>
            <Figure label="Last 7 days" value={wk(totalWeek)} note={`${rows.length} namespaces`} />
            <Figure
              label="Per month"
              value={money(monthly(totalDay * 30.4, deployTotal, incidentTotal, assistantCost), c)}
              note={
                deployTotal || incidentTotal || assistantCost
                  ? 'resources at the pace of the last 24 hours + the deployments, incidents and assistants of this month'
                  : 'at the pace of the last 24 hours'
              }
            />
            <Figure
              label="Deployments this month"
              value={deployments.value ? String(deployCount) : '—'}
              note={sinceThisMonth ? `${deployNote}; counted since ${new Date(since!).toLocaleDateString('es-ES')}` : deployNote}
            />
            <Figure
              label="Incidents this month"
              value={incidents.value ? String(incidentCount(allIncidents)) : '—'}
              note={incidentNote}
            />
            <Figure
              label="Assistants this month"
              value={assistantValue}
              note={assistantNote}
            />
            <Figure
              label="Capacity nobody reserved"
              value={wk(idleWeek)}
              note="last 7 days: nodes paid and not requested by any pod"
            />
          </div>
        </InfoCard>
        <div style={{ height: 24 }} />
        <InfoCard title="By system">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>System</TableCell>
                <TableCell align="right">Namespaces</TableCell>
                <TableCell align="right">Last 7 days</TableCell>
                <TableCell align="right" title="what the assistants consumed this month about the system">Assistants this month</TableCell>
                <TableCell align="right">Per month</TableCell>
                <TableCell align="right">Share</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {systems.map(([name, s]) => (
                <TableRow key={name}>
                  <TableCell>{name === '(no system)' ? name : <EntityRefLink entityRef={{ kind: 'System', namespace: 'default', name }} />}</TableCell>
                  <TableCell align="right">{s.count}</TableCell>
                  <TableCell align="right">{wk(s.week)}</TableCell>
                  <TableCell align="right">
                    {s.questions ? `${money(s.assistants, c)} · ${Math.round(s.questions)} q.` : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {money(
                      monthly(
                        s.day * 30.4,
                        deployTotal === undefined ? undefined : s.deploy,
                        incidentTotal === undefined ? undefined : s.incident,
                        assistantCost === undefined ? undefined : s.assistants,
                      ),
                      c,
                    )}
                  </TableCell>
                  <TableCell align="right">{pct(totalWeek ? (s.week / totalWeek) * 100 : undefined)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
        <div style={{ height: 24 }} />
        <InfoCard
          title="Assistants this month"
          subheader={
            usage.value?.all
              ? 'Every question to the assistants, by assistant and who asked it.'
              : 'By assistant; who asked is shown only for your own questions.'
          }
        >
          {usage.error ? (
            <Typography variant="body2">Not available: {usage.error.message}</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Assistant</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>Models</TableCell>
                  <TableCell align="right">Questions</TableCell>
                  <TableCell align="right" title="input + output + cache read and written">Tokens</TableCell>
                  <TableCell align="right">Cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byAssistant.map(a => (
                  <TableRow key={`${a.assistant}/${a.user ?? ''}`}>
                    <TableCell>{a.assistant}</TableCell>
                    <TableCell>{userName(a.user)}</TableCell>
                    <TableCell>{[...a.models].join(', ')}</TableCell>
                    <TableCell align="right">{Math.round(a.questions)}</TableCell>
                    <TableCell align="right" title={a.unreported ? `${a.unreported} questions without tokens reported` : undefined}>
                      {tokens(a.tokens)}
                    </TableCell>
                    <TableCell align="right">{money(a.cost, c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </InfoCard>
        <div style={{ height: 24 }} />
        <InfoCard title="By namespace">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Namespace</TableCell>
                <TableCell>In the catalog</TableCell>
                <TableCell align="right">Last 7 days</TableCell>
                <TableCell align="right" title="new versions of an image this month, and what they cost">Deployments this month</TableCell>
                <TableCell align="right" title="incidents opened this month on its elements, at the price of their priority">Incidents this month</TableCell>
                <TableCell align="right" title="resources at the pace of the last 24 hours + the deployments and incidents of this month">Per month</TableCell>
                <TableCell align="right" title="average cores used of those requested">CPU used</TableCell>
                <TableCell align="right" title="average memory used of that requested">Memory used</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => {
                const a = r.week ?? r.day;
                return (
                  <TableRow key={r.ns}>
                    <TableCell>{r.ns}</TableCell>
                    <TableCell>{r.entity ? <EntityRefLink entityRef={r.entity} /> : '—'}</TableCell>
                    <TableCell align="right">{wk(r.week?.total)}</TableCell>
                    <TableCell align="right" title={r.deploys?.versions.map(v => v.image).join('\n')}>
                      {deployments.value ? `${r.deploys?.count ?? 0}${r.deployCost ? ` · ${money(r.deployCost, c)}` : ''}` : '—'}
                    </TableCell>
                    <TableCell align="right" title={describeCounts(r.incidents)}>
                      {incidents.value ? `${incidentCount(r.incidents)}${r.incidentCost ? ` · ${money(r.incidentCost, c)}` : ''}` : '—'}
                    </TableCell>
                    <TableCell align="right">{money(monthly(perMonth(r.day), r.deployCost, r.incidentCost), c)}</TableCell>
                    <TableCell align="right">{pct(a && efficiency(a.cpuUsed, a.cpuRequested))}</TableCell>
                    <TableCell align="right">{pct(a && efficiency(a.ramUsed, a.ramRequested))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </InfoCard>
      </>
    );
  }

  const explain = `Estimated with our prices, not a bill${pricing.description ? `: ${pricing.description}` : ''}. ${describePrices(pricing)}.`;
  if (variant === 'console')
    return (
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600, fontSize: 28 }}>
            Costs
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: '100ch' }}>
            What each system and namespace of the cluster costs (OpenCost), with its deployments, incidents and questions to the assistants. {explain}
          </Typography>
        </Box>
        {body}
      </Box>
    );
  return (
    <Page themeId="tool">
      <Header title="Costs" subtitle="What each namespace of the cluster costs (OpenCost)" />
      <Content>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Estimated with our prices, not a bill{pricing.description ? `: ${pricing.description}` : ''}. {describePrices(pricing)}. A
          namespace costs what its pods reserve (requests) or use, whichever is more; &quot;CPU used&quot; and &quot;Memory
          used&quot; say how much of what it reserves it really uses: reserved and not used is paid all the same. Each
          deployment, a new version of an image that runs in the namespace, is charged too; restarting or scaling is not a
          deployment. Each incident opened this month on an element of the namespace is charged at the price of its priority. What
          the assistants consume is charged to the system each question was about: the one chosen in their page, else
          the systems, namespaces or projects their tools looked at (split in equal parts), else the platform.
        </Typography>
        {body}
      </Content>
    </Page>
  );
};
