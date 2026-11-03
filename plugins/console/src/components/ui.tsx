import { Link } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Fragment, type ReactNode } from 'react';
import { type RqTokens, MONO, useRq } from '../theme/consoleTheme';

/**
 * The shared pieces of every console page (mock-up "framed sheet"): one title row, a KPI strip, sections as cards,
 * pills for state, a "needs attention" list, a side panel of facts. Pages compose these instead of styling by hand.
 */

export type Tone = 'pos' | 'neg' | 'warn' | 'info' | 'neu';
const tone = (t: RqTokens, k: Tone) => ({ pos: t.pos, neg: t.neg, warn: t.warn, info: t.info, neu: t.neu })[k];

/** A state pill: soft background, a dot unless plain. */
export const Pill = ({ tone: k = 'neu', children, plain, title }: { tone?: Tone; children: ReactNode; plain?: boolean; title?: string }) => {
  const t = useRq();
  const c = tone(t, k);
  return (
    <Box component="span" title={title} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height: 22, px: 1.125, borderRadius: 999, fontSize: 12, fontWeight: 500, lineHeight: '22px', whiteSpace: 'nowrap', bgcolor: c.bg, color: c.fg }}>
      {!plain && k !== 'neu' && <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor', flex: 'none' }} />}
      {children}
    </Box>
  );
};

/** Breadcrumbs: links except the last. */
export const Crumbs = ({ items }: { items: Array<[string, string?]> }) => (
  <Box component="nav" aria-label="Breadcrumbs" sx={{ fontSize: 12, color: 'text.secondary', display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
    {items.map(([label, to], i) => (
      <Fragment key={`${label}-${i}`}>
        {i > 0 && <span aria-hidden>/</span>}
        {to ? (
          <Link to={to} style={{ color: 'inherit' }}>
            {label}
          </Link>
        ) : (
          <span>{label}</span>
        )}
      </Fragment>
    ))}
  </Box>
);

/**
 * The one title row of a page: crumbs, h1 (22 px), state pills, one line of context, the finding (what to know first)
 * and the actions (at most one primary; dangerous ones go in an Actions menu).
 */
export const TitleRow = ({ crumbs, title, pills, sub, finding, findingTone = 'warn', actions }: {
  crumbs?: Array<[string, string?]>; title: ReactNode; pills?: ReactNode; sub?: ReactNode; finding?: ReactNode; findingTone?: Tone; actions?: ReactNode;
}) => {
  const t = useRq();
  const dot = { pos: t.positive, neg: t.negative, warn: t.warning, info: t.data, neu: t.control }[findingTone];
  return (
    <Box sx={{ display: 'grid', gap: 1, mb: 2.5 }}>
      {crumbs && <Crumbs items={crumbs} />}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 420px', minWidth: 0, display: 'grid', gap: 0.75 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
              {title}
            </Typography>
            {pills}
          </Box>
          {sub && (
            <Typography component="div" color="text.secondary" sx={{ maxWidth: '90ch' }}>
              {sub}
            </Typography>
          )}
          {finding && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
              <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flex: 'none', transform: 'translateY(-1px)' }} />
              <Box component="span">{finding}</Box>
            </Box>
          )}
        </Box>
        {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</Box>}
      </Box>
    </Box>
  );
};

/** A row of KPIs in one bordered strip (not separate tiles). */
export const Kpis = ({ items }: { items: Array<{ label: ReactNode; value: ReactNode; note?: ReactNode; tone?: 'bad' | 'good' }> }) => {
  const t = useRq();
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${items.length}, minmax(0, 1fr))` }, border: `1px solid ${t.border}`, borderRadius: '8px', mb: 3, overflow: 'hidden' }}>
      {items.map((k, i) => (
        <Box key={i} sx={{ px: 2.25, py: 1.75, display: 'grid', gap: 0.25, borderLeft: { md: i ? `1px solid ${t.border}` : 0 }, borderTop: { xs: i > 1 ? `1px solid ${t.border}` : 0, md: 0 }, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {k.label}
          </Typography>
          <Box sx={{ fontSize: 28, lineHeight: '34px', fontVariantNumeric: 'tabular-nums', color: k.tone === 'bad' ? t.negative : k.tone === 'good' ? t.positive : t.ink, overflowWrap: 'anywhere' }}>{k.value}</Box>
          {k.note && (
            <Typography variant="caption" color="text.secondary">
              {k.note}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
};

/** A section of a page: a card with a title, a meta line on the right, and its body (padded unless flush). */
export const Section = ({ title, meta, action, children, flush, foot, id }: { title?: ReactNode; meta?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; foot?: ReactNode; id?: string }) => {
  const t = useRq();
  return (
    <Box component="section" id={id} sx={{ border: `1px solid ${t.border}`, borderRadius: '8px', bgcolor: t.sheet, mb: 3, minWidth: 0, overflow: 'hidden' }}>
      {(title || meta || action) && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, px: 2.25, pt: 1.75, pb: 1.25, flexWrap: 'wrap' }}>
          {title && (
            <Typography variant="h5" component="h2">
              {title}
            </Typography>
          )}
          {meta && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {meta}
            </Typography>
          )}
          {action && <Box sx={{ ml: meta ? 0 : 'auto' }}>{action}</Box>}
        </Box>
      )}
      <Box sx={flush ? { overflowX: 'auto' } : { px: 2.25, pb: 2, overflowX: 'auto' }}>{children}</Box>
      {foot && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, px: 2.25, py: 1.25, borderTop: `1px solid ${t.rule}`, fontSize: 12, color: 'text.secondary', flexWrap: 'wrap' }}>{foot}</Box>
      )}
    </Box>
  );
};

/** Two or more sections side by side on wide screens: spans out of 12. */
export const Row = ({ spans, children }: { spans: number[]; children: ReactNode }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: spans.map(s => `minmax(0, ${s}fr)`).join(' ') }, gap: 3, alignItems: 'start', '& > section': { mb: 0 }, mb: 3 }}>{children}</Box>
);

/** Needs attention: one line per item, its state, what and why, and the action. */
export const Attention = ({ items }: { items: Array<{ tone: Tone; label: string; what: ReactNode; why?: ReactNode; action?: { label: string; to: string } }> }) => {
  const t = useRq();
  if (!items.length) return null;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((a, i) => (
        <Box component="li" key={i} sx={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) auto', gap: 1.5, alignItems: 'center', py: 1.25, borderTop: i ? `1px solid ${t.rule}` : 0 }}>
          <span>
            <Pill tone={a.tone}>{a.label}</Pill>
          </span>
          <Box sx={{ display: 'grid', minWidth: 0 }}>
            <Box component="span" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
              {a.what}
            </Box>
            {a.why && (
              <Typography variant="caption" color="text.secondary">
                {a.why}
              </Typography>
            )}
          </Box>
          {a.action ? (
            <Link to={a.action.to} style={{ display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 10px', borderRadius: 6, border: `1px solid ${t.control}`, color: t.ink, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', textDecoration: 'none' }}>
              {a.action.label}
            </Link>
          ) : (
            <span />
          )}
        </Box>
      ))}
    </Box>
  );
};

/** Label / value pairs (a side panel, the About of a page). */
export const Facts = ({ items, labelWidth = 140 }: { items: Array<[ReactNode, ReactNode]>; labelWidth?: number }) => (
  <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `${labelWidth}px minmax(0, 1fr)` }, gap: { xs: 0.25, sm: '8px 12px' }, m: 0 }}>
    {items.map(([k, v], i) => (
      <Fragment key={i}>
        <Box component="dt" sx={{ color: 'text.secondary' }}>
          {k}
        </Box>
        <Box component="dd" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere', mb: { xs: 1, sm: 0 } }}>
          {v}
        </Box>
      </Fragment>
    ))}
  </Box>
);

/** An identifier (namespace, image, IP...): the only place mono is used. */
export const Id = ({ children }: { children: ReactNode }) => (
  <Box component="span" sx={{ fontFamily: MONO, fontSize: 13, overflowWrap: 'anywhere' }}>
    {children}
  </Box>
);

/** A usage meter: share of a capacity, hot above 85 %. */
export const Meter = ({ value, max, label }: { value: number; max: number; label?: ReactNode }) => {
  const t = useRq();
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <Box sx={{ display: 'grid', gap: 0.5, minWidth: 120 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: t.rule, overflow: 'hidden' }}>
          <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: pct >= 85 ? t.negative : t.data }} />
        </Box>
        <Box component="span" sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
          {pct} %
        </Box>
      </Box>
      {label && (
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  );
};

/** One shape for empty, partial and error states. */
export const EmptyState = ({ title, children, tone: k = 'neu', action }: { title: ReactNode; children?: ReactNode; tone?: 'neu' | 'neg'; action?: ReactNode }) => {
  const t = useRq();
  return (
    <Box sx={{ py: 3, px: 2, display: 'grid', gap: 0.75, justifyItems: 'start', borderLeft: k === 'neg' ? `3px solid ${t.negative}` : 0 }}>
      <Box component="b" sx={{ fontWeight: 500 }}>
        {title}
      </Box>
      {children && (
        <Typography component="div" color="text.secondary">
          {children}
        </Typography>
      )}
      {action}
    </Box>
  );
};
