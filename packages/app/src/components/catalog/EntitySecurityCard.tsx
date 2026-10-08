import { InfoCard, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { NAMESPACE_ANNOTATION, usePrometheus } from './usePrometheus';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const COLORS: Record<string, string> = { critical: '#c62828', high: '#e65100', medium: '#b28704', low: '#607d8b' };

const cell = { padding: '6px 12px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const };
const head = { ...cell, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, opacity: 0.65 };

/**
 * Vulnerabilities of the images a service runs, as Wazuh's daily image scan (Trivy) found them:
 * the metrics refresquito_image_* that the security exporter of wazuh-oneke publishes.
 */
export const EntitySecurityCard = () => {
  const { entity } = useEntity();
  const ns = entity.metadata.annotations?.[NAMESPACE_ANNOTATION] ?? '';
  const { value, loading, error } = usePrometheus({
    findings: `sum by (image, severity) (refresquito_image_vulnerabilities{target_namespace="${ns}"})`,
    fixable: `sum by (image) (refresquito_image_critical_fixable{target_namespace="${ns}"})`,
    scanned: `max(refresquito_image_scan_timestamp_seconds{target_namespace="${ns}"})`,
  });

  let body;
  let subheader = `namespace ${ns}`;
  if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="Security data is not available" message={`Prometheus could not be queried: ${error.message}`} />;
  else {
    const images: Record<string, Record<string, number>> = {};
    for (const s of value?.findings ?? []) {
      images[s.metric.image] = images[s.metric.image] ?? {};
      images[s.metric.image][s.metric.severity] = s.value;
    }
    for (const s of value?.fixable ?? []) {
      if (images[s.metric.image]) images[s.metric.image].fixable = s.value;
    }
    const rows = Object.entries(images).sort(
      ([, a], [, b]) => (b.critical ?? 0) - (a.critical ?? 0) || (b.high ?? 0) - (a.high ?? 0),
    );
    const scanned = value?.scanned[0]?.value;
    if (scanned) subheader += ` · last scan ${new Date(scanned * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    const total = (key: string) => rows.reduce((sum, [, r]) => sum + (r[key] ?? 0), 0);
    body =
      rows.length === 0 ? (
        <div style={{ opacity: 0.75 }}>
          No image scan results for this namespace yet (the scan runs once a day; it needs Wazuh's image scan and security exporter).
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: 'left' }}>Image</th>
                {SEVERITIES.map(s => (
                  <th key={s} style={head}>{s}</th>
                ))}
                <th style={head}>Critical with a fix</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([image, r]) => (
                <tr key={image} style={{ borderTop: '1px solid rgba(128,128,128,0.25)' }}>
                  <td style={{ padding: '6px 12px', overflowWrap: 'anywhere' }}>{image}</td>
                  {SEVERITIES.map(s => (
                    <td key={s} style={{ ...cell, color: (r[s] ?? 0) > 0 ? COLORS[s] : undefined, fontWeight: (r[s] ?? 0) > 0 && s === 'critical' ? 700 : undefined, opacity: (r[s] ?? 0) > 0 ? 1 : 0.45 }}>
                      {r[s] ?? 0}
                    </td>
                  ))}
                  <td style={{ ...cell, opacity: (r.fixable ?? 0) > 0 ? 1 : 0.45 }}>{r.fixable ?? 0}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid rgba(128,128,128,0.45)', fontWeight: 700 }}>
                <td style={{ padding: '6px 12px' }}>Total ({rows.length} images)</td>
                {SEVERITIES.map(s => (
                  <td key={s} style={cell}>{total(s)}</td>
                ))}
                <td style={cell}>{total('fixable')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
  }
  return (
    <InfoCard title="Security: image vulnerabilities" subheader={subheader} variant="gridItem">
      {body}
    </InfoCard>
  );
};
