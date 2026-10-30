import { useEffect, useMemo, useState } from 'react';
import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import { NAMESPACE_ANNOTATION } from '../catalog/usePrometheus';
import {
  addCounts,
  ByPriority,
  deploymentsCost,
  describeCounts,
  describePrices,
  efficiency,
  GiB,
  incidentCount,
  incidentsCost,
  money,
  pct,
  perMonth,
  useAllocations,
  useDeployments,
  useIncidentCounts,
  usePricing,
} from './openCost';

/** the references (lowercase) of every entity of the catalog in a namespace: its incidents are the namespace's */
function useRefsOfNamespace(ns: string) {
  const catalog = useApi(catalogApiRef);
  const [refs, setRefs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!ns) return;
    catalog
      .getEntities({
        filter: { [`metadata.annotations.${NAMESPACE_ANNOTATION}`]: ns },
        fields: ['kind', 'metadata.name', 'metadata.namespace'],
      })
      .then(({ items }) => setRefs(new Set(items.map(e => stringifyEntityRef(e).toLocaleLowerCase('en-US')))))
      .catch(() => setRefs(new Set()));
  }, [catalog, ns]);
  return refs;
}

const Figure = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.65 }}>{label}</div>
    <div style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1.25 }}>{value}</div>
    {note && <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{note}</div>}
  </div>
);

/**
 * What the namespace of an entity (annotation refresquito.io/namespace) cost, from OpenCost: the last 7 days, a month at
 * the pace of the last day, and how much of the CPU and memory it reserves it really uses. Our prices, not a bill.
 */
export const EntityCostCard = () => {
  const { entity } = useEntity();
  const ns = entity.metadata.annotations?.[NAMESPACE_ANNOTATION] ?? '';
  const pricing = usePricing();
  const { loading, error, week, day } = useAllocations();
  const deployments = useDeployments();
  const incidents = useIncidentCounts();
  const refs = useRefsOfNamespace(ns);
  const ownRef = stringifyEntityRef(entity).toLocaleLowerCase('en-US');
  const nsIncidents: ByPriority | undefined = useMemo(() => {
    if (!incidents.value) return undefined;
    let sum: ByPriority = {};
    for (const [ref, counts] of incidents.value) if (refs.has(ref) || ref === ownRef) sum = addCounts(sum, counts);
    return sum;
  }, [incidents.value, refs, ownRef]);

  let body;
  if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="Cost is not available" message={`OpenCost could not be queried: ${error.message}`} />;
  else {
    const w = week?.get(ns);
    const d = day?.get(ns);
    if (!w && !d) body = <WarningPanel severity="info" title="No cost yet" message={`OpenCost has no figures for ${ns} yet (they fill in as Prometheus keeps its series).`} />;
    else {
      const a = w ?? d!;
      const cpu = efficiency(a.cpuUsed, a.cpuRequested);
      const ram = efficiency(a.ramUsed, a.ramRequested);
      const days = a.minutes ? Math.min(7, a.minutes / 1440) : undefined;
      const deploys = deployments.value?.byNamespace.get(ns);
      const deployCost = deployments.value ? deploymentsCost(deploys?.count, pricing) : undefined;
      const resources = perMonth(d);
      const incidentCost = nsIncidents ? incidentsCost(nsIncidents, pricing) : undefined;
      const month =
        resources === undefined && deployCost === undefined && incidentCost === undefined
          ? undefined
          : (resources ?? 0) + (deployCost ?? 0) + (incidentCost ?? 0);
      let incidentNote: string;
      if (incidents.loading) incidentNote = 'counting…';
      else if (incidents.error) incidentNote = `not available: ${incidents.error.message}`;
      else if (!incidentCount(nsIncidents)) incidentNote = 'none opened this month';
      else incidentNote = [describeCounts(nsIncidents), incidentCost !== undefined ? money(incidentCost, pricing.currency) : ''].filter(Boolean).join(' · ');
      let deployNote: string;
      if (deployments.loading) deployNote = 'counting…';
      else if (deployments.error) deployNote = 'not counted in this installation';
      else if (!deploys?.count) deployNote = 'no new version this month';
      else deployNote = `${deployCost !== undefined ? `${money(deployCost, pricing.currency)} · ` : ''}last: ${deploys.versions[deploys.versions.length - 1].image.split('/').pop()}`;
      body = (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 28 }}>
          <Figure
            label="Last 7 days"
            value={money(w?.total, pricing.currency)}
            note={days !== undefined && days < 6.9 ? `only ${days.toFixed(1)} days measured` : `CPU ${money(w?.cpu, pricing.currency)} · memory ${money(w?.ram, pricing.currency)} · disk ${money(w?.disk, pricing.currency)}`}
          />
          <Figure
            label="Per month"
            value={money(month, pricing.currency)}
            note={
              deployCost || incidentCost
                ? 'resources at the pace of the last 24 hours + deployments and incidents of this month'
                : 'at the pace of the last 24 hours'
            }
          />
          <Figure label="Deployments this month" value={deployments.value ? String(deploys?.count ?? 0) : '—'} note={deployNote} />
          <Figure label="Incidents this month" value={nsIncidents ? String(incidentCount(nsIncidents)) : '—'} note={incidentNote} />
          <Figure
            label="CPU used of reserved"
            value={pct(cpu)}
            note={`${a.cpuUsed.toFixed(2)} of ${a.cpuRequested.toFixed(2)} cores`}
          />
          <Figure
            label="Memory used of reserved"
            value={pct(ram)}
            note={`${(a.ramUsed / GiB).toFixed(2)} of ${(a.ramRequested / GiB).toFixed(2)} GiB`}
          />
        </div>
      );
    }
  }

  return (
    <InfoCard
      title="Cost"
      subheader={`Estimated with our prices, not a bill: ${pricing.description ?? ''}${pricing.description ? '. ' : ''}${describePrices(pricing)}`}
      deepLink={{ title: 'All costs', link: '/costs' }}
    >
      {body}
      <div style={{ marginTop: 12, fontSize: '0.8rem', opacity: 0.7 }}>
        Reserved = what its pods request; what is reserved and not used is paid all the same. A deployment is a new version
        of an image running in the namespace; an incident, one opened on an element of the namespace, at the price of its
        priority. <Link to="/costs">Compare with the others</Link>.
      </div>
    </InfoCard>
  );
};
