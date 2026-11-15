import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import type { PostAnswer } from '../post';
import { type ChangePull, PULL_TONE, type PullState, usePulls } from '../pulls';
import { type ConsolePull, lifecycle, pullKind, pullTarget, type ReconcileStatus } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Table } from './NetworkPage';
import { CancelChange } from './PendingChanges';
import { Pill } from './ui';

export type Note = { ok: boolean; text: string; url?: string };

/** The outcome of a change: green with the pull request to review, or red with the reason. */
export const ResultNote = ({ note }: { note?: Note }) =>
  note ? (
    <Typography role="status" sx={{ bgcolor: note.ok ? TONES.ok.bg : TONES.bad.bg, color: note.ok ? TONES.ok.fg : TONES.bad.fg, borderRadius: '8px', p: 1.25 }}>
      {note.text}
      {note.url && (
        <>
          {' '}
          <a href={note.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>
            Review the pull request
          </a>
        </>
      )}
    </Typography>
  ) : null;

/** Run a change and keep its outcome: ok(answer) words the success. */
export function useChange(reload: () => void) {
  const [note, setNote] = useState<Note | undefined>();
  const [busy, setBusy] = useState(false);
  const run = async (go: () => Promise<PostAnswer>, ok: (a: PostAnswer) => string) => {
    setNote(undefined);
    setBusy(true);
    try {
      const a = await go();
      setNote({ ok: true, text: ok(a), url: a.pull?.url });
      reload();
      return true;
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { note, busy, run };
}

/** A yes/no bar before a change that cannot be undone from here. */
export const ConfirmBar = ({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) => (
  <Box role="alertdialog" aria-label="Confirm" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', bgcolor: TONES.warn.bg, borderRadius: '8px', p: 1.25 }}>
    <Typography sx={{ flex: '1 1 260px' }}>{text}</Typography>
    <Button variant="contained" onClick={onYes} sx={{ textTransform: 'none' }}>
      Confirm
    </Button>
    <Button variant="text" onClick={onNo} sx={{ textTransform: 'none' }}>
      Cancel
    </Button>
  </Box>
);

/**
 * Where the requests of the console stand in GitHub (backend GET /api/cluster/pulls of both repositories: the
 * infrastructure and the virtual machines), by the address of the pull request; reload() reads GitHub again.
 */
export function useRequestStates() {
  const infra = usePulls('cluster', '/pulls?repo=infra');
  const vms = usePulls('cluster', '/pulls?repo=vms');
  const byUrl = useMemo(() => new Map<string, PullState>([...infra.pulls, ...vms.pulls].map(p => [p.url, p.state])), [infra.pulls, vms.pulls]);
  // the request as GitHub has it and how to cancel it (in the repository it belongs to)
  const requestOf = (url: string): { pull: ChangePull; cancel: (n: number) => Promise<void> } | undefined => {
    for (const repo of [infra, vms]) {
      const pull = repo.pulls.find(p => p.url === url);
      if (pull) return { pull, cancel: repo.cancel };
    }
    return undefined;
  };
  const reload = () => {
    infra.reload();
    vms.reload();
  };
  return { byUrl, requestOf, loading: infra.loading || vms.loading, readAt: infra.readAt ?? vms.readAt, reload };
}
type RequestStates = ReturnType<typeof useRequestStates>;

/** The state of an open request in GitHub (its checks, or that it was accepted or closed meanwhile); nothing when unknown. */
const CheckState = ({ state }: { state?: PullState }) => {
  const { t } = useI18n();
  return state && state !== 'open' ? <Pill tone={PULL_TONE[state]}>{t(`pc.state.${state}`)}</Pill> : null;
};

/** Cancel on an open request the reader may cancel; nothing otherwise. */
const CancelRequest = ({ states, url }: { states: RequestStates; url: string }) => {
  const r = states.requestOf(url);
  return r ? <CancelChange pull={r.pull} onCancel={r.cancel} /> : null;
};

/** Refresh, and when the state of the requests was read. */
const RefreshBar = ({ states }: { states: RequestStates }) => {
  const { t, lang } = useI18n();
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      <Button variant="outlined" size="small" disabled={states.loading} onClick={states.reload} sx={{ textTransform: 'none' }}>
        {t(states.loading ? 'pc.refreshing' : 'pc.refresh')}
      </Button>
      {states.readAt && (
        <Typography variant="caption" color="text.secondary">
          {t('pc.readAt', { time: states.readAt.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}
        </Typography>
      )}
    </Box>
  );
};

/** The pull requests of the console waiting for review: merged, the change happens. */
export const PullList = ({ pulls }: { pulls: ConsolePull[] }) => {
  const states = useRequestStates();
  if (pulls.length === 0) return null;
  return (
    <>
      <RefreshBar states={states} />
      <Table
        head={['Waiting for review', 'Change', 'Opened', 'State']}
        rows={pulls.map(p => [
          <a key="n" href={p.url} target="_blank" rel="noopener noreferrer">
            #{p.number}
          </a>,
          <span key="c">
            <Badge label={pullKind(p)} {...TONES.info} /> {p.title.replace(/^console: /, '')}
          </span>,
          new Date(p.created).toLocaleString(),
          <span key="s">
            <CheckState state={states.byUrl.get(p.url)} />
            <CancelRequest states={states} url={p.url} />
          </span>,
        ])}
      />
    </>
  );
};

/**
 * Every request of the console of the last days, open or merged, with where it is now: waiting for review, merged and
 * waiting for the host, done or failed (from what the host reported).
 */
export const RequestsTable = ({ open, merged, reconcile, only }: { open: ConsolePull[]; merged: ConsolePull[]; reconcile?: ReconcileStatus; only?: (p: ConsolePull) => boolean }) => {
  const states = useRequestStates();
  const rows = [...open, ...merged].filter(p => !only || only(p));
  if (!rows.length) return <Typography color="text.secondary">No request in the last 7 days.</Typography>;
  return (
    <>
    <RefreshBar states={states} />
    <Table
      head={['Request', 'Change', 'Target', 'State']}
      rows={rows.map(p => {
        const l = lifecycle(p, reconcile);
        const t = pullTarget(p);
        return [
          <a href={p.url} target="_blank" rel="noopener noreferrer">
            #{p.number}
          </a>,
          <Badge label={pullKind(p)} {...TONES.info} />,
          t.zone ? `${t.zone}/${t.program ?? ''}${t.name ? ` · ${t.name}` : ''}` : p.title.replace(/^console: /, ''),
          <span>
            <Badge label={l.label} {...TONES[l.tone]} />
            {/* an open request: its checks in GitHub; a merged one is followed by the host, above */}
            {!p.merged && (
              <Box component="span" sx={{ ml: 0.75 }}>
                <CheckState state={states.byUrl.get(p.url)} />
              </Box>
            )}
            {!p.merged && <CancelRequest states={states} url={p.url} />}
            {l.detail && (
              <Typography variant="caption" color="text.secondary" component="div">
                {l.detail}
              </Typography>
            )}
          </span>,
        ];
      })}
    />
    </>
  );
};
