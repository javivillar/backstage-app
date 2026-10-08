import { InfoCard, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { NAMESPACE_ANNOTATION, usePrometheus } from './usePrometheus';

// Prometheus keeps 15 days: the measured window, whatever the period of the target.
const WINDOW = '15d';
const TARGET_ANNOTATION = 'refresquito.io/sla-availability';

const TONES = { ok: '#2e7d32', bad: '#c62828' };

const pct = (value: number | undefined, digits = 2) =>
  value === undefined || Number.isNaN(value) ? '—' : `${value.toFixed(digits)} %`;

const Figure = ({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'ok' | 'bad' }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.65 }}>{label}</div>
    <div style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1.25, color: tone ? TONES[tone] : undefined }}>
      {value}
    </div>
    {note && <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{note}</div>}
  </div>
);

/**
 * Measured availability of a service against its target (annotation refresquito.io/sla-availability).
 * Available = every Deployment and StatefulSet of its namespace has all its replicas ready,
 * sampled every 5 minutes (kube-state-metrics). Plus the share of HTTP requests through the
 * ingress that did not end in a 5xx (Traefik).
 */
export const EntityAvailabilityCard = () => {
  const { entity } = useEntity();
  const ns = entity.metadata.annotations?.[NAMESPACE_ANNOTATION] ?? '';
  const targetText = entity.metadata.annotations?.[TARGET_ANNOTATION];
  const target = targetText ? parseFloat(targetText) : undefined;
  const workloads =
    `(kube_deployment_status_replicas_available{namespace="${ns}"} >= bool on(namespace,deployment) kube_deployment_spec_replicas{namespace="${ns}"})` +
    ` or (kube_statefulset_status_replicas_ready{namespace="${ns}"} >= bool on(namespace,statefulset) kube_statefulset_replicas{namespace="${ns}"})`;
  const requests = `traefik_service_requests_total{service=~"${ns}-.*"`;
  const { value, loading, error } = usePrometheus({
    availability: `avg_over_time((min(${workloads}))[${WINDOW}:5m]) * 100`,
    ready: `sum(${workloads})`,
    total: `count(${workloads})`,
    http: `(1 - (sum(increase(${requests},code=~"5.."}[${WINDOW}])) or vector(0)) / sum(increase(${requests}}[${WINDOW}]))) * 100`,
  });

  let body;
  if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="Availability is not available" message={`Prometheus could not be queried: ${error.message}`} />;
  else {
    const availability = value?.availability[0]?.value;
    const ready = value?.ready[0]?.value;
    const total = value?.total[0]?.value;
    const http = value?.http[0]?.value;
    const met = availability !== undefined && target !== undefined ? availability >= target : undefined;
    let metTone: 'ok' | 'bad' | undefined;
    let metNote = 'no data yet';
    if (met !== undefined) {
      metTone = met ? 'ok' : 'bad';
      metNote = met ? 'meets the target' : 'below the target';
    }
    let readyTone: 'ok' | 'bad' | undefined;
    if (total !== undefined) readyTone = ready === total ? 'ok' : 'bad';
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 28 }}>
        <Figure
          label={`Measured, last ${WINDOW.replace('d', ' days')}`}
          value={pct(availability)}
          tone={metTone}
          note={metNote}
        />
        <Figure label="Target" value={target !== undefined ? pct(target, target % 1 === 0 ? 0 : 1) : '—'} note={targetText ?? 'no service level defined'} />
        <Figure
          label="Workloads ready now"
          value={total === undefined ? '—' : `${ready ?? 0} / ${total}`}
          tone={readyTone}
          note="deployments and stateful sets"
        />
        <Figure label="HTTP requests without 5xx" value={pct(http)} note={http === undefined ? 'no traffic through the ingress' : `last ${WINDOW.replace('d', ' days')}`} />
      </div>
    );
  }
  return (
    <InfoCard title="Availability" subheader={`namespace ${ns}`} variant="gridItem">
      {body}
    </InfoCard>
  );
};
