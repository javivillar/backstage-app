import { useEffect, useMemo, useState } from 'react';
import { Content, Header, InfoCard, Page, Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { CATALOG_FILTER_EXISTS, catalogApiRef, EntityRefLink } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { NAMESPACE_ANNOTATION } from '../catalog/usePrometheus';
import {
  Allocation,
  deploymentsCost,
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

type Row = { ns: string; entity?: Entity; system: string; week?: Allocation; day?: Allocation; deploys?: NamespaceDeployments; deployCost?: number };

/** a month: the resources at the pace of the last 24 hours, plus the deployments of this month */
const monthly = (resources: number | undefined, deploys: number | undefined) =>
  resources === undefined && deploys === undefined ? undefined : (resources ?? 0) + (deploys ?? 0);

/** the entity of each namespace: a component first (the service of an application or of the platform) */
function useEntitiesByNamespace() {
  const catalog = useApi(catalogApiRef);
  const [byNs, setByNs] = useState<Map<string, Entity>>(new Map());
  useEffect(() => {
    catalog
      .getEntities({
        filter: { [`metadata.annotations.${NAMESPACE_ANNOTATION}`]: CATALOG_FILTER_EXISTS },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'spec.system'],
      })
      .then(({ items }) => {
        const m = new Map<string, Entity>();
        for (const e of items) {
          const ns = e.metadata.annotations?.[NAMESPACE_ANNOTATION];
          if (!ns) continue;
          const prev = m.get(ns);
          if (!prev || (prev.kind !== 'Component' && e.kind === 'Component')) m.set(ns, e);
        }
        setByNs(m);
      })
      .catch(() => setByNs(new Map()));
  }, [catalog]);
  return byNs;
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
export const CostsPage = () => {
  const pricing = usePricing();
  const { loading, error, week, day } = useAllocations();
  const deployments = useDeployments();
  const byNs = useEntitiesByNamespace();
  const c = pricing.currency;

  const rows: Row[] = useMemo(() => {
    const deploys = deployments.value?.byNamespace;
    const names = new Set([...(week?.keys() ?? []), ...(day?.keys() ?? []), ...(deploys?.keys() ?? [])]);
    names.delete(IDLE);
    names.delete(UNALLOCATED);
    return [...names]
      .map(ns => {
        const entity = byNs.get(ns);
        const system = (entity?.spec?.system as string | undefined) ?? '';
        const d = deploys?.get(ns);
        const deployCost = deployments.value ? deploymentsCost(d?.count, pricing) : undefined;
        return { ns, entity, system, week: week?.get(ns), day: day?.get(ns), deploys: d, deployCost };
      })
      .sort((a, b) => (b.week?.total ?? 0) - (a.week?.total ?? 0));
  }, [week, day, byNs, deployments.value, pricing]);

  const systems = useMemo(() => {
    const m = new Map<string, { week: number; day: number; deploy: number; count: number }>();
    for (const r of rows) {
      const k = r.system || '(no system)';
      const s = m.get(k) ?? { week: 0, day: 0, deploy: 0, count: 0 };
      m.set(k, {
        week: s.week + (r.week?.total ?? 0),
        day: s.day + (r.day?.total ?? 0),
        deploy: s.deploy + (r.deployCost ?? 0),
        count: s.count + 1,
      });
    }
    return [...m.entries()].sort((a, b) => b[1].week - a[1].week);
  }, [rows]);

  let body;
  if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="Costs are not available" message={`OpenCost could not be queried: ${error.message}`} />;
  else {
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
    const since = deployments.value?.trackedSince;
    const sinceThisMonth = since && since.slice(0, 7) === deployments.value?.month;
    body = (
      <>
        <InfoCard title="The cluster">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 28 }}>
            <Figure label="Last 7 days" value={money(totalWeek, c)} note={`${rows.length} namespaces`} />
            <Figure
              label="Per month"
              value={money(monthly(totalDay * 30.4, deployTotal), c)}
              note={deployTotal ? 'resources at the pace of the last 24 hours + the deployments of this month' : 'at the pace of the last 24 hours'}
            />
            <Figure
              label="Deployments this month"
              value={deployments.value ? String(deployCount) : '—'}
              note={sinceThisMonth ? `${deployNote}; counted since ${new Date(since!).toLocaleDateString('es-ES')}` : deployNote}
            />
            <Figure
              label="Capacity nobody reserved"
              value={money(idleWeek, c)}
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
                <TableCell align="right">Per month</TableCell>
                <TableCell align="right">Share</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {systems.map(([name, s]) => (
                <TableRow key={name}>
                  <TableCell>{name === '(no system)' ? name : <EntityRefLink entityRef={{ kind: 'System', namespace: 'default', name }} />}</TableCell>
                  <TableCell align="right">{s.count}</TableCell>
                  <TableCell align="right">{money(s.week, c)}</TableCell>
                  <TableCell align="right">{money(monthly(s.day * 30.4, deployTotal === undefined ? undefined : s.deploy), c)}</TableCell>
                  <TableCell align="right">{pct(totalWeek ? (s.week / totalWeek) * 100 : undefined)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
                <TableCell align="right" title="resources at the pace of the last 24 hours + the deployments of this month">Per month</TableCell>
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
                    <TableCell align="right">{money(r.week?.total, c)}</TableCell>
                    <TableCell align="right" title={r.deploys?.versions.map(v => v.image).join('\n')}>
                      {deployments.value ? `${r.deploys?.count ?? 0}${r.deployCost ? ` · ${money(r.deployCost, c)}` : ''}` : '—'}
                    </TableCell>
                    <TableCell align="right">{money(monthly(perMonth(r.day), r.deployCost), c)}</TableCell>
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

  return (
    <Page themeId="tool">
      <Header title="Costs" subtitle="What each namespace of the cluster costs (OpenCost)" />
      <Content>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Estimated with our prices, not a bill{pricing.description ? `: ${pricing.description}` : ''}. {describePrices(pricing)}. A
          namespace costs what its pods reserve (requests) or use, whichever is more; &quot;CPU used&quot; and &quot;Memory
          used&quot; say how much of what it reserves it really uses: reserved and not used is paid all the same. Each
          deployment, a new version of an image that runs in the namespace, is charged too; restarting or scaling is not a
          deployment.
        </Typography>
        {body}
      </Content>
    </Page>
  );
};
