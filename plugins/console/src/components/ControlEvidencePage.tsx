import { Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_REASON, productTitle, useRequestActions, validReason, type AccessRequest } from '../accessAdmin';
import { csv, findingLink, ofKind, reportCsv, save, useEvidence, useEvidenceFetch, type Activity, type ActivityKind, type Approvals, type Finding, type Overview, type Report } from '../evidence';
import { useI18n } from '../i18n';
import { usePortalPermissions } from '../portalPermissions';
import { useRq } from '../theme/consoleTheme';
import { Attention, EmptyState, Id, Kpis, Pill, Section, TitleRow, type Tone } from './ui';
import { PageTabs, useTab } from './ZoneInventoryPages';

const TABS = ['overview', 'activity', 'report', 'approvals'] as const;
type TabId = (typeof TABS)[number];
const KINDS: Array<ActivityKind | 'all'> = ['all', 'access', 'approval', 'refused'];
const FINDING_TONE: Record<Finding['tone'], Tone> = { bad: 'neg', warn: 'warn', info: 'info' };
const KIND_TONE: Record<ActivityKind, Tone> = { access: 'info', approval: 'pos', refused: 'neg' };
const who = (ref?: string) => (ref ?? '').replace(/^user:[^/]+\//, '');

type Notice = { tone: 'pos' | 'neg'; text: string };

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => {
  const rq = useRq();
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', '& th': { textAlign: 'left', fontWeight: 500, fontSize: 12, color: 'text.secondary', px: 2.25, pb: 1 }, '& td': { px: 2.25, py: 1.25, borderTop: `1px solid ${rq.rule}`, verticalAlign: 'top' } }}>
        <thead>
          <tr>
            {head.map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </Box>
    </Box>
  );
};

/** Choices in a row, one pressed. */
const Chips = <T extends string>({ items, value, onChange, label }: { items: Array<[T, string]>; value: T; onChange: (v: T) => void; label: string }) => {
  const rq = useRq();
  return (
    <Box role="group" aria-label={label} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {items.map(([k, text]) => (
        <ButtonBase key={k} aria-pressed={value === k} onClick={() => onChange(k)} sx={{ height: 28, px: 1.5, borderRadius: 999, fontSize: 13, border: `1px solid ${value === k ? rq.ink : rq.control}`, bgcolor: value === k ? rq.ink : 'transparent', color: value === k ? rq.sheet : rq.ink }}>
          {text}
        </ButtonBase>
      ))}
    </Box>
  );
};

const Failed = ({ error }: { error?: string }) => {
  const { t } = useI18n();
  return (
    <EmptyState tone="neg" title={t('ev.error')}>
      {error}
    </EmptyState>
  );
};

const OverviewTab = () => {
  const { t } = useI18n();
  const { loading, data, error } = useEvidence<Overview>('/overview');
  if (loading && !data) return <Progress />;
  if (!data) return <Failed error={error} />;
  const what = (f: Finding) => t(`ev.finding.${f.kind}.what`, { subject: f.subject ? productTitle(f.subject) : '', count: f.count, names: f.names.join(', '), recent: f.recent ?? 0, days: f.kind === 'inactive' ? data.inactiveDays : data.recentDays });
  const why = (f: Finding) => t(`ev.finding.${f.kind}.why`, { names: f.names.join(', '), more: Math.max(0, f.count - f.names.length) });
  return (
    <>
      <Kpis
        items={[
          { label: t('ev.kpi.atRisk'), value: data.kpis.atRisk, tone: data.kpis.atRisk ? 'bad' : 'good' },
          { label: t('ev.kpi.inactive'), value: data.signIns ? data.kpis.inactive : '—', note: data.signIns ? t('ev.kpi.inactive.note', { days: data.inactiveDays }) : t('ev.kpi.inactive.unknown') },
          { label: t('ev.kpi.approvals'), value: data.kpis.approvals, tone: data.kpis.approvals ? 'bad' : undefined },
          { label: t('ev.kpi.changes'), value: data.kpis.changesWeek },
        ]}
      />
      <Section title={t('ev.findings')}>
        {!data.findings.length && <Typography color="text.secondary">{t('ev.findings.none')}</Typography>}
        <Attention items={data.findings.map(f => ({ tone: FINDING_TONE[f.tone], label: t(`ev.finding.${f.kind}`), what: what(f), why: why(f), action: { label: t('ev.finding.review'), to: findingLink(f) } }))} />
      </Section>
      {!data.signIns && (
        <Typography variant="caption" color="text.secondary">
          {t('ev.signIns.off', { days: data.minInactiveDays })}
        </Typography>
      )}
    </>
  );
};

const ActivityTab = () => {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const { loading, data, error } = useEvidence<{ recorded: boolean; activity: Activity[] }>('/activity');
  if (loading && !data) return <Progress />;
  if (!data) return <Failed error={error} />;
  const asked = params.get('kind') as ActivityKind | 'all' | null;
  const kind = asked && KINDS.includes(asked) ? asked : 'all';
  const shown = ofKind(data.activity, kind);
  const said = (a: Activity) => t(`ev.act.${a.kind}.${a.action}`, { user: a.username, group: a.group, by: a.note ?? '' });
  const pick = (k: ActivityKind | 'all') => {
    const next = new URLSearchParams(params);
    next.set('kind', k);
    setParams(next, { replace: true });
  };
  const exported = () =>
    save(
      `portal-activity-${new Date().toISOString().slice(0, 10)}.csv`,
      csv(['when', 'who', 'kind', 'what', 'product'], shown.map(a => [a.at, a.who, a.kind, said(a), a.component])),
    );
  return (
    <Section
      flush={shown.length > 0}
      title={t('ev.activity')}
      meta={t('ev.activity.meta')}
      action={
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chips label={t('ev.activity.kind')} items={KINDS.map(k => [k, t(`ev.kind.${k}`)])} value={kind} onChange={pick} />
          <Button size="small" variant="outlined" disabled={!shown.length} onClick={exported}>
            {t('ev.export')}
          </Button>
        </Box>
      }
    >
      {!data.recorded && <EmptyState tone="neg" title={t('ev.activity.off')} />}
      {data.recorded && !shown.length && <Typography color="text.secondary">{t('ev.activity.none')}</Typography>}
      {shown.length > 0 && (
        <Table head={[t('ev.col.when'), t('ev.col.who'), t('ev.col.kind'), t('ev.col.what'), t('ev.col.where')]}>
          {shown.map((a, i) => (
            <tr key={`${a.at}-${i}`}>
              <Box component="td" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(a.at).toLocaleString(lang)}
              </Box>
              <td>{a.who}</td>
              <td>
                <Pill tone={KIND_TONE[a.kind]} plain>
                  {t(`ev.kind.${a.kind}`)}
                </Pill>
              </td>
              <td>{said(a)}</td>
              <td>{a.component ? productTitle(a.component) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
};

const ReportTab = ({ admin }: { admin: boolean }) => {
  const { t, lang } = useI18n();
  const rq = useRq();
  const [params, setParams] = useSearchParams();
  const call = useEvidenceFetch();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const snapshot = params.get('snapshot') ?? '';
  const by = params.get('by') === 'person' ? 'person' : 'product';
  const { loading, data, error, reload } = useEvidence<Report>(snapshot ? `/report?snapshot=${encodeURIComponent(snapshot)}` : '/report');
  if (loading && !data) return <Progress />;
  if (!data) return <Failed error={error} />;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const when = (at: string) => new Date(at).toLocaleString(lang);
  const take = () => {
    setBusy(true);
    setNotice(undefined);
    call('/snapshots', { method: 'POST' })
      .then(
        () => {
          setNotice({ tone: 'pos', text: t('ev.report.taken') });
          reload();
        },
        e => setNotice({ tone: 'neg', text: (e as Error).message }),
      )
      .finally(() => setBusy(false));
  };
  const state = data.of.state;
  return (
    <>
      <Section
        flush
        title={t('ev.report')}
        meta={data.of.live ? t('ev.report.live') : t('ev.report.asOf', { when: when(data.of.at) })}
        action={
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField select size="small" label={t('ev.report.date')} value={snapshot} onChange={e => set('snapshot', e.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="">{t('ev.report.now')}</MenuItem>
              {data.snapshots.map(s => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {when(s.at)}
                </MenuItem>
              ))}
            </TextField>
            <Chips
              label={t('ev.report.by')}
              items={[
                ['product', t('ev.report.byProduct')],
                ['person', t('ev.report.byPerson')],
              ]}
              value={by}
              onChange={v => set('by', v === 'person' ? 'person' : '')}
            />
            <Button size="small" variant="contained" onClick={() => save(`access-report-${data.of.at.slice(0, 10)}-${by}.csv`, reportCsv(data, by))}>
              {t('ev.report.export')}
            </Button>
          </Box>
        }
      >
        {by === 'product' ? (
          <Table head={[t('ev.col.product'), t('ev.col.group'), t('ev.col.people'), t('ev.col.members')]}>
            {data.rows.map(r => (
              <tr key={`${r.component}/${r.group}`}>
                <td>{productTitle(r.component)}</td>
                <td>
                  <Id>{r.group}</Id>
                </td>
                <Box component="td" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {r.members.length}
                </Box>
                <td>{r.members.join(', ') || '—'}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table head={[t('ev.col.person'), t('ev.col.held'), t('ev.col.groups')]}>
            {data.people.map(p => (
              <tr key={p.username}>
                <td>{p.username}</td>
                <Box component="td" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {p.groups.length}
                </Box>
                <td>
                  <Id>{p.groups.join(', ')}</Id>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Box sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', p: 2.25, display: 'grid', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box component="b" sx={{ fontWeight: 500 }}>
            {t('ev.evidence')}
          </Box>
          {state === 'ok' && <Pill tone="pos">{t('ev.evidence.ok')}</Pill>}
          {state === 'unsigned' && <Pill tone="warn">{t('ev.evidence.unsigned')}</Pill>}
          {state === 'altered' && <Pill tone="neg">{t('ev.evidence.altered')}</Pill>}
          {admin && data.kept && (
            <Button size="small" variant="outlined" disabled={busy} onClick={take} sx={{ ml: 'auto' }}>
              {t('ev.report.take')}
            </Button>
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">
          {data.kept ? t(data.signs ? 'ev.evidence.signed' : 'ev.evidence.digestOnly') : t('ev.evidence.off')}
        </Typography>
        {data.of.digest && (
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {t('ev.evidence.digest', { by: who(data.of.takenBy) || 'system' })} <Id>{data.of.digest}</Id>
          </Typography>
        )}
        {notice && (
          <Box role="status">
            <Pill tone={notice.tone}>{notice.text}</Pill>
          </Box>
        )}
      </Box>
    </>
  );
};

const ApprovalsTab = () => {
  const { t, lang } = useI18n();
  const actions = useRequestActions();
  const { loading, data, error, reload } = useEvidence<Approvals>('/approvals');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [rejecting, setRejecting] = useState<number>();
  const [reason, setReason] = useState('');
  if (loading && !data) return <Progress />;
  if (!data) return <Failed error={error} />;
  const when = (at?: string) => (at ? new Date(at).toLocaleString(lang) : '');
  const run = (work: Promise<unknown>, done: string) => {
    setBusy(true);
    setNotice(undefined);
    work
      .then(
        () => {
          setNotice({ tone: 'pos', text: done });
          setRejecting(undefined);
          setReason('');
          reload();
        },
        e => setNotice({ tone: 'neg', text: (e as Error).message }),
      )
      .finally(() => setBusy(false));
  };
  const asked = (r: AccessRequest) => (
    <>
      <Box component="b" sx={{ fontWeight: 500, display: 'block' }}>
        {t('ev.approval.what', { user: r.requester, group: r.group })}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {productTitle(r.component)}
      </Typography>
    </>
  );
  const decision = (r: AccessRequest) => {
    if (r.state !== 'pending') {
      return (
        <>
          <Pill tone={r.state === 'approved' ? 'pos' : 'neu'} plain>
            {t(`ev.approval.${r.state}`, { by: who(r.decidedBy) })}
          </Pill>
          {r.answer && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {r.answer}
            </Typography>
          )}
        </>
      );
    }
    // an administrator of the portal other than who proposed it and than the person added
    const mine = data.me === r.proposedBy || who(data.me) === r.requester;
    if (!data.decides || mine) return <Pill tone="warn" plain>{t(mine ? 'ev.approval.another' : 'ev.approval.waiting')}</Pill>;
    if (rejecting === r.id) {
      return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField id={`reject-${r.id}`} size="small" label={t('req.reject.why')} value={reason} onChange={e => setReason(e.target.value)} inputProps={{ maxLength: MAX_REASON }} sx={{ flex: '1 1 220px', minWidth: 0 }} />
          <Button size="small" variant="contained" disabled={busy || !validReason(reason)} onClick={() => run(actions.reject(r.id, reason), t('req.done.rejected', { user: r.requester, group: r.group }))}>
            {t('req.reject')}
          </Button>
          <Button size="small" disabled={busy} onClick={() => setRejecting(undefined)}>
            {t('req.cancel')}
          </Button>
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" variant="contained" disabled={busy} onClick={() => run(actions.approve(r.id), t('req.done.approved', { user: r.requester, group: r.group }))}>
          {t('req.approve')}
        </Button>
        <Button size="small" disabled={busy} onClick={() => setRejecting(r.id)}>
          {t('req.reject')}
        </Button>
      </Box>
    );
  };
  const all = [...data.pending, ...data.decided];
  return (
    <Section title={t('ev.approvals')} flush={all.length > 0} foot={notice && <Pill tone={notice.tone}>{notice.text}</Pill>}>
      <Typography color="text.secondary" sx={all.length ? { px: 2.25, pb: 1.5 } : { pb: 1 }}>
        {t('ev.approvals.rule')}
      </Typography>
      {!data.kept && <EmptyState tone="neg" title={t('ev.approvals.off')} />}
      {data.kept && !all.length && <Typography color="text.secondary">{t('ev.approvals.none')}</Typography>}
      {all.length > 0 && (
        <Table head={[t('ev.col.asked'), t('ev.col.by'), t('ev.col.request'), t('ev.col.decision')]}>
          {all.map(r => (
            <tr key={r.id}>
              <Box component="td" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {when(r.at)}
              </Box>
              <td>{who(r.proposedBy)}</td>
              <td>{asked(r)}</td>
              <td>{decision(r)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
};

/**
 * Portal › Administration › Control and evidence: who did what in the portal, who has access to what, and what needs a
 * decision. Four tabs (?tab=): what needs attention, the activity recorded, the report of access now and at each
 * signed snapshot, and the double approvals. Read by the administrators of the portal, the security team and the
 * auditors; only the administrators act, and what they act on opens in Access administration.
 */
export const ControlEvidencePage = () => {
  const { t } = useI18n();
  const admin = Boolean(usePortalPermissions().permissions?.roles.includes('admin'));
  const [tab, setTab] = useTab<TabId>(TABS);
  return (
    <>
      <TitleRow crumbs={[['Portal', '/console'], [t('nav.administration')], [t('ev.title')]]} title={t('ev.title')} sub={t('ev.sub')} />
      <PageTabs label={t('ev.title')} tabs={TABS.map(k => [k, t(`ev.tab.${k}`)])} tab={tab} onChange={setTab} />
      <Box sx={{ mt: 2.5 }}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'report' && <ReportTab admin={admin} />}
        {tab === 'approvals' && <ApprovalsTab />}
      </Box>
    </>
  );
};
