import { type Entity, parseEntityRef } from '@backstage/catalog-model';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { useRq } from '../../theme/consoleTheme';
import { type Tone, choose } from '../ui';
import { type AppRow, type Line, type Stage, type Status, STAGES } from './model';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** today as an ISO date (UTC) */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** the console page of an entity ref, optionally one of its tabs */
export const entityPath = (ref: string, tab = '') => {
  const r = parseEntityRef(ref);
  return `/console/entity/${r.namespace}/${r.kind.toLowerCase()}/${r.name}${tab ? `/${tab}` : ''}`;
};

export const linePath = (l: Line) => `/console/frameworks/${parseEntityRef(l.ref).name}`;

export const statusTone = (s: Status): Tone => ({ latest: 'pos', behind: 'warn', ending: 'neg', absent: 'neu' } as const)[s.kind];

export function statusLabel(s: Status, stage: Stage, t: T): string {
  if (s.kind === 'absent') return t('dev.st.absent', { stage });
  if (s.kind === 'latest') return t('dev.st.latest');
  if (s.kind === 'ending') {
    const d = s.daysLeft ?? 0;
    return d < 92 ? t('dev.st.endsDays', { n: d }) : t('dev.st.endsMonths', { n: Math.floor(d / 30) });
  }
  return s.behind === 1 ? t('dev.st.behind1') : t('dev.st.behind', { n: s.behind ?? 0 });
}

/** the instance that speaks for an application: pro, else pre, else dev */
export const mainInstance = (a: AppRow) => a.instances.pro ?? a.instances.pre ?? a.instances.dev;
export const mainStage = (a: AppRow): Stage | undefined => [...STAGES].reverse().find(s => a.instances[s]);

/** the Argo CD application of an instance (argocd/app-name, else its name) */
export const argoName = (ref: string, entities: Map<string, Entity>) => entities.get(ref)?.metadata.annotations?.['argocd/app-name'] ?? parseEntityRef(ref).name;

/** the business service of an application: its System when that is a System of type business-service */
export function businessService(a: AppRow, entities: Map<string, Entity>): { known: boolean; title?: string } {
  const systems = [...entities.values()].filter(e => e.kind.toLowerCase() === 'system');
  if (!systems.length) return { known: false };
  if (!a.system) return { known: true };
  const s = systems.find(e => e.metadata.name === parseEntityRef(a.system!, { defaultKind: 'system', defaultNamespace: 'default' }).name);
  if (!s || s.spec?.type !== 'business-service') return { known: true };
  return { known: true, title: s.metadata.title ?? s.metadata.name };
}

/** the lifecycle class of a line: the latest of its framework is current */
export function lineClass(l: Line, latest: boolean): 'current' | 'maintained' | 'deprecated' | 'experimental' {
  return choose<'current' | 'maintained' | 'deprecated' | 'experimental'>(
    [
      [l.lifecycle === 'deprecated', 'deprecated'],
      [l.lifecycle === 'experimental', 'experimental'],
      [latest, 'current'],
    ],
    'maintained',
  );
}

/** a number from the facts, undefined when missing or -1 */
export const factNum = (f: Record<string, unknown> | undefined, k: string) => {
  const v = f?.[k];
  return typeof v === 'number' && v >= 0 ? v : undefined;
};

/** a plain table with the console's look */
export const Table = ({ head, children, minWidth = 640 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) => {
  const t = useRq();
  return (
    <Box component="table" sx={{ width: '100%', minWidth, borderCollapse: 'collapse', fontSize: 14, '& th, & td': { borderBottom: `1px solid ${t.rule}`, textAlign: 'left', px: 1.25, py: 1, verticalAlign: 'middle' }, '& th:first-of-type, & td:first-of-type': { pl: 2.25 }, '& th': { fontSize: 12, fontWeight: 500, color: t.muted } }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </Box>
  );
};

/** small chips (blocks) */
export const Chips = ({ items }: { items: string[] }) => {
  const t = useRq();
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {items.map(b => (
        <Box key={b} component="span" sx={{ fontSize: 12, px: 0.75, borderRadius: '4px', border: `1px solid ${t.border}`, color: t.muted, whiteSpace: 'nowrap' }}>
          {b}
        </Box>
      ))}
    </Box>
  );
};

/** a horizontal bar with its value as text */
export const Bar = ({ label, value, max, color }: { label: ReactNode; value: number; max: number; color?: string }) => {
  const t = useRq();
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 140px) minmax(0, 1fr) 36px', gap: 1, alignItems: 'center', fontSize: 14 }}>
      <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
        {label}
      </Box>
      <Box sx={{ height: 8, borderRadius: 4, bgcolor: t.rule, overflow: 'hidden' }}>
        <Box sx={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%`, height: '100%', bgcolor: color ?? t.data }} />
      </Box>
      <Box component="span" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Box>
    </Box>
  );
};

/** the pill tone of a heatmap level */
export const levelTone = (l: 0 | 1 | 2 | 3 | null): Tone => choose<Tone>([[l === 0, 'pos'], [l === 2, 'warn'], [l === 3, 'neg']], 'neu');
