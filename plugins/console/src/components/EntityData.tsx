import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { Progress } from '@backstage/core-components';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useRq, MONO } from '../theme/consoleTheme';
import { Table } from './NetworkPage';
import { EmptyState, Facts, Id, Kpis, Pill, Row, Section, type Tone, choose } from './ui';

/** Annotation the catalog writes on every stage of an application with the block datahub (refresquito-services). */
export const DATA_PRODUCT = 'refresquito.io/data-product';

/** Whether the entity has a data product (the tab shows only then). */
export const hasDataProduct = (entity: Entity) => Boolean(entity.metadata.annotations?.[DATA_PRODUCT]);

// ---------------------------------------------------------------- what GET /api/datahub-manager/application answers

type Governance = { ok?: boolean; assets?: number; unclassified?: number; aboveCeiling?: number; belowUpstream?: number; contractChecks?: number; contractsFailing?: number; exceptionsInForce?: number; exceptionExpiring?: number; exceptionExpired?: number; checkedAt?: string };
type Personal = { kind: string; count: number; examples: string[] };
type Column = { name: string; type: string; description?: string; terms: string[]; tags: string[]; distinct?: number; nulls?: number };
type TableInfo = { urn: string; name: string; url: string; classification?: string; terms: string[]; rows?: number; measuredAt?: string; columns: Column[] };
type LNode = { urn: string; label: string; platform: string; kind: string; inProduct: boolean; url: string };

export type ProView = {
  stage: string;
  source: 'datahub';
  product: { urn: string; url: string; name?: string; description?: string; domain?: string; ceiling?: string; classification?: string; classificationSource?: string; retentionDays?: string; zone?: string; program?: string; stage?: string; ownerTeam?: string; owners: Array<{ name: string; type: string }> };
  governance?: Governance;
  inventory: Array<{ urn: string; platform: string; name: string; kind: string; detail: string; classification?: string; url: string }>;
  tables: TableInfo[];
  lineage: { nodes: LNode[]; edges: Array<{ from: string; to: string }> };
  contracts: Array<{ urn: string; description: string; type?: string; result?: string; at?: number }>;
  personal: Personal[];
  declared: boolean;
  vsFound: { undeclaredTables: string[]; missingTables: string[]; missingColumns: string[] };
  truncated: boolean;
};
export type DeclaredView = {
  stage: string;
  source: 'declared';
  product: { urn: string };
  block?: { description?: string; classification?: string; retentionDays?: number; owners: { users: string[]; groups: string[] } };
  deploymentMissing: boolean;
  declarationsMissing: boolean;
  repository?: string;
  declarationsUrl?: string;
  stats?: { tables: number; columns: number; confidentialColumns: number; personalColumns: number; personal: Personal[]; contractTables: string[]; terms: string[] };
  tables: Array<{ name: string; terms: string[]; columns: number; contract: boolean }>;
  sites: string[];
  processes: string[];
  schemaCompared: false;
};
type View = ProView | DeclaredView;

/** The query of the tab, from the annotations of the entity. */
export function applicationQuery(entity: Entity): string {
  const a = entity.metadata.annotations ?? {};
  const q = new URLSearchParams();
  q.set('product', a[DATA_PRODUCT] ?? '');
  q.set('stage', a['refresquito.io/stage'] || 'pro');
  if (a['refresquito.io/repository']) q.set('repository', a['refresquito.io/repository']);
  if (a['refresquito.io/deployment-file']) q.set('deploymentFile', a['refresquito.io/deployment-file']);
  return q.toString();
}

/** Columns of the lineage diagram: sources on the left, each node one column right of what feeds it (at most 4). */
export function lineageColumns(nodes: LNode[], edges: Array<{ from: string; to: string }>): LNode[][] {
  const rank = new Map(nodes.map(n => [n.urn, 0]));
  for (let pass = 0; pass < 4; pass++) {
    for (const e of edges) {
      const r = Math.min(3, (rank.get(e.from) ?? 0) + 1);
      if ((rank.get(e.to) ?? 0) < r) rank.set(e.to, r);
    }
  }
  const cols: LNode[][] = [[], [], [], []];
  nodes.forEach(n => cols[rank.get(n.urn) ?? 0].push(n));
  return cols.filter(c => c.length);
}

const fmtTime = (iso?: string | number) => {
  if (iso === undefined) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

function useApplication(entity: Entity) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const query = applicationQuery(entity);
  const [state, setState] = useState<{ loading: boolean; data?: View; error?: string; status?: number }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const r = await fetch(`${await discovery.getBaseUrl('datahub-manager')}/application?${query}`);
      const body = await r.json().catch(() => undefined);
      if (!r.ok) return { status: r.status, error: (body as { error?: string })?.error ?? `${r.status} ${r.statusText}` };
      return { data: body as View };
    })().then(
      s => alive && setState({ loading: false, ...s }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, query]);
  return state;
}

// ---------------------------------------------------------------- the tab

export const EntityDataContent = () => {
  const { entity } = useEntity();
  const { t } = useI18n();
  const s = useApplication(entity);
  if (s.loading) return <Progress />;
  if (s.status === 403) return <EmptyState title={t('data.noAccess')}>{t('data.noAccessWhy')}</EmptyState>;
  if (s.status === 404) return <EmptyState title={t('data.notYet')}>{s.error}</EmptyState>;
  if (s.error || !s.data) return <EmptyState tone="neg" title={t('data.error')}>{s.error}</EmptyState>;
  return s.data.source === 'datahub' ? <ProData v={s.data} /> : <DeclaredData v={s.data} />;
};

const Source = ({ tone, label, children, action }: { tone: Tone; label: string; children: ReactNode; action?: ReactNode }) => {
  const { t } = useI18n();
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center', color: 'text.secondary', fontSize: 13 }}>
        <span>{t('data.source')}</span>
        <Pill tone={tone}>{label}</Pill>
        {children}
      </Box>
      {action}
    </Box>
  );
};

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <Button size="small" variant="outlined" href={href} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>
    {children}
  </Button>
);

const Checks = ({ items }: { items: Array<{ ok: boolean; text: ReactNode }> }) => {
  const rq = useRq();
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}>
      {items.map((c, i) => (
        <Box component="li" key={i} sx={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 0.75 }}>
          <Box component="span" sx={{ fontWeight: 700, color: c.ok ? rq.positive : rq.warning }}>
            {c.ok ? '✓' : '!'}
          </Box>
          <span>{c.text}</span>
        </Box>
      ))}
    </Box>
  );
};

const resultTone = (result?: string): Tone => choose<Tone>([[result === 'SUCCESS', 'pos'], [!!result, 'neg']], 'neu');

function ProData({ v }: { v: ProView }) {
  const { t } = useI18n();
  const g = v.governance ?? {};
  const [table, setTable] = useState(v.tables[0]?.name);
  const current = v.tables.find(x => x.name === table) ?? v.tables[0];
  const failing = v.contracts.filter(c => c.result && c.result !== 'SUCCESS').length;
  const personalCount = v.personal.reduce((n, p) => n + p.count, 0);
  const exceptions = (g.exceptionsInForce ?? 0) + (g.exceptionExpiring ?? 0);
  const p = v.product;
  return (
    <>
      <Source tone="pos" label={t('data.live')} action={<Ext href={p.url}>{t('data.openDatahub')}</Ext>}>
        <span>· {t('data.product')}</span>
        <Id>{p.urn}</Id>
        {g.checkedAt && <span>· {t('data.checkedAt', { at: fmtTime(g.checkedAt) })}</span>}
      </Source>
      <Kpis
        items={[
          { label: t('data.classification'), value: p.classification ?? '—', note: t('data.ceiling', { c: p.ceiling ?? '—', src: p.classificationSource ?? '—' }) },
          { label: t('data.assets'), value: String(g.assets ?? v.inventory.length), note: t('data.unclassified', { n: String(g.unclassified ?? 0) }), tone: g.unclassified ? 'bad' : 'good' },
          { label: t('data.contracts'), value: g.contractChecks !== undefined ? `${g.contractChecks - (g.contractsFailing ?? 0)} / ${g.contractChecks}` : `${v.contracts.length - failing} / ${v.contracts.length}`, note: t('data.contractsNote'), tone: (g.contractsFailing ?? failing) ? 'bad' : 'good' },
          { label: t('data.daily'), value: choose([[g.ok === undefined, '—'], [g.ok === true, 'OK']], t('data.attention')), note: t('data.dailyNote', { a: String(g.aboveCeiling ?? 0), b: String(g.belowUpstream ?? 0) }), tone: choose<'bad' | 'good' | undefined>([[g.ok === false, 'bad'], [g.ok === true, 'good']], undefined) },
          { label: t('data.personal'), value: personalCount ? String(personalCount) : t('data.none'), note: personalCount ? t('data.personalKinds', { n: String(v.personal.length) }) : t('data.personalNone') },
          { label: t('data.exceptions'), value: String(exceptions), note: g.exceptionExpired ? t('data.expired', { n: String(g.exceptionExpired) }) : t('data.inForce'), tone: g.exceptionExpired ? 'bad' : undefined },
        ]}
      />
      <Row spans={[5, 7]}>
        <Section title={t('data.productTitle')} action={<a href={p.url} target="_blank" rel="noopener">{p.name ?? p.urn}</a>}>
          <Facts
            items={[
              [t('data.description'), p.description ?? '—'],
              [t('data.domain'), p.domain ?? '—'],
              [t('data.owners'), p.owners.map(o => `${o.name}${o.type ? ` (${o.type})` : ''}`).join(' · ') || '—'],
              [t('data.where'), [p.zone, p.program, p.stage].filter(Boolean).join(' · ') || '—'],
              [t('data.retention'), p.retentionDays ? t('data.days', { n: p.retentionDays }) : <Pill tone="warn">{t('data.notDeclared')}</Pill>],
            ]}
          />
        </Section>
        <Section title={t('data.lineage')} meta={t('data.lineageMeta')}>
          <Lineage nodes={v.lineage.nodes} edges={v.lineage.edges} />
        </Section>
      </Row>
      <Section title={t('data.inventory')} meta={t('data.inventoryMeta')} flush>
        <Table
          head={[t('data.service'), t('data.asset'), t('data.kind'), t('data.classification'), '']}
          rows={v.inventory.map(i => [i.platform, <Id key="n">{i.name}</Id>, `${i.kind}${i.detail ? ` · ${i.detail}` : ''}`, i.classification ? <Pill key="c">{i.classification}</Pill> : '—', <a key="o" href={i.url} target="_blank" rel="noopener">{t('data.open')}</a>])}
        />
      </Section>
      <Row spans={[7, 5]}>
        <Section title={t('data.schema')} meta={current?.measuredAt ? t('data.profiled', { at: fmtTime(current.measuredAt) }) : undefined}>
          {current ? (
            <>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                {v.tables.map(x => (
                  <Button key={x.name} size="small" variant={x.name === current.name ? 'contained' : 'outlined'} onClick={() => setTable(x.name)} sx={{ textTransform: 'none' }}>
                    {x.name}
                    {x.rows !== undefined ? ` · ${x.rows}` : ''}
                  </Button>
                ))}
              </Box>
              <Table
                head={[t('data.column'), t('data.type'), t('data.terms'), t('data.description'), t('data.distinct'), t('data.nulls')]}
                rows={current.columns.map(c => [
                  <Id key="n">{c.name}</Id>,
                  c.type,
                  c.terms.length ? c.terms.map(x => <Pill key={x} tone={x.startsWith('PersonalData.') ? 'warn' : 'neu'}>{x}</Pill>) : '—',
                  c.description ?? <Pill key="d" tone="warn">{t('data.missing')}</Pill>,
                  c.distinct ?? '—',
                  c.nulls ?? '—',
                ])}
              />
            </>
          ) : (
            <EmptyState title={t('data.noTables')} />
          )}
        </Section>
        <Section title={t('data.contracts')} meta={t('data.contractsNote')} flush>
          {v.contracts.length ? (
            <Table
              head={[t('data.check'), t('data.result'), t('data.when')]}
              rows={v.contracts.map(c => [c.description, <Pill key="r" tone={resultTone(c.result)}>{c.result ?? t('data.notRun')}</Pill>, fmtTime(c.at)])}
            />
          ) : (
            <EmptyState title={t('data.noContracts')} />
          )}
        </Section>
      </Row>
      <Row spans={[6, 6]}>
        <Section title={t('data.vsFound')} meta={t('data.vsFoundMeta')}>
          {v.declared ? (
            <Checks
              items={[
                { ok: !v.vsFound.undeclaredTables.length, text: v.vsFound.undeclaredTables.length ? t('data.undeclared', { list: v.vsFound.undeclaredTables.join(', ') }) : t('data.allDeclared') },
                { ok: !v.vsFound.missingTables.length && !v.vsFound.missingColumns.length, text: v.vsFound.missingTables.length || v.vsFound.missingColumns.length ? t('data.missingDeclared', { list: [...v.vsFound.missingTables, ...v.vsFound.missingColumns].join(', ') }) : t('data.allFound') },
                { ok: !!p.retentionDays, text: p.retentionDays ? t('data.retentionOk') : t('data.retentionMissing') },
              ]}
            />
          ) : (
            <EmptyState title={t('data.noDeclarations')} />
          )}
        </Section>
        <Continuity classification={p.classification} retention={p.retentionDays} />
      </Row>
      {v.personal.length > 0 && <PersonalTable personal={v.personal} />}
      {v.truncated && <EmptyState title={t('data.truncated')} />}
    </>
  );
}


function Continuity({ classification, retention }: { classification?: string; retention?: string | number }) {
  const { t } = useI18n();
  return (
    <Section title={t('data.continuity')} meta={t('data.continuityMeta')}>
      <Facts
        items={[
          [t('data.retention'), retention ? t('data.days', { n: String(retention) }) : t('data.notDeclared')],
          [t('data.classification'), classification ?? '—'],
          [t('data.profile'), <Link to="/console/continuity">{t('data.openContinuity')}</Link>],
        ]}
      />
    </Section>
  );
}

function PersonalTable({ personal }: { personal: Personal[] }) {
  const { t } = useI18n();
  return (
    <Section title={t('data.gdpr')} meta={t('data.gdprMeta')} flush>
      <Table head={[t('data.kind'), t('data.columns'), t('data.examples')]} rows={personal.map(p => [p.kind, p.count, <Id key="e">{p.examples.join(', ')}</Id>])} />
    </Section>
  );
}

function Lineage({ nodes, edges }: { nodes: LNode[]; edges: Array<{ from: string; to: string }> }) {
  const rq = useRq();
  const { t } = useI18n();
  if (!nodes.length) return <EmptyState title={t('data.noLineage')} />;
  const cols = lineageColumns(nodes, edges);
  const W = 150;
  const H = 40;
  const GX = 40;
  const GY = 14;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) => c.forEach((n, j) => pos.set(n.urn, { x: i * (W + GX), y: j * (H + GY) })));
  const width = cols.length * (W + GX) - GX;
  const height = Math.max(...cols.map(c => c.length)) * (H + GY) - GY;
  return (
    <Box component="svg" viewBox={`-2 -2 ${width + 4} ${height + 4}`} sx={{ width: '100%', maxWidth: width + 4, height: 'auto', display: 'block' }} role="img" aria-label={t('data.lineage')}>
      <defs>
        <marker id="rq-data-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={rq.control} />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        return <path key={i} d={`M${a.x + W} ${a.y + H / 2}L${b.x - 2} ${b.y + H / 2}`} stroke={rq.control} strokeWidth={1.4} fill="none" markerEnd="url(#rq-data-arrow)" />;
      })}
      {nodes.map(n => {
        const p = pos.get(n.urn)!;
        return (
          <a key={n.urn} href={n.url} target="_blank" rel="noopener">
            <rect x={p.x} y={p.y} width={W} height={H} rx={8} fill={rq.raised} stroke={n.inProduct ? rq.data : rq.border} strokeWidth={n.inProduct ? 1.5 : 1} />
            <text x={p.x + 10} y={p.y + 15} fontSize={10} fill={rq.muted}>
              {n.platform || n.kind}
            </text>
            <text x={p.x + 10} y={p.y + 31} fontSize={12} fontFamily={MONO} fill={rq.ink}>
              {n.label.length > 19 ? `${n.label.slice(0, 18)}…` : n.label}
            </text>
          </a>
        );
      })}
    </Box>
  );
}

function DeclaredData({ v }: { v: DeclaredView }) {
  const { t } = useI18n();
  const rq = useRq();
  const s = v.stats;
  const b = v.block;
  return (
    <>
      <Box sx={{ bgcolor: `${rq.warning}1a`, borderLeft: `3px solid ${rq.warning}`, borderRadius: '8px', px: 2, py: 1.25, mb: 2, fontSize: 13 }}>
        <b>{t('data.onlyPro')}</b> {t('data.onlyProWhy', { stage: v.stage })}
      </Box>
      <Source tone="warn" label={t('data.declaredSource')} action={v.declarationsUrl ? <Ext href={v.declarationsUrl}>platform/datahub.yaml</Ext> : undefined}>
        {v.repository && (
          <>
            <span>· {t('data.repository')}</span>
            <Id>{v.repository}</Id>
          </>
        )}
      </Source>
      {v.declarationsMissing && <EmptyState title={t('data.noDeclarationsFile')}>{t('data.noDeclarationsFileWhy')}</EmptyState>}
      <Kpis
        items={[
          { label: t('data.classification'), value: b?.classification ?? '—', note: t('data.fromDeployment') },
          { label: t('data.tablesDeclared'), value: String(s?.tables ?? 0), note: t('data.columnsDeclared', { n: String(s?.columns ?? 0) }) },
          { label: t('data.personal'), value: String(s?.personalColumns ?? 0), note: t('data.personalKinds', { n: String(s?.personal.length ?? 0) }) },
          { label: t('data.confidential'), value: String(s?.confidentialColumns ?? 0), note: t('data.columnLevel') },
          { label: t('data.contracts'), value: String(s?.contractTables.length ?? 0), note: s?.contractTables.join(', ') || '—' },
          { label: t('data.retention'), value: b?.retentionDays ? t('data.days', { n: String(b.retentionDays) }) : '—', note: t('data.fromDeployment') },
        ]}
      />
      <Row spans={[6, 6]}>
        <Section title={t('data.productWillBe')}>
          <Facts
            items={[
              [t('data.product'), <Id>{v.product.urn}</Id>],
              [t('data.description'), b?.description ?? '—'],
              [t('data.owners'), [...(b?.owners.groups ?? []).map(g => `${g} (group)`), ...(b?.owners.users ?? [])].join(' · ') || '—'],
              [t('data.classification'), b?.classification ?? '—'],
              [t('data.terms'), s?.terms.join(', ') || '—'],
            ]}
          />
        </Section>
        <Section title={t('data.vsSchema')}>
          <EmptyState title={t('data.notCompared')}>{t('data.notComparedWhy')}</EmptyState>
        </Section>
      </Row>
      {s && s.personal.length > 0 && <PersonalTable personal={s.personal} />}
      <Section title={t('data.inventoryDeclared')} meta={t('data.inventoryDeclaredMeta')} flush>
        <Table
          head={[t('data.service'), t('data.asset'), t('data.terms'), t('data.columns'), t('data.contracts')]}
          rows={[
            ...v.tables.map(x => ['PostgreSQL', <Id key="n">{x.name}</Id>, x.terms.join(', ') || '—', x.columns, x.contract ? <Pill key="c" tone="pos">{t('data.yes')}</Pill> : '—']),
            ...v.sites.map(x => ['Alfresco', <Id key="n">{x}</Id>, '—', '—', '—']),
            ...v.processes.map(x => [t('data.processes'), <Id key="n">{x}</Id>, '—', '—', '—']),
          ]}
        />
      </Section>
      <Continuity classification={b?.classification} retention={b?.retentionDays} />
    </>
  );
}
