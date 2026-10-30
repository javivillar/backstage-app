import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { NAMESPACE_ANNOTATION } from '../catalog/usePrometheus';
import { deploymentsCost, describePrices, efficiency, GiB, money, pct, perMonth, useAllocations, useDeployments, usePricing } from './openCost';

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
      const month = resources === undefined && deployCost === undefined ? undefined : (resources ?? 0) + (deployCost ?? 0);
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
            note={deployCost ? 'resources at the pace of the last 24 hours + deployments of this month' : 'at the pace of the last 24 hours'}
          />
          <Figure label="Deployments this month" value={deployments.value ? String(deploys?.count ?? 0) : '—'} note={deployNote} />
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
        of an image running in the namespace. <Link to="/costs">Compare with the others</Link>.
      </div>
    </InfoCard>
  );
};
