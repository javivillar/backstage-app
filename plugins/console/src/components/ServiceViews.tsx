import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActions } from '../actions';
import { totals, useNamespaceChanges } from '../entityData';
import { useClusterOverview } from '../overview';
import { Badge } from './Badge';
import { ClassicLink } from './ClassicLink';
import { classify, entityPath } from './classify';
import { bytes } from './ClusterOverviewPage';
import { TONES } from './Flow';
import { Table } from './NetworkPage';
import { type Attention, serviceAttention, type Tone, useService } from './ServiceData';
import { rq } from './tokens';

const spec = (e: Entity) => (e.spec ?? {}) as { owner?: string; system?: string; lifecycle?: string; type?: string };

const Section = ({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <Paper variant="outlined" component="section" sx={{ borderRadius: '12px', p: 2, display: 'grid', gap: 1.25, alignContent: 'start' }}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
      <Typography variant="h6" component="h2" sx={{ fontSize: 16, fontWeight: 600 }}>
        {title}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {action}
    </Box>
    {children}
  </Paper>
);

const Dot = ({ tone }: { tone: Tone }) => <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: TONES[tone].fg, display: 'inline-block' }} />;

/* ------------------------------------------------------------------ header */

type Vital = { label: string; value: string; sub: string; tone: Tone; tab: string };

export function vitals(d: NonNullable<ReturnType<typeof useService>>): Vital[] {
  const out: Vital[] = [];
  if (d.app) {
    const ok = d.app.health === 'Healthy';
    out.push({ label: 'Health', value: d.app.health, sub: `Argo CD · ${d.app.sync === 'Synced' ? 'synced' : 'out of sync'}`, tone: ok ? 'ok' : 'bad', tab: 'live' });
  }
  if (d.live) {
    const ready = d.live.pods.filter(p => p.ready).length;
    const restarts = d.live.pods.reduce((t, p) => t + p.restarts24h, 0);
    out.push({ label: 'Pods', value: `${ready} / ${d.live.pods.length}`, sub: `${restarts} restarts in 24 h`, tone: ready === d.live.pods.length ? 'ok' : 'bad', tab: 'live' });
  }
  const hosts = (d.network?.hosts ?? []).filter(h => h.namespace === d.namespace);
  if (d.network) {
    if (hosts.length) {
      const tls = hosts.every(h => h.tls);
      out.push({ label: 'Reached', value: tls ? 'TLS' : 'No TLS', sub: d.certDays !== undefined ? `certificate ${d.certDays} days` : hosts[0].host, tone: tls && (d.certDays ?? 99) >= 21 ? 'ok' : 'warn', tab: 'user-journey' });
    } else {
      out.push({ label: 'Reached', value: 'Internal', sub: 'no published host', tone: 'off', tab: 'user-journey' });
    }
  }
  if (d.ns) {
    const t: Record<string, Tone> = { open: 'warn', partial: 'info', isolated: 'ok' };
    const v: Record<string, string> = { open: 'Open', partial: 'Partial', isolated: 'Isolated' };
    out.push({ label: 'Isolation', value: v[d.ns.isolation], sub: d.ns.isolation === 'open' ? 'any namespace reaches it' : `${d.ns.policies.length} policies`, tone: t[d.ns.isolation], tab: 'network' });
  }
  if (d.images.length) {
    const t = totals(d.findings);
    let tone: Tone = 'ok';
    if (t.critical || t.kev) tone = 'bad';
    else if (t.high) tone = 'warn';
    let value = 'None';
    if (t.critical) value = `${t.critical} critical`;
    else if (t.high) value = `${t.high} high`;
    out.push({ label: 'Findings', value, sub: `${t.kev} known exploited · ${d.images.length} images`, tone, tab: 'security' });
  }
  if (d.week) out.push({ label: 'Cost 7 d', value: d.money(d.week.total), sub: 'estimate, our prices', tone: 'off', tab: 'costs' });
  return out;
}

/** Sync with git and restart a workload, through Argo CD; only the groups of console.actions.groups. */
const ActionsPanel = () => {
  const d = useService();
  const actions = useActions(d ? stringifyEntityRef(d.entity) : undefined);
  const [pending, setPending] = useState<{ text: string; go: () => Promise<void> } | undefined>();
  const [result, setResult] = useState<{ ok: boolean; text: string } | undefined>();
  if (!d) return null;
  const app = d.app?.name;
  const info = actions.data;
  const ask = (text: string, go: () => Promise<void>) => {
    setResult(undefined);
    setPending({ text, go });
  };
  const confirm = async () => {
    if (!pending) return;
    const p = pending;
    setPending(undefined);
    try {
      await p.go();
      setResult({ ok: true, text: 'Done. Argo CD carries it out; it is in the log of actions (Changes).' });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <Box sx={{ mx: '22px', mb: 1.75, border: 1, borderColor: 'divider', borderRadius: '10px', p: 1.5, display: 'grid', gap: 1.25, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary">
        Actions go through Argo CD. Allowed: {info?.groups.join(', ') ?? 'backstage-admin'}
        {info?.owners ? ', and the owner of this service on its own namespace' : ' (the owner of each service: not enabled yet)'}.
      </Typography>
      {info && !info.allowed && <Typography variant="body2">{info.configured ? 'You are not in those groups: the actions are shown but not available to you.' : 'Argo CD is not configured in this portal.'}</Typography>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="text" disabled={!info?.allowed || !app} onClick={() => app && ask(`Sync ${app} with git now?`, () => actions.run('sync', { app }))} sx={{ textTransform: 'none', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
          Sync with git
        </Button>
        {(d.workloads?.workloads ?? []).map(w => (
          <Button
            key={`${w.kind}/${w.name}`}
            variant="text"
            disabled={!info?.allowed || !app || !d.namespace}
            onClick={() => app && d.namespace && ask(`Restart ${w.kind} ${w.name}? Kubernetes replaces its pods one by one.`, () => actions.run('restart', { app, namespace: d.namespace!, kind: w.kind, name: w.name }))}
            sx={{ textTransform: 'none', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}
          >
            Restart {w.name}
          </Button>
        ))}
        <Button variant="text" disabled sx={{ textTransform: 'none', border: '1px dashed', borderColor: 'divider' }} title="Through git: a change of its values, reviewed like any other">
          Scale · Suspend (through git)
        </Button>
      </Box>
      {pending && (
        <Box role="alertdialog" aria-label="Confirm" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', bgcolor: TONES.warn.bg, borderRadius: '8px', p: 1.25 }}>
          <Typography sx={{ flex: '1 1 260px' }}>{pending.text}</Typography>
          <Button variant="contained" onClick={confirm} sx={{ textTransform: 'none' }}>
            Confirm
          </Button>
          <Button variant="text" onClick={() => setPending(undefined)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
        </Box>
      )}
      {result && (
        <Typography role="status" sx={{ bgcolor: result.ok ? TONES.ok.bg : TONES.bad.bg, color: result.ok ? TONES.ok.fg : TONES.bad.fg, borderRadius: '8px', p: 1.25 }}>
          {result.text}
        </Typography>
      )}
    </Box>
  );
};

/** The header of a service in the console: identity, vital signs (each opens its tab), actions. */
export const ServiceHeader = () => {
  const d = useService();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!d) return null;
  const e = d.entity;
  const s = spec(e);
  const kind = classify(e);
  const initials = (e.metadata.title ?? e.metadata.name).replace(/[^A-Za-z0-9 -]/g, '').split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const pal = kind === 'business' ? rq.biz : rq.svc;
  const v = vitals(d);
  const stage = e.metadata.annotations?.['refresquito.io/stage'];
  return (
    <Paper variant="outlined" component="section" aria-label={e.metadata.title ?? e.metadata.name} sx={{ borderRadius: '14px', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', p: '20px 22px 16px' }}>
        <Box sx={{ width: 52, height: 52, borderRadius: '12px', bgcolor: pal.bg, color: pal.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
          {initials || '·'}
        </Box>
        <Box sx={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 0.75 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Typography variant="h4" component="h1" sx={{ fontSize: 26, fontWeight: 600 }}>
              {e.metadata.title ?? e.metadata.name}
            </Typography>
            {kind === 'business' && <Badge label="Business application" bg={rq.biz.bg} fg={rq.biz.fg} />}
            {kind === 'service' && <Badge label="Refresquito service" bg={rq.svc.bg} fg={rq.svc.fg} />}
            {stage && <Badge outlined label={stage} />}
            {s.lifecycle && <Badge outlined label={s.lifecycle} />}
          </Box>
          {e.metadata.description && (
            <Typography color="text.secondary" sx={{ maxWidth: '75ch' }}>
              {e.metadata.description}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 13, color: 'text.secondary' }}>
            {s.owner && <span>Owner {s.owner.replace(/^group:(default\/)?/, '')}</span>}
            {s.system && <span>System {s.system}</span>}
            {d.namespace && (
              <span>
                Namespace <Link to={`/console/namespaces/${d.namespace}`}>{d.namespace}</Link>
              </span>
            )}
            {d.ns?.segment && <span>Segment {d.ns.segment}</span>}
            <ClassicLink path={entityPath(e)} />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Button component="a" href={`/console/ops-assistant${s.system ? `?system=${encodeURIComponent(s.system)}` : ''}`} variant="text" sx={{ textTransform: 'none', border: '1px solid', borderColor: 'divider' }}>
            Ask the ops assistant
          </Button>
          <Button variant="text" onClick={() => setOpen(o => !o)} aria-expanded={open} sx={{ textTransform: 'none', border: '1px solid', borderColor: 'divider' }}>
            Actions ▾
          </Button>
        </Box>
      </Box>
      {open && <ActionsPanel />}
      {v.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', borderTop: 1, borderColor: 'divider' }}>
          {v.map(x => (
            <Box
              key={x.label}
              component="button"
              type="button"
              onClick={() => navigate(`${d.base}/${x.tab}`)}
              sx={{ display: 'grid', gap: 0.5, justifyItems: 'start', textAlign: 'left', p: '12px 16px', border: 0, borderRight: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Typography variant="caption" color="text.secondary">
                {x.label}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 18, fontWeight: 600 }}>
                <Dot tone={x.tone} />
                {x.value}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {x.sub}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
};

const noChanges = (since?: string) =>
  since ? `No new image since this portal records them (${new Date(since).toLocaleDateString()}).` : 'No new image in the last two months.';

/** registry/repo:tag with a digest tag cut to 12 characters, to read it in a table */
export const shortImage = (ref: string) => ref.replace(/^[^/]+\.[^/]+\//, '').replace(/:([0-9a-f]{12})[0-9a-f]{28}$/, ':$1');

/* ------------------------------------------------------------------ overview */

const AttentionList = ({ items, base }: { items: Attention[]; base: string }) => {
  const navigate = useNavigate();
  if (!items.length) return <Typography color="text.secondary">Nothing: it runs, it is reached and its images have no high findings.</Typography>;
  return (
    <Box sx={{ display: 'grid' }}>
      {items.map((a, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.25, alignItems: 'center', py: 1, borderTop: i ? 1 : 0, borderColor: 'divider', flexWrap: 'wrap' }}>
          <Badge label={{ bad: 'Problem', warn: 'Warning', info: 'Notice', ok: 'OK', off: '' }[a.tone]} {...TONES[a.tone]} />
          <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
            <Box component="button" type="button" onClick={() => navigate(`${base}/${a.tab}`)} sx={{ border: 0, bgcolor: 'transparent', p: 0, font: 'inherit', fontWeight: 600, color: rq.primary, cursor: 'pointer', textAlign: 'left' }}>
              {a.title}
            </Box>
            {a.detail && (
              <Typography variant="body2" color="text.secondary">
                {a.detail}
              </Typography>
            )}
          </Box>
          <Link to={`${base}/incidents`}>Open incident</Link>
        </Box>
      ))}
    </Box>
  );
};

const DayBars = ({ days }: { days: number[] }) => {
  const max = Math.max(...days, 0.0001);
  return (
    <Box role="img" aria-label={`Cost per day: ${days.map(x => x.toFixed(2)).join(', ')}`} sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))`, gap: 0.75, alignItems: 'end', height: 64 }}>
      {days.map((x, i) => (
        <Box key={i} sx={{ height: `${Math.max(4, (x / max) * 64)}px`, borderRadius: '4px 4px 0 0', bgcolor: i === days.length - 1 ? rq.primary : '#B9D3EA' }} />
      ))}
    </Box>
  );
};

/** The Overview of a service in the console: how it is reached, what needs attention, changes, what it is built on, cost, data. */
export const ServiceOverview = () => {
  const d = useService();
  const changes = useNamespaceChanges(d?.namespace);
  const ov = useClusterOverview();
  if (!d) return null;
  const e = d.entity;
  const hosts = (d.network?.hosts ?? []).filter(h => h.namespace === d.namespace);
  const ready = d.live ? d.live.pods.filter(p => p.ready).length : undefined;
  const allTls = hosts.length > 0 && hosts.every(h => h.tls);
  let ingress: [string, Tone] = ['Not published', 'info'];
  if (hosts.length) ingress = [`Traefik · ${allTls ? 'TLS' : 'no TLS'}`, allTls ? 'ok' : 'warn'];
  let pods: [string, Tone] = ['pods', 'off'];
  if (d.live) pods = [`${ready} / ${d.live.pods.length} pods`, ready === d.live.pods.length ? 'ok' : 'bad'];
  const chips: Array<[string, Tone]> = [['Browser', 'off'], ['VNF · VIP', 'off'], ingress, ['Keycloak', 'ok'], pods];
  const deps = (e.relations ?? []).filter(r => r.type === 'dependsOn').map(r => r.targetRef);
  const volumes = (ov.data?.volumes ?? []).filter(v => v.namespace === d.namespace);
  const ann = e.metadata.annotations ?? {};
  const source = ann['backstage.io/source-location']?.replace(/^url:/, '');
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 2, alignItems: 'start' }}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Section title="How users reach it now" action={<Link to={`${d.base}/user-journey`}>Every step</Link>}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
            {chips.map(([label, tone], i) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, border: 1, borderColor: 'divider', borderRadius: 999, px: 1.25, py: 0.5, fontSize: 13, bgcolor: 'background.paper' }}>
                  <Dot tone={tone} />
                  {label}
                </Box>
                {i < chips.length - 1 && (
                  <Box component="span" aria-hidden sx={{ color: 'text.secondary' }}>
                    →
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Section>
        <Section title="Needs attention">
          <AttentionList items={serviceAttention(d)} base={d.base} />
        </Section>
        <Section title="Latest changes" action={<Link to={`${d.base}/changes`}>History</Link>}>
          {changes.changes?.length ? (
            changes.changes.slice(0, 3).map(c => (
              <Box key={c.image + c.at} sx={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  {new Date(c.at).toLocaleDateString()}
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{c.image}</Typography>
              </Box>
            ))
          ) : (
            <Typography color="text.secondary">{changes.error ?? (changes.loading ? 'Reading…' : noChanges(changes.since))}</Typography>
          )}
        </Section>
      </Box>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Section title="Built on" sub="what it depends on, from the catalog">
          {deps.length ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {deps.map(ref => {
                const [k, rest] = ref.split(':');
                const [n, name] = rest.split('/');
                return (
                  <Link key={ref} to={`/console/entity/${n}/${k}/${name}`} style={{ background: rq.svc.bg, color: rq.svc.fg, borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
                    {name}
                  </Link>
                );
              })}
            </Box>
          ) : (
            <Typography color="text.secondary">The catalog does not say what it depends on.</Typography>
          )}
        </Section>
        {d.week && (
          <Section title="Cost" sub="last 7 days · estimate with our prices" action={<Link to={`${d.base}/costs`}>Where it goes</Link>}>
            <Typography sx={{ fontSize: 28, fontWeight: 600 }}>{d.money(d.week.total)}</Typography>
            {d.week.days.length > 1 && <DayBars days={d.week.days} />}
          </Section>
        )}
        <Section title="Data and backups">
          {volumes.length ? (
            volumes.map(v => (
              <Box key={v.pvc} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', py: 0.5 }}>
                <Typography sx={{ flex: '1 1 160px', fontWeight: 600 }}>{v.pvc}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {bytes(v.requestedBytes)}
                  {v.usedBytes !== undefined && v.capacityBytes ? ` · ${Math.round((v.usedBytes / v.capacityBytes) * 100)}% used` : ''}
                </Typography>
                <Badge outlined label={v.storageClass === 'longhorn-retain' ? 'kept if deleted' : v.storageClass ?? '—'} />
              </Box>
            ))
          ) : (
            <Typography color="text.secondary">No volume: it keeps no data of its own.</Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            How it is backed up and restored: its disaster recovery plan in <Link to={`${d.base}/docs`}>Docs</Link>.
          </Typography>
        </Section>
        <Section title="Links">
          {source && (
            <a href={source} target="_blank" rel="noreferrer" style={{ color: rq.primary }}>
              Repository
            </a>
          )}
          <Link to={`${d.base}/docs`}>TechDocs</Link>
          <Link to={`${d.base}/api`}>API</Link>
          <Link to={`${d.base}/ci-cd`}>CI/CD</Link>
        </Section>
      </Box>
    </Box>
  );
};

/* ------------------------------------------------------------------ changes */

export const ServiceChanges = () => {
  const d = useService();
  const changes = useNamespaceChanges(d?.namespace);
  const actions = useActions(d ? stringifyEntityRef(d.entity) : undefined);
  if (!d) return null;
  const mine = (actions.data?.log ?? []).filter(a => (d.namespace && a.target.includes(d.namespace)) || (d.app && a.target.includes(d.app.name)));
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 2, alignItems: 'start' }}>
      <Section title="Images deployed" sub="every new version seen running, the last two months">
        {changes.changes?.length ? (
          <Table head={['When', 'Image']} rows={changes.changes.map(c => [new Date(c.at).toLocaleString(), <span style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{c.image}</span>])} />
        ) : (
          <Typography color="text.secondary">{changes.error ?? (changes.loading ? 'Reading…' : noChanges(changes.since))}</Typography>
        )}
      </Section>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Section title="Git and Argo CD">
          {d.app ? (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge label={d.app.sync} {...(d.app.sync === 'Synced' ? TONES.ok : TONES.warn)} />
              <Badge label={d.app.health} {...(d.app.health === 'Healthy' ? TONES.ok : TONES.bad)} />
              {d.app.autosync && <Badge outlined label="syncs by itself" />}
              <Link to={`${d.base}/ci-cd`}>Its deployments in Argo CD</Link>
            </Box>
          ) : (
            <Typography color="text.secondary">Argo CD has no application for it.</Typography>
          )}
        </Section>
        <Section title="Actions from the console">
          {mine.length ? (
            <Table head={['When', 'Who', 'What', 'Result']} rows={mine.map(a => [new Date(a.at).toLocaleString(), a.user.replace(/^user:default\//, ''), `${a.action} ${a.target}`, <Badge label={a.result} {...(a.result === 'done' ? TONES.ok : TONES.bad)} />])} />
          ) : (
            <Typography color="text.secondary">{actions.data?.allowed ? 'None since this portal started.' : 'Only the groups that can act see this log.'}</Typography>
          )}
        </Section>
      </Box>
    </Box>
  );
};

/* ------------------------------------------------------------------ security */

export const ServiceSecurity = () => {
  const d = useService();
  if (!d) return null;
  const t = totals(d.findings);
  const box = (n: number, label: string, tone: Tone) => (
    <Box sx={{ display: 'grid', gap: 0.25, p: 1.25, borderRadius: '10px', bgcolor: TONES[tone].bg, color: TONES[tone].fg }}>
      <Typography sx={{ fontSize: 22, fontWeight: 600 }}>{n}</Typography>
      <Typography variant="caption">{label}</Typography>
    </Box>
  );
  const hosts = (d.network?.hosts ?? []).filter(h => h.namespace === d.namespace);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 2, alignItems: 'start' }}>
      <Section title="Vulnerabilities in its images" sub="scans of Wazuh, read through the SBOM">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
          {box(t.critical, 'Critical', t.critical ? 'bad' : 'off')}
          {box(t.high, 'High', t.high ? 'warn' : 'off')}
          {box(t.medium, 'Medium', 'off')}
          {box(t.low, 'Low', 'off')}
        </Box>
        <Typography variant="body2" color="text.secondary">
          {t.kev} known exploited (KEV). Details and fixes: <Link to={`${d.base}/sbom`}>SBOM</Link> · <Link to={`${d.base}/quality`}>Quality & Security</Link>
        </Typography>
      </Section>
      <Section title="By image">
        {d.findings.length ? (
          <Table
            head={['Image', 'Critical', 'High', 'Scan']}
            rows={d.findings.map(f => [
              <span title={f.image} style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{shortImage(f.image)}</span>,
              String(f.counts.CRITICAL ?? 0),
              String(f.counts.HIGH ?? 0),
              f.error ? <Badge label={f.error} {...TONES.off} /> : <Badge label="Scanned" {...TONES.ok} />,
            ])}
          />
        ) : (
          <Typography color="text.secondary">No image known for it.</Typography>
        )}
      </Section>
      <Section title="Exposure and access">
        <Table
          head={['', '']}
          rows={[
            ['Published host', hosts.length ? <Badge label={hosts.every(h => h.tls) ? 'TLS' : 'Some without TLS'} {...(hosts.every(h => h.tls) ? TONES.ok : TONES.warn)} /> : <Badge label="Internal" {...TONES.info} />],
            ['Network isolation', d.ns ? <Badge label={d.ns.isolation} {...(d.ns.isolation === 'open' ? TONES.warn : TONES.ok)} /> : '—'],
            ['Who can do what', <Link to={`${d.base}/access`}>Access (Keycloak)</Link>],
          ]}
        />
      </Section>
    </Box>
  );
};

/* ------------------------------------------------------------------ costs */

const weekMessage = (s?: { loading: boolean; error?: string }) => {
  if (s?.loading) return 'Reading OpenCost… it can take a couple of minutes for a week.';
  if (s?.error) return `OpenCost did not answer: ${s.error}`;
  return 'OpenCost has no cost for its namespace yet.';
};

export const ServiceCosts = () => {
  const d = useService();
  if (!d) return null;
  const w = d.week;
  const parts: Array<[string, number, string]> = w ? [['CPU', w.cpu, rq.primary], ['Memory', w.ram, '#1A8DFF'], ['Disk', w.disk, '#7FB2E5']] : [];
  const max = Math.max(...parts.map(p => p[1]), 0.0001);
  // reserved and not used is paid all the same: the pods whose memory request is far above what they use
  const idle = (d.live?.pods ?? []).filter(p => p.memory !== undefined && p.memoryRequest && p.memory < p.memoryRequest * 0.4 && p.memoryRequest - p.memory > 64 * 2 ** 20);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 2, alignItems: 'start' }}>
      <Section title={w ? `Where the ${d.money(w.total)} of the week go` : 'Cost of the week'} sub="OpenCost, our prices: an estimate, not a bill">
        {w ? (
          <>
            {parts.map(([label, v, color]) => (
              <Box key={label} sx={{ display: 'grid', gridTemplateColumns: '90px 1fr 80px', gap: 1.25, alignItems: 'center' }}>
                <span>{label}</span>
                <Box sx={{ height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${(v / max) * 100}%`, bgcolor: color }} />
                </Box>
                <Typography sx={{ textAlign: 'right', fontWeight: 600 }}>{d.money(v)}</Typography>
              </Box>
            ))}
            {w.days.length > 1 && <DayBars days={w.days} />}
            <Typography variant="body2" color="text.secondary">
              Deployments, incidents and assistants are added in <Link to="/console/costs">Costs</Link>.
            </Typography>
          </>
        ) : (
          <Typography color="text.secondary">{weekMessage(d.weekState)}</Typography>
        )}
      </Section>
      <Section title="Could cost less">
        {idle.length ? (
          idle.map(p => (
            <Typography key={p.name} variant="body2">
              <b>{p.name}</b> reserves {bytes(p.memoryRequest!)} of memory and uses {bytes(p.memory!)}: its request could be lower.
            </Typography>
          ))
        ) : (
          <Typography color="text.secondary">Its pods use most of what they reserve: nothing to change.</Typography>
        )}
      </Section>
    </Box>
  );
};
