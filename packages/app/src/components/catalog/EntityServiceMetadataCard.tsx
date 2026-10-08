import { Entity } from '@backstage/catalog-model';
import { InfoCard, Link } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';

/**
 * Generic card for the metadata an organization adds to its catalog entities: every annotation
 * with the prefix below is shown, so a new field in a catalog-info.yaml appears here without
 * touching the app. `refresquito.io/sla-*` go in their own group (the service level).
 *
 *   refresquito.io/criticality: high          ->  Criticality     high
 *   refresquito.io/sla-availability: "99.5%"  ->  Availability    99.5%   (Service level)
 *   refresquito.io/runbook: https://...       ->  Runbook         link
 */
const PREFIX = 'refresquito.io/';
const SLA = 'sla-';
const UPPER = new Set(['sla', 'rto', 'rpo', 'url', 'api', 'id', 'cpu', 'ha']);
// what the organization has not decided yet is written like this in the catalog
const PENDING = /^(pending|tbd|to be defined)$/i;

const fields = (entity: Entity): [string, string][] =>
  Object.entries(entity.metadata.annotations ?? {})
    .filter(([key, value]) => key.startsWith(PREFIX) && value !== '')
    .map(([key, value]) => [key.slice(PREFIX.length), value] as [string, string])
    .sort(([a], [b]) => a.localeCompare(b));

export const hasServiceMetadata = (entity: Entity) => fields(entity).length > 0;

const label = (key: string) =>
  key
    .split('-')
    .map((word, i) => {
      if (UPPER.has(word)) return word.toUpperCase();
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');

const Value = ({ value }: { value: string }) => {
  if (/^https?:\/\//.test(value)) return <Link to={value}>{value}</Link>;
  if (PENDING.test(value)) return <em style={{ opacity: 0.6 }}>pending</em>;
  return <>{value}</>;
};

const Group = ({ title, rows }: { title: string; rows: [string, string][] }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.65, marginBottom: 8 }}>
      {title}
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) minmax(0, 1fr)', gap: '6px 16px', margin: 0 }}>
      {rows.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt style={{ opacity: 0.75 }}>{label(key)}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
            <Value value={value} />
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

export const EntityServiceMetadataCard = () => {
  const { entity } = useEntity();
  const all = fields(entity);
  const sla = all.filter(([key]) => key.startsWith(SLA)).map(([key, value]) => [key.slice(SLA.length), value] as [string, string]);
  const rest = all.filter(([key]) => !key.startsWith(SLA));
  return (
    <InfoCard title="Service metadata" variant="gridItem">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
        {rest.length > 0 && <Group title="Service" rows={rest} />}
        {sla.length > 0 && <Group title="Service level" rows={sla} />}
      </div>
    </InfoCard>
  );
};
