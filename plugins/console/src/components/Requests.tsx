import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { PostAnswer } from '../post';
import { type ConsolePull, pullKind } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Table } from './NetworkPage';

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

/** The pull requests of the console waiting for review: merged, the change happens. */
export const PullList = ({ pulls }: { pulls: ConsolePull[] }) =>
  pulls.length === 0 ? null : (
    <Table
      head={['Waiting for review', 'Change', 'Opened']}
      rows={pulls.map(p => [
        <a href={p.url} target="_blank" rel="noopener noreferrer">
          #{p.number}
        </a>,
        <span>
          <Badge label={pullKind(p)} {...TONES.info} /> {p.title.replace(/^console: /, '')}
        </span>,
        new Date(p.created).toLocaleString(),
      ])}
    />
  );
