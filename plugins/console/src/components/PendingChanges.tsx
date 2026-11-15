import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { type ChangePull, isPending, orderPulls, PULL_TONE, usePulls } from '../pulls';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { Pill } from './ui';

const LINK: Record<ChangePull['state'], string> = { ready: 'pc.link.accept', checking: 'pc.link.review', failed: 'pc.link.review', conflict: 'pc.link.review', open: 'pc.link.review', merged: 'pc.link.see', closed: 'pc.link.see' };

/**
 * The changes a page asked for by pull request and where each one stands: checks running or failed, ready to
 * accept, accepted, closed; with the link to review and accept it in GitHub. Read when the page opens and when
 * `refresh` changes (the page has just opened one). Nothing is drawn when there is none, or it cannot be read.
 *
 * - plugin, path: GET /api/<plugin><path> → { pulls } (backend consolePulls.ts)
 * - match: only the branches that start with it (one process, one customer)
 * - applies: what has to happen after accepting for the change to take effect
 */
export const PendingChanges = ({ plugin, path, refresh, match, applies }: { plugin: string; path: string; refresh?: unknown; match?: string; applies?: ReactNode }) => {
  const { t, lang } = useI18n();
  const { pulls } = usePulls(plugin, path, refresh);
  const shown = orderPulls(pulls, match);
  if (!shown.length) return null;
  const pending = shown.filter(isPending).length;
  const date = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString(lang) : '—');
  const hint = (p: ChangePull) => {
    if (p.state === 'merged') return t('pc.hint.merged', { date: date(p.closed) });
    return p.state === 'ready' || p.state === 'closed' ? undefined : t(`pc.hint.${p.state}`);
  };
  return (
    <Card title={t('pc.title')} sub={pending ? t('pc.sub.pending', { n: pending }) : t('pc.sub.none')}>
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
      {applies && (
        <Typography variant="caption" color="text.secondary">
          {applies}
        </Typography>
      )}
    </Card>
  );
};
