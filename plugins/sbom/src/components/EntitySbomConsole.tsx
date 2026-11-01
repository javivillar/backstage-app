import { Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { sbomSources } from '../annotations';
import { type ImageScan, useDownload, useSbom, useVulnerabilities, type Vulnerability } from '../api';

/** The SBOM tab of the console: what to fix first, the vulnerabilities as a worklist, runtimes, licences, components. */

const C = {
  crit: { fg: '#B3261E', bg: '#FDECEA' },
  high: { fg: '#B95000', bg: '#FFF0DD' },
  med: { fg: '#0B5CAD', bg: '#E5F0FC' },
  low: { fg: '#5A6878', bg: '#EEF1F4' },
  ok: { fg: '#1E6B34', bg: '#E3F4E8' },
  kev: { fg: '#6B1B9A', bg: '#F3E8FA' },
};
const BLUE = '#0060C0';
const SEVS: Array<[string, keyof typeof C]> = [
  ['CRITICAL', 'crit'],
  ['HIGH', 'high'],
  ['MEDIUM', 'med'],
  ['LOW', 'low'],
];
const AV: Record<string, string> = { N: 'Network', A: 'Adjacent', L: 'Local', P: 'Physical' };
const LCOL = ['#1A8DFF', '#7B61FF', '#00A3A3', '#E8A33D', '#D64B8A', '#8592A0'];
const sevKey = (s: string) => SEVS.find(x => x[0] === s)?.[1] ?? 'low';
const pct = (x?: number | null) => {
  if (x === undefined || x === null) return '—';
  return `${(x * 100).toFixed(x < 0.01 ? 2 : 1)} %`;
};
const shortRef = (ref: string) => ref.split('/').pop()!.replace(/:([0-9a-f]{7})[0-9a-f]{33}$/, ':$1');
const sevWeight = (s: string) => {
  if (s === 'CRITICAL') return 300;
  return s === 'HIGH' ? 100 : 0;
};
/** the order of work: known exploited, critical, with a fix, reachable from the network, loaded, likely exploited */
export const priority = (v: Vulnerability) =>
  (v.kev ? 1000 : 0) + sevWeight(v.sev) + (v.fix ? 50 : 0) + (v.av === 'N' ? 30 : 0) + (v.in_use === 'yes' ? 40 : 0) + Math.round((v.epss_pct ?? 0) * 60);
const epssTone = (p: number) => {
  if (p > 0.9) return C.crit.fg;
  return p > 0.5 ? C.high.fg : C.med.fg;
};

const Tag = ({ tone, children }: { tone: keyof typeof C | 'plain'; children: ReactNode }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: 11,
      fontWeight: 600,
      px: 0.9,
      py: 0.15,
      borderRadius: 999,
      whiteSpace: 'nowrap',
      bgcolor: tone === 'plain' ? 'action.hover' : C[tone].bg,
      color: tone === 'plain' ? 'text.secondary' : C[tone].fg,
    }}
  >
    {children}
  </Box>
);
const Sev = ({ s }: { s: string }) => (
  <Box component="span" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', px: 0.9, py: 0.2, borderRadius: '5px', bgcolor: C[sevKey(s)].bg, color: C[sevKey(s)].fg, whiteSpace: 'nowrap' }}>
    {s}
  </Box>
);
const pill = (on = false) =>
  ({
    all: 'unset',
    boxSizing: 'border-box',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.75,
    border: '1px solid',
    borderColor: on ? 'text.primary' : 'divider',
    bgcolor: on ? 'text.primary' : 'transparent',
    color: on ? 'background.paper' : 'text.primary',
    borderRadius: 999,
    px: 1.25,
    py: 0.35,
    fontSize: 12.5,
    fontWeight: 500,
    '&:focus-visible': { outline: `2px solid ${BLUE}`, outlineOffset: 2 },
  }) as const;
const plainBtn = { all: 'unset', boxSizing: 'border-box', cursor: 'pointer', border: 1, borderColor: 'divider', borderRadius: '8px', px: 1.5, py: 0.75, fontWeight: 500, fontSize: 14, bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: `2px solid ${BLUE}` } } as const;
const card = { border: 1, borderColor: 'divider', borderRadius: '14px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1.5, minWidth: 0, alignContent: 'start' } as const;
const inputSx = { border: 1, borderColor: 'divider', bgcolor: 'background.default', color: 'text.primary', borderRadius: '8px', px: 1.25, py: 0.75, font: 'inherit', minWidth: 220 } as const;
const h3 = (t: ReactNode) => (
  <Typography variant="h6" component="h3" sx={{ fontWeight: 600, fontSize: 16 }}>
    {t}
  </Typography>
);

const SevBar = ({ counts }: { counts: Record<string, number> }) => {
  const total = SEVS.reduce((t, [s]) => t + (counts[s] ?? 0), 0) || 1;
  return (
    <Box aria-hidden sx={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', bgcolor: 'action.hover' }}>
      {SEVS.map(([s, k]) => (
        <Box key={s} sx={{ width: `${((counts[s] ?? 0) / total) * 100}%`, bgcolor: C[k].fg }} />
      ))}
    </Box>
  );
};

/** One image in the switcher: its name, base OS and severities. */
const ImageButton = ({ imageRef, on, onClick }: { imageRef: string; on: boolean; onClick: () => void }) => {
  const v = useVulnerabilities(imageRef);
  const scan = v.data?.scan ?? undefined;
  const os = scan?.os?.replace(/^.*\((.*)\)$/, '$1');
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={on}
      onClick={onClick}
      sx={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', border: 1, borderColor: on ? BLUE : 'divider', boxShadow: on ? `inset 0 0 0 1px ${BLUE}` : 'none', bgcolor: on ? 'rgba(0,96,192,0.06)' : 'background.paper', borderRadius: '12px', px: 1.75, py: 1.5, display: 'grid', gap: 1, '&:focus-visible': { outline: `2px solid ${BLUE}`, outlineOffset: 2 } }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'baseline' }}>
        <Box component="b" sx={{ fontFamily: 'monospace', fontSize: 14 }}>
          {shortRef(imageRef)}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {os ?? ''}
        </Typography>
      </Box>
      {scan ? (
        <>
          <SevBar counts={scan.counts} />
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary', alignItems: 'center' }}>
            {SEVS.map(([s, k]) => (
              <span key={s}>
                <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '2px', bgcolor: C[k].fg, mr: 0.5 }} />
                <Box component="b" sx={{ color: 'text.primary' }}>
                  {scan.counts[s] ?? 0}
                </Box>{' '}
                {s.toLowerCase()}
              </span>
            ))}
            {(scan.context?.kev ?? 0) > 0 && <Tag tone="kev">{scan.context!.kev} known exploited</Tag>}
          </Box>
        </>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {v.loading ? 'Reading its scan…' : 'Not scanned'}
        </Typography>
      )}
    </Box>
  );
};

const Fact = ({ label, value, sub, colour }: { label: string; value: ReactNode; sub?: ReactNode; colour?: string }) => (
  <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Box sx={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: colour }}>{value}</Box>
    {sub && (
      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {sub}
      </Typography>
    )}
  </Box>
);

/** what to do first with an image: a verdict, the end of life of its runtimes, the three packages to fix first, facts */
const Verdict = ({ scan }: { scan: ImageScan }) => {
  const x = scan.context ?? undefined;
  const eol = (scan.components ?? []).filter(r => r.status === 'eol');
  const firsts: Vulnerability[] = [];
  const seen = new Set<string>();
  for (const v of [...scan.vulns].filter(y => !y.not_applicable).sort((a, b) => priority(b) - priority(a))) {
    if (!seen.has(v.pkg ?? '') && firsts.length < 3) {
      seen.add(v.pkg ?? '');
      firsts.push(v);
    }
  }
  let tone: keyof typeof C = 'ok';
  let state = 'Clean';
  let head = 'Nothing critical or high: keep it rebuilt on its base image.';
  if (x?.kev) {
    tone = 'crit';
    state = 'Act now';
    head = `${x.kev} known exploited ${x.kev === 1 ? 'vulnerability' : 'vulnerabilities'}${x.exposure === 'external' ? ' in an image reachable from outside' : ''}.`;
  } else if (scan.counts.CRITICAL) {
    tone = 'crit';
    state = 'Act now';
    head = `${scan.counts.CRITICAL} critical to fix.`;
  } else if (scan.counts.HIGH) {
    tone = 'high';
    state = 'Plan it';
    head = `${scan.counts.HIGH} high, none critical.`;
  }
  const withFix = scan.vulns.filter(v => v.fix).length;
  const kevDue = scan.vulns.find(v => v.kev)?.kev_due;
  const why = (v: Vulnerability) =>
    [v.kev ? 'known exploited (CISA KEV)' : '', v.av === 'N' ? 'reachable from the network' : '', v.in_use === 'yes' ? 'loaded by a process' : '', v.epss_pct !== undefined ? `more likely exploited than ${Math.round(v.epss_pct * 100)} % of CVEs` : '']
      .filter(Boolean)
      .join(' · ');
  const exposure = x?.exposure === 'external' ? 'Internet-facing' : x?.exposure ?? 'unknown';
  return (
    <Box component="section" aria-label="What to do first" sx={{ border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper', display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.2fr) minmax(0, 1fr)' }, overflow: 'hidden' }}>
      <Box sx={{ p: 2, display: 'grid', gap: 1.25, alignContent: 'start', borderRight: { lg: 1 }, borderColor: { lg: 'divider' } }}>
        <Box sx={{ justifySelf: 'start' }}>
          <Tag tone={tone}>{state}</Tag>
        </Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600, fontSize: 18, textWrap: 'balance' }}>
          {head}
        </Typography>
        {eol.map(r => (
          <Box key={r.product} sx={{ border: 1, borderColor: C.high.fg, borderRadius: '10px', px: 1.5, py: 1, display: 'flex', gap: 1.25, alignItems: 'center' }}>
            <Tag tone="high">EOL</Tag>
            <Box>
              <b>
                {r.label ?? r.product} {r.version}
              </b>{' '}
              is out of support since {r.eol_date}
              <Typography variant="caption" display="block" color="text.secondary">
                No more security fixes upstream: rebuild on a supported release.
              </Typography>
            </Box>
          </Box>
        ))}
        {scan.os_eol && (
          <Box sx={{ border: 1, borderColor: C.crit.fg, borderRadius: '10px', px: 1.5, py: 1, display: 'flex', gap: 1.25, alignItems: 'center' }}>
            <Tag tone="crit">EOL</Tag>
            <span>The distribution of its base image publishes no more security fixes: rebuild it on a supported one.</span>
          </Box>
        )}
        {firsts.length > 0 && (
          <>
            <Typography sx={{ fontWeight: 600, fontSize: 13 }}>Fix first</Typography>
            {firsts.map(v => (
              <Box key={`${v.id}-${v.pkg}`} sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', px: 1.5, py: 1, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 1.25, alignItems: 'center' }}>
                <Sev s={v.sev} />
                <Box sx={{ minWidth: 0 }}>
                  <Box component="code" sx={{ fontSize: 12.5 }}>
                    {v.pkg} {v.ver}
                  </Box>
                  {v.fix && (
                    <>
                      {' → '}
                      <Box component="code" sx={{ fontSize: 12.5, color: C.ok.fg }}>
                        {v.fix}
                      </Box>
                    </>
                  )}
                  <Typography variant="caption" display="block" color="text.secondary">
                    {why(v)}
                  </Typography>
                </Box>
                <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                  {v.id}
                </Box>
              </Box>
            ))}
          </>
        )}
      </Box>
      <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5, alignContent: 'start', bgcolor: 'action.hover' }}>
        <Fact label="Exposure" value={exposure} sub="what reaches its pods" />
        <Fact label="Known exploited" value={x?.kev ?? 0} colour={x?.kev ? C.kev.fg : undefined} sub={x?.kev ? `${(x.kev_ids ?? []).join(', ')}${kevDue ? ` · due ${kevDue}` : ''}` : 'CISA KEV'} />
        <Fact label="Highest EPSS" value={pct(x?.epss_max)} sub={x?.epss_max_id ?? '—'} />
        <Fact label="Have a fix" value={`${withFix} / ${scan.vulns.length}`} sub="of those listed" />
        <Fact label="Loaded by a process" value={`${x?.critical_in_use ?? 0} critical`} sub={x?.in_use_known ? 'from the agents of the nodes' : 'not known'} />
        <Fact label="Oldest open" value={`${Math.max(0, ...scan.vulns.map(v => v.age_days ?? 0))} days`} sub="since the image first had it" />
      </Box>
    </Box>
  );
};

type Group = { pkg: string; ver: string; fix?: string; vs: Vulnerability[] };

/** the vulnerabilities as a worklist: filters, by vulnerability (with its detail) or by package to upgrade */
const Worklist = ({ scan, system }: { scan: ImageScan; system?: string }) => {
  const [sev, setSev] = useState('all');
  const [f, setF] = useState({ fix: false, kev: false, net: false, inUse: false });
  const [q, setQ] = useState('');
  const [view, setView] = useState<'cve' | 'pkg'>('cve');
  const [open, setOpen] = useState<string | undefined>();
  const all = scan.vulns;
  const n = (p: (v: Vulnerability) => boolean) => all.filter(p).length;
  const list = all
    .filter(v => (sev === 'all' || v.sev === sev) && (!f.fix || v.fix) && (!f.kev || v.kev) && (!f.net || v.av === 'N') && (!f.inUse || v.in_use === 'yes'))
    .filter(v => !q || `${v.id} ${v.pkg ?? ''} ${v.title ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => priority(b) - priority(a));
  const groups: Group[] = (() => {
    const m = new Map<string, Group>();
    for (const v of list) {
      const k = `${v.pkg} ${v.ver}`;
      const e = m.get(k) ?? { pkg: v.pkg ?? '?', ver: v.ver ?? '', vs: [] };
      e.vs.push(v);
      if (v.fix && (!e.fix || v.fix > e.fix)) e.fix = v.fix;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => Math.max(...b.vs.map(priority)) - Math.max(...a.vs.map(priority)));
  })();
  const th = { textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'text.secondary', p: 1, borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
  const td = { p: 1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top' } as const;
  const ask = (v: Vulnerability) => `/console/sec-assistant?${new URLSearchParams({ ...(system ? { system } : {}), ask: `What should we do about ${v.id} in ${v.pkg} ${v.ver}?` }).toString()}`;
  const filters: Array<[keyof typeof f, string, number]> = [
    ['fix', 'Has a fix', n(v => !!v.fix)],
    ['kev', 'Known exploited', n(v => !!v.kev)],
    ['net', 'From the network', n(v => v.av === 'N')],
    ['inUse', 'Loaded', n(v => v.in_use === 'yes')],
  ];
  const sevs: Array<[string, string, number]> = [['all', 'All', all.length], ...SEVS.slice(0, 2).map(([s]) => [s, s.charAt(0) + s.slice(1).toLowerCase(), n(v => v.sev === s)] as [string, string, number])];
  return (
    <Box component="section" aria-label="Vulnerabilities" sx={card}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {h3(`Vulnerabilities · ${list.length} of ${all.length}`)}
        <Box role="group" aria-label="View" sx={{ display: 'inline-flex', border: 1, borderColor: 'divider', borderRadius: '8px', overflow: 'hidden' }}>
          {(
            [
              ['cve', 'By vulnerability'],
              ['pkg', 'By package to upgrade'],
            ] as const
          ).map(([k, l]) => (
            <Box key={k} component="button" type="button" aria-pressed={view === k} onClick={() => setView(k)} sx={{ all: 'unset', cursor: 'pointer', px: 1.4, py: 0.6, fontSize: 12.5, fontWeight: 500, bgcolor: view === k ? BLUE : 'transparent', color: view === k ? '#fff' : 'text.primary', '&:focus-visible': { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}>
              {l}
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box component="input" value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder="Search CVE, package or title" aria-label="Search vulnerabilities" sx={inputSx} />
        {sevs.map(([k, l, c]) => (
          <Box key={k} component="button" type="button" aria-pressed={sev === k} onClick={() => setSev(k)} sx={pill(sev === k)}>
            {l} · {c}
          </Box>
        ))}
        {filters.map(([k, l, c]) => (
          <Box key={k} component="button" type="button" aria-pressed={f[k]} onClick={() => setF(x => ({ ...x, [k]: !x[k] }))} sx={pill(f[k])}>
            {l} · {c}
          </Box>
        ))}
      </Box>
      {list.length === 0 && <Typography color="text.secondary">No vulnerability matches. Critical and high are listed, plus any severity in CISA KEV.</Typography>}
      {list.length > 0 && view === 'pkg' && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          {groups.map(g => (
            <Box key={`${g.pkg} ${g.ver}`} sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', px: 1.5, py: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1.25, alignItems: 'center' }}>
              <Box sx={{ minWidth: 0 }}>
                <Box component="code" sx={{ fontSize: 12.5 }}>
                  {g.pkg} {g.ver}
                </Box>{' '}
                {g.fix ? (
                  <>
                    {'→ '}
                    <Box component="code" sx={{ fontSize: 12.5, color: C.ok.fg }}>
                      {g.fix}
                    </Box>
                  </>
                ) : (
                  <Box component="span" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                    no fix yet
                  </Box>
                )}
                <Typography variant="caption" display="block" color="text.secondary">
                  {g.fix ? 'Upgrading it closes' : 'Open'}: {g.vs.map(v => v.id).join(', ')}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {SEVS.filter(([s]) => g.vs.some(v => v.sev === s)).map(([s, k]) => (
                  <Box key={s} component="span" sx={{ fontSize: 11, fontWeight: 700, px: 0.9, py: 0.2, borderRadius: '5px', bgcolor: C[k].bg, color: C[k].fg }}>
                    {g.vs.filter(v => v.sev === s).length} {s.toLowerCase()}
                  </Box>
                ))}
                {g.vs.some(v => v.kev) && <Tag tone="kev">KEV</Tag>}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {list.length > 0 && view === 'cve' && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr>
                <Box component="th" sx={th}>
                  Severity
                </Box>
                <Box component="th" sx={th}>
                  Vulnerability
                </Box>
                <Box component="th" sx={th}>
                  Package
                </Box>
                <Box component="th" sx={th}>
                  Signals
                </Box>
                <Box component="th" sx={th} title="FIRST EPSS: probability of exploitation in the next 30 days">
                  EPSS
                </Box>
                <Box component="th" sx={th} title="Days since its image repository first had it">
                  Open
                </Box>
              </tr>
            </thead>
            <tbody>
              {list.map(v => {
                const k = `${v.id}-${v.pkg}`;
                const isOpen = open === k;
                const p = v.epss_pct ?? 0;
                const flip = () => setOpen(isOpen ? undefined : k);
                return (
                  <Fragment key={k}>
                    <Box
                      component="tr"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={flip}
                      onKeyDown={(e: { key: string; preventDefault: () => void }) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          flip();
                        }
                      }}
                      sx={{ cursor: 'pointer', '&:hover td': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}
                    >
                      <Box component="td" sx={td}>
                        <Sev s={v.sev} />
                      </Box>
                      <Box component="td" sx={td}>
                        <Box sx={{ fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{v.id}</Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: '52ch' }}>
                          {(v.title ?? '').replace(/^[^:]+:\s*(?:[^:]+:\s*)?/, '')}
                        </Typography>
                      </Box>
                      <Box component="td" sx={{ ...td, fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                        <div>{v.pkg}</div>
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          {v.ver}
                        </Box>
                        {v.fix ? (
                          <>
                            {' → '}
                            <Box component="span" sx={{ color: C.ok.fg }}>
                              {v.fix}
                            </Box>
                          </>
                        ) : (
                          <Box component="span" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                            {' no fix yet'}
                          </Box>
                        )}
                      </Box>
                      <Box component="td" sx={td}>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {v.kev && <Tag tone="kev">{v.kev_ransomware ? 'KEV · ransomware' : 'KEV'}</Tag>}
                          {v.av && <Tag tone="plain">{AV[v.av] ?? v.av}</Tag>}
                          {v.in_use === 'yes' && <Tag tone="high">loaded</Tag>}
                          {v.cls && <Tag tone="plain">{v.cls === 'os' ? 'OS package' : 'library'}</Tag>}
                          {v.not_applicable && <Tag tone="plain">n/a (kernel)</Tag>}
                        </Box>
                      </Box>
                      <Box component="td" sx={td}>
                        <Box sx={{ display: 'grid', gap: 0.4, minWidth: 90 }}>
                          <Box sx={{ height: 5, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', width: `${p * 100}%`, bgcolor: epssTone(p) }} />
                          </Box>
                          <Box component="small" sx={{ fontFamily: 'monospace', fontSize: 11.5, color: 'text.secondary' }}>
                            {pct(v.epss)} · p{Math.round(p * 100)}
                          </Box>
                        </Box>
                      </Box>
                      <Box component="td" sx={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {v.age_days ?? '—'} d
                      </Box>
                    </Box>
                    {isOpen && (
                      <tr>
                        <Box component="td" sx={{ ...td, bgcolor: 'action.hover' }} />
                        <Box component="td" colSpan={5} sx={{ ...td, bgcolor: 'action.hover' }}>
                          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 14px', m: 0, fontSize: 13, '& dt': { color: 'text.secondary' }, '& dd': { m: 0 } }}>
                            <dt>Title</dt>
                            <dd>{v.title ?? '—'}</dd>
                            <dt>First seen</dt>
                            <dd>{v.first_seen ?? '—'}</dd>
                            {v.kev && (
                              <>
                                <dt>CISA KEV</dt>
                                <dd>
                                  added {v.kev_added ?? '?'} · remediation due {v.kev_due ?? '?'}
                                </dd>
                              </>
                            )}
                            <dt>Attack vector</dt>
                            <dd>{v.av ? AV[v.av] ?? v.av : '—'}</dd>
                            <dt>In use</dt>
                            <dd>{v.in_use ?? 'unknown'}</dd>
                            <dt>Links</dt>
                            <dd>
                              <a href={`https://nvd.nist.gov/vuln/detail/${v.id}`} target="_blank" rel="noreferrer">
                                NVD
                              </a>
                              {' · '}
                              <a href={`https://www.cve.org/CVERecord?id=${v.id}`} target="_blank" rel="noreferrer">
                                CVE.org
                              </a>
                              {v.kev && (
                                <>
                                  {' · '}
                                  <a href={`https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${v.id}`} target="_blank" rel="noreferrer">
                                    CISA KEV
                                  </a>
                                </>
                              )}
                            </dd>
                          </Box>
                          <Box sx={{ mt: 1.25 }}>
                            <Box component="a" href={ask(v)} sx={{ ...plainBtn, display: 'inline-block', textDecoration: 'none', color: 'text.primary' }}>
                              Ask the security assistant
                            </Box>
                          </Box>
                        </Box>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}
    </Box>
  );
};

/** One image (or release): verdict, worklist, runtimes and base image, licences, components. */
const SourceView = ({ kind, imageRef: ref, system }: { kind: 'image' | 'release'; imageRef: string; system?: string }) => {
  const sbom = useSbom(kind, ref);
  const vulns = useVulnerabilities(kind === 'image' ? ref : '');
  const download = useDownload();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [dlError, setDlError] = useState<string | undefined>();
  const s = sbom.data?.summary ?? undefined;
  const licenses = useMemo(() => Object.entries(s?.licenses ?? {}).sort((a, b) => b[1] - a[1]), [s]);
  const other = licenses.slice(5).reduce((t, [, c]) => t + c, 0);
  const shown: Array<[string, number]> = other ? [...licenses.slice(0, 5), ['other', other]] : licenses.slice(0, 5);
  const total = shown.reduce((t, [, c]) => t + c, 0) || 1;
  const comps = (s?.components ?? []).filter(c => !q || `${c.name} ${c.version ?? ''} ${c.licenses.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const scan = vulns.data?.scan ?? undefined;
  const denied = s?.licensePolicy?.denied.length ?? 0;
  const os = scan?.os?.replace(/^.*\((.*)\)$/, '$1');
  if (sbom.loading) return <Progress />;
  if (sbom.error) return <WarningPanel title="The SBOM could not be read" message={sbom.error} />;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {vulns.loading && kind === 'image' && <Progress />}
      {scan && <Verdict scan={scan} />}
      {scan && <Worklist scan={scan} system={system} />}
      {!scan && !vulns.loading && kind === 'image' && <Typography color="text.secondary">The last scan of Wazuh did not see this image (deployed after it, or not running).</Typography>}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Box component="section" aria-label="Runtimes and base image" sx={card}>
          {h3('Runtimes and base image')}
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '6px 14px', m: 0, fontSize: 13.5, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' } }}>
            {os && (
              <>
                <dt>Base image</dt>
                <dd>
                  {os} {scan?.os_eol ? <Tag tone="crit">out of support</Tag> : <Tag tone="ok">supported</Tag>}
                </dd>
              </>
            )}
            {(scan?.components ?? []).map(c => (
              <Fragment key={c.product}>
                <dt>{c.label ?? c.product}</dt>
                <dd>
                  {c.version} {c.status === 'eol' && <Tag tone="high">end of life {c.eol_date}</Tag>}
                  {c.status === 'soon' && <Tag tone="high">ends {c.eol_date}</Tag>}
                  {c.status === 'supported' && <Tag tone="ok">supported until {c.eol_date ?? '?'}</Tag>}
                </dd>
              </Fragment>
            ))}
            {s && (
              <>
                <dt>Components</dt>
                <dd>
                  {s.total} in its SBOM ({s.specVersion ? `CycloneDX ${s.specVersion}` : 'CycloneDX'})
                </dd>
              </>
            )}
            {s?.frameworks?.length ? (
              <>
                <dt>Framework</dt>
                <dd>{s.frameworks.map(fw => `${fw.name} ${fw.version ?? ''}`).join(', ')}</dd>
              </>
            ) : null}
            {scan?.run && (
              <>
                <dt>Scanned</dt>
                <dd>{new Date(scan.run).toLocaleString()} · Wazuh image scan (Trivy)</dd>
              </>
            )}
          </Box>
          {s && (
            <Box>
              <Box component="button" type="button" onClick={() => download(kind, ref).catch(e => setDlError((e as Error).message))} sx={plainBtn}>
                Download the SBOM (CycloneDX)
              </Box>
              {dlError && (
                <Typography variant="caption" color="error" display="block">
                  {dlError}
                </Typography>
              )}
            </Box>
          )}
        </Box>
        <Box component="section" aria-label="Licences" sx={card}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {h3('Licences')}
            {s && denied > 0 && <Tag tone="crit">{denied} denied</Tag>}
            {s && denied === 0 && <Tag tone="ok">policy OK · none denied</Tag>}
          </Box>
          {!s && <Typography color="text.secondary">{ref} has no SBOM attached: it was built before its CI made them.</Typography>}
          {s && (
            <>
              <Box sx={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden' }}>
                {shown.map(([l, c], i) => (
                  <Box key={l} title={`${l}: ${c}`} sx={{ width: `${(c / total) * 100}%`, bgcolor: LCOL[i] }} />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', fontSize: 12, color: 'text.secondary' }}>
                {shown.map(([l, c], i) => (
                  <span key={l}>
                    <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '2px', bgcolor: LCOL[i], mr: 0.5 }} />
                    <Box component="b" sx={{ color: 'text.primary' }}>
                      {c}
                    </Box>{' '}
                    {l}
                  </span>
                ))}
              </Box>
              {denied > 0 && (
                <Typography variant="body2" sx={{ color: C.crit.fg }}>
                  Denied: {s.licensePolicy!.denied.map(d => `${d.name} (${(d.denied ?? d.licenses).join(', ')})`).join('; ')}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                Counted per licence: a component can carry several. Open source only: the policy denies licences that are not freely redistributable.
              </Typography>
            </>
          )}
        </Box>
      </Box>
      {s && (
        <Box component="section" aria-label="Components" sx={card}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {h3(`Components · ${comps.length} of ${s.components.length}`)}
            <Box component="input" value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder="Search name, version or licence" aria-label="Search components" sx={inputSx} />
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, '& th': { textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'text.secondary', p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { p: 1, borderBottom: 1, borderColor: 'divider' } }}>
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
              <Box component="button" type="button" onClick={() => setAll(x => !x)} sx={plainBtn}>
                {all ? 'Show the first 25' : `Show all ${comps.length}`}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/** The SBOM tab inside the console: one image or release at a time. */
export const EntitySbomConsoleContent = () => {
  const { entity } = useEntity();
  const sources = sbomSources(entity);
  const [i, setI] = useState(0);
  if (!sources.length) return <Typography color="text.secondary">The catalog says no image or release of it.</Typography>;
  const cur = sources[Math.min(i, sources.length - 1)];
  const system = typeof entity.spec?.system === 'string' ? entity.spec.system.split('/').pop() : undefined;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box role="group" aria-label="Image" sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
        {sources.map((src, j) =>
          src.kind === 'image' ? (
            <ImageButton key={src.ref} imageRef={src.ref} on={j === i} onClick={() => setI(j)} />
          ) : (
            <Box key={src.ref} component="button" type="button" aria-pressed={j === i} onClick={() => setI(j)} sx={{ ...plainBtn, borderRadius: '12px', borderColor: j === i ? BLUE : 'divider', fontFamily: 'monospace' }}>
              release {shortRef(src.ref)}
            </Box>
          ),
        )}
      </Box>
      <SourceView key={cur.ref} kind={cur.kind} imageRef={cur.ref} system={system} />
    </Box>
  );
};
