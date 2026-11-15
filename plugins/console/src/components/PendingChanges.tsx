import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { type ChangePull, isPending, orderPulls, PULL_TONE, usePulls } from '../pulls';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { Pill } from './ui';

/** the line under the title: how many wait, or that nothing does, or that nothing was asked for */
function subOf(shown: number, pending: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!shown) return t('pc.sub.empty');
  return pending ? t('pc.sub.pending', { n: pending }) : t('pc.sub.none');
}

const LINK: Record<ChangePull['state'], string> = { ready: 'pc.link.accept', checking: 'pc.link.review', failed: 'pc.link.review', conflict: 'pc.link.review', open: 'pc.link.review', merged: 'pc.link.see', closed: 'pc.link.see' };

/**
 * The changes a page asked for by pull request and where each one stands: checks running or failed, ready to
 * accept, accepted, closed; with the link to review and accept it in GitHub. Read when the page opens and when
 * `refresh` changes (the page has just opened one). Nothing is drawn when there is none, or it cannot be read.
 *
 * - plugin, path: GET /api/<plugin><path> → { pulls } (backend consolePulls.ts)
 * - match: only the branches that start with it (one process, one customer)
 * - applies: what has to happen after accepting for the change to take effect
 * - always: draw the card even with nothing to show (the page whose job is to ask for the change), so the state can
 *   be refreshed right after asking
 */
export const PendingChanges = ({ plugin, path, refresh, match, applies, always }: { plugin: string; path: string; refresh?: unknown; match?: string; applies?: ReactNode; always?: boolean }) => {
  const { t, lang } = useI18n();
  const { pulls, loading, readAt, reload } = usePulls(plugin, path, refresh);
  const shown = orderPulls(pulls, match);
  if (!shown.length && !always) return null;
  const pending = shown.filter(isPending).length;
  const date = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString(lang) : '—');
  const hint = (p: ChangePull) => {
    if (p.state === 'merged') return t('pc.hint.merged', { date: date(p.closed) });
    return p.state === 'ready' || p.state === 'closed' ? undefined : t(`pc.hint.${p.state}`);
  };
  return (
    <Card title={t('pc.title')} sub={subOf(shown.length, pending, t)}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" disabled={loading} onClick={reload}>
          {t(loading ? 'pc.refreshing' : 'pc.refresh')}
        </Button>
        {readAt && (
          <Typography variant="caption" color="text.secondary">
            {t('pc.readAt', { time: readAt.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}
          </Typography>
        )}
      </Box>
      {shown.length > 0 && (
      <Table
        head={[t('pc.col.change'), t('pc.col.by'), t('pc.col.when'), t('pc.col.state'), t('pc.col.link')]}
        rows={shown.map(p => [
          <Box key="c" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {p.title} <Box component="span" sx={{ color: 'text.secondary' }}>#{p.number}</Box>
          </Box>,
          p.by ?? '—',
          date(p.created),
          <Box key="s" sx={{ display: 'grid', gap: 0.25, justifyItems: 'start' }}>
            <Pill tone={PULL_TONE[p.state]}>{t(`pc.state.${p.state}`)}</Pill>
            {hint(p) && (
              <Typography variant="caption" color="text.secondary">
                {hint(p)}
              </Typography>
            )}
          </Box>,
          <Link key="l" to={p.url}>
            {t(LINK[p.state])}
          </Link>,
        ])}
      />
      )}
      {applies && (
        <Typography variant="caption" color="text.secondary">
          {applies}
        </Typography>
      )}
    </Card>
  );
};
