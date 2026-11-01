import { Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useMemo, useState } from 'react';
import { sbomSources } from '../annotations';
import { useSbom, useVulnerabilities } from '../api';

const TONE = { ok: '#1E6B34', warn: '#8A4300', bad: '#B3261E', info: '#0B5CAD', off: '#5A6878' };
const SEV: Array<[string, keyof typeof TONE]> = [
  ['CRITICAL', 'bad'],
  ['HIGH', 'warn'],
  ['MEDIUM', 'info'],
  ['LOW', 'off'],
];
const LICENSE_COLOURS = ['#1A8DFF', '#7B61FF', '#00A3A3', '#E8A33D', '#D64B8A', '#5A6878'];

const Card = ({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.25, minWidth: 0 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
          {title}
        </Typography>
        {sub && (
          <Typography variant="body2" color="text.secondary">
            {sub}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
    {children}
  </Box>
);
const Kpi = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: keyof typeof TONE }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.5, bgcolor: 'background.paper' }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 22, fontWeight: 600, color: tone ? TONE[tone] : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    )}
  </Box>
);
const tableSx = { width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th': { textAlign: 'left', fontWeight: 500, color: 'text.secondary', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { p: 1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top' } } as const;

/** One image (or release): what it is made of, its licences and its vulnerabilities. */
const SourceView = ({ kind, ref }: { kind: 'image' | 'release'; ref: string }) => {
  const sbom = useSbom(kind, ref);
  const vulns = useVulnerabilities(kind === 'image' ? ref : '');
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const s = sbom.data?.summary ?? undefined;
  const licenses = useMemo(() => Object.entries(s?.licenses ?? {}).sort((a, b) => b[1] - a[1]), [s]);
  const total = licenses.reduce((t, [, n]) => t + n, 0) || 1;
  const comps = (s?.components ?? []).filter(c => !q || `${c.name} ${c.version ?? ''} ${c.licenses.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const scan = vulns.data?.scan ?? undefined;
  const denied = s?.licensePolicy?.denied.length ?? 0;
  if (sbom.loading) return <Progress />;
  if (sbom.error) return <WarningPanel title="The SBOM could not be read" message={sbom.error} />;
  if (!s) return <Typography color="text.secondary">{ref} has no SBOM attached: it was built before its CI made them.</Typography>;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))' }}>
        <Kpi label="Components" value={String(s.total)} sub={Object.entries(s.ecosystems).map(([k, v]) => `${k} ${v}`).slice(0, 3).join(' · ')} />
        <Kpi label="Licence policy" value={denied ? `${denied} denied` : 'OK'} sub={`${s.licensePolicy?.checked ?? 0} dependencies checked`} tone={denied ? 'bad' : 'ok'} />
        {SEV.map(([sev, tone]) => (
          <Kpi key={sev} label={sev.toLowerCase()} value={scan ? String(scan.counts[sev] ?? 0) : '—'} sub="vulnerabilities" tone={scan && (scan.counts[sev] ?? 0) > 0 ? tone : undefined} />
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Card title="Licences" sub={`${s.generator ?? 'SBOM'} · ${s.specVersion ? `CycloneDX ${s.specVersion}` : ''}${sbom.data?.created ? ` · attached ${new Date(sbom.data.created).toLocaleString()}` : ''}`}>
          <Box sx={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', bgcolor: 'action.hover' }}>
            {licenses.slice(0, 6).map(([l, n], i) => (
              <Box key={l} title={`${l}: ${n}`} sx={{ width: `${(n / total) * 100}%`, bgcolor: LICENSE_COLOURS[i] }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {licenses.slice(0, 10).map(([l, n], i) => (
              <Typography key={l} variant="caption" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
                <Box component="span" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: LICENSE_COLOURS[Math.min(i, 5)] }} />
                {l} {n}
              </Typography>
            ))}
          </Box>
          {s.frameworks.length > 0 && (
            <Typography variant="body2">
              Framework: <b>{s.frameworks.map(f => `${f.name} ${f.version ?? ''}`).join(', ')}</b>
            </Typography>
          )}
          {denied > 0 && (
            <Typography variant="body2" sx={{ color: TONE.bad }}>
              Denied: {s.licensePolicy!.denied.map(d => `${d.name} (${(d.denied ?? d.licenses).join(', ')})`).join('; ')}
            </Typography>
          )}
        </Card>
        <Card title="Vulnerabilities" sub={scan ? `Wazuh image scan (Trivy) · ${scan.run ? new Date(scan.run).toLocaleString() : ''}${scan.os ? ` · ${scan.os}` : ''}` : 'Not scanned (or a release)'}>
          {vulns.loading && <Progress />}
          {scan && scan.vulns.length === 0 && <Typography color="text.secondary">No critical or high vulnerability.</Typography>}
          {scan && scan.vulns.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Box component="table" sx={tableSx}>
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>Package</th>
                    <th>Fix</th>
                    <th>Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.vulns.slice(0, 12).map(v => (
                    <tr key={`${v.id}-${v.pkg}`}>
                      <td>
                        <Box component="span" sx={{ color: TONE[(SEV.find(x => x[0] === v.sev)?.[1]) ?? 'off'], fontWeight: 600 }}>
                          {v.id}
                        </Box>
                      </td>
                      <td>
                        {v.pkg} {v.ver}
                      </td>
                      <td>{v.fix || '—'}</td>
                      <td>{[v.kev ? 'KEV' : '', v.epss_pct !== undefined ? `EPSS ${Math.round(v.epss_pct * 100)} %` : '', v.not_applicable ? 'n/a' : ''].filter(Boolean).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          )}
        </Card>
      </Box>
      <Card
        title="Components"
        sub={`${comps.length} of ${s.components.length}`}
        action={<TextField size="small" placeholder="Search name, version or licence" value={q} onChange={e => setQ(e.target.value)} inputProps={{ 'aria-label': 'Search components' }} />}
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={tableSx}>
            <thead>
              <tr>
                <th>Component</th>
                <th>Version</th>
                <th>Ecosystem</th>
                <th>Licences</th>
              </tr>
            </thead>
            <tbody>
              {(all ? comps : comps.slice(0, 25)).map(c => (
                <tr key={`${c.ecosystem}:${c.group ?? ''}:${c.name}:${c.version ?? ''}`}>
                  <td>{c.group ? `${c.group}/${c.name}` : c.name}</td>
                  <td>
                    <code>{c.version}</code>
                  </td>
                  <td>{c.ecosystem}</td>
                  <td>{c.licenses.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
        {comps.length > 25 && (
          <Box>
            <Button size="small" onClick={() => setAll(x => !x)} sx={{ textTransform: 'none' }}>
              {all ? 'Show the first 25' : `Show all ${comps.length}`}
            </Button>
          </Box>
        )}
      </Card>
    </Box>
  );
};

/** The SBOM tab inside the console: one image or release at a time, with the console's cards. */
export const EntitySbomConsoleContent = () => {
  const { entity } = useEntity();
  const sources = sbomSources(entity);
  const [i, setI] = useState(0);
  if (!sources.length) return <Typography color="text.secondary">The catalog says no image or release of it.</Typography>;
  const cur = sources[Math.min(i, sources.length - 1)];
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box role="tablist" aria-label="Image" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {sources.map((s, j) => (
          <Button key={s.ref} role="tab" aria-selected={j === i} size="small" variant={j === i ? 'contained' : 'outlined'} disableElevation onClick={() => setI(j)} sx={{ textTransform: 'none', fontFamily: 'monospace' }}>
            {s.ref.split('/').pop()?.replace(/:([0-9a-f]{7})[0-9a-f]{33}$/, ':$1')}
          </Button>
        ))}
      </Box>
      <SourceView key={cur.ref} kind={cur.kind} ref={cur.ref} />
    </Box>
  );
};
