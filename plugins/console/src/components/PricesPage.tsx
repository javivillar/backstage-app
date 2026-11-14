import { Link, Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { changesOf, GROUPS, matches, monthlyExample, parsePrice, type PriceRow, type Prices, type PricesAnswer, priceRows, type PriceValue, SIZES, type Size, usePrices } from '../prices';
import { MONO, useRq } from '../theme/consoleTheme';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { EmptyState, Id, Kpis, Pill, TitleRow, type Tone } from './ui';
import { Seg } from './ui-portal';

type Filter = 'all' | 'use' | 'off';
type Step = 'view' | 'edit' | 'review';

const STATE_TONE: Record<PriceRow['state'], Tone> = { use: 'pos', set: 'info', off: 'neu' };

/** The head of a card: its text on the left, pills on the right. */
const Head = ({ children, pills }: { children: ReactNode; pills: ReactNode }) => (
  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
    <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 320px', minWidth: 0 }}>
      {children}
    </Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>{pills}</Box>
  </Box>
);

/**
 * FinOps › Prices: every price the platform can charge (what OpenCost charges for the cluster and what the console
 * adds for platform services), what an application costs with them, and changing them with a pull request on the
 * chart of the platform.
 */
export const PricesPage = () => {
  const { t, lang } = useI18n();
  const rq = useRq();
  const { loading, data, error, deployed, currency, description, post, reload } = usePrices();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<Size>('medium');
  const [step, setStep] = useState<Step>('view');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [done, setDone] = useState<PricesAnswer>();

  const rows = useMemo(() => priceRows(deployed, data?.prices), [deployed, data]);
  const { changes, invalid } = useMemo(() => changesOf(rows, draft), [rows, draft]);
  const changed = Object.keys(changes);
  const number = (v: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 10 }).format(v);
  const money = (v: number) => new Intl.NumberFormat(lang, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const show = (r: PriceRow, v: PriceValue | undefined): string => {
    if (v === undefined || v === '') return t('price.notSet');
    if (typeof v === 'string') return v;
    return r.kind === 'percent' ? `${number(v)} %` : number(v);
  };
  /** An assistant row is named "<model> · <key of its field>"; the rest by a key. */
  const nameOf = (r: PriceRow) => {
    const cut = r.name.lastIndexOf(' · price.field.');
    return cut < 0 ? t(r.name) : `${r.name.slice(0, cut)} · ${t(r.name.slice(cut + 3))}`;
  };
  const textsOf = (r: PriceRow) => [nameOf(r), t(r.unit), r.path, r.opencost ?? '', t(`price.group.${r.group}`), t(`price.by.${r.by}`), t(`price.state.${r.state}`)];

  // what is charged today, and with the draft on top: what the example application would cost
  const live: Prices = useMemo(() => Object.fromEntries(rows.filter(r => r.value !== undefined).map(r => [r.path, r.value as PriceValue])), [rows]);
  const example = monthlyExample(step === 'view' ? live : { ...live, ...changes }, size);
  const exampleToday = monthlyExample(live, size);

  const start = () => {
    setDraft({});
    setFailed(undefined);
    setDone(undefined);
    setStep('edit');
  };
  const send = async () => {
    setSending(true);
    setFailed(undefined);
    try {
      setDone(await post(changes));
      setDraft({});
      setStep('view');
      reload();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const sub = { view: 'price.sub', edit: 'price.subEdit', review: 'price.subReview' }[step];
  const title = (
    <TitleRow
      crumbs={[[t('nav.portal'), '/console'], [t('nav.finops')], [t('nav.prices')]]}
      title={step === 'view' ? t('nav.prices') : t('price.change')}
      sub={t(sub)}
      actions={
        step === 'view' &&
        data?.may && (
          <Button variant="contained" onClick={start}>
            {t('price.change')}
          </Button>
        )
      }
    />
  );

  // ---- the pull request, before it is opened
  if (step === 'review' && data) {
    const picked = rows.filter(r => r.path in changes);
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {title}
        <Card title={t('price.pr')} sub={t('price.pr.where', { repo: data.repo, path: data.path, version: data.version ?? '' })}>
          <Box>
            <Pill tone="info">{t('price.pr.count', { n: picked.length })}</Pill>
          </Box>
          <Table
            head={[t('price.col.price'), t('price.col.unit'), t('price.pr.today'), t('price.pr.proposed'), t('price.col.applies'), t('price.col.setting')]}
            rows={picked.map(r => [
              <Box key="n" sx={{ display: 'grid', gap: 0.25 }}>
                <Box sx={{ fontWeight: 500 }}>{nameOf(r)}</Box>
                <Typography variant="caption" color="text.secondary">
                  {t(`price.group.${r.group}`)}
                </Typography>
              </Box>,
              t(r.unit),
              show(r, r.base),
              <Box key="p" sx={{ fontWeight: 600 }}>
                {show(r, changes[r.path])}
              </Box>,
              t(`price.applies.${r.by}`),
              <Id key="s">{r.path}</Id>,
            ])}
          />
          <Typography variant="h6" component="h3">
            {t('price.pr.next')}
          </Typography>
          <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}>
            {['price.pr.step1', 'price.pr.step2', picked.some(r => r.by === 'opencost') && 'price.pr.step3', picked.some(r => r.by === 'console') && 'price.pr.step4']
              .filter((k): k is string => Boolean(k))
              .map(k => (
                <li key={k}>{t(k)}</li>
              ))}
          </Box>
          {failed && (
            <EmptyState tone="neg" title={t('price.pr.failed')}>
              {failed}
            </EmptyState>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button variant="contained" onClick={send} disabled={sending}>
              {t(sending ? 'price.pr.opening' : 'price.pr.open')}
            </Button>
            <Button variant="outlined" onClick={() => setStep('edit')} disabled={sending}>
              {t('price.back')}
            </Button>
          </Box>
        </Card>
      </Box>
    );
  }

  // ---- the prices, to read or to change
  const edit = step === 'edit';
  const shown = rows.filter(r => (filter === 'all' || (filter === 'use') === (r.state === 'use')) && matches(textsOf(r), query));
  const inUse = rows.filter(r => r.state === 'use').length;
  const extras = filter !== 'use' && !query.trim();
  const priceCell = (r: PriceRow): ReactNode => {
    if (!edit) {
      return (
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          <Box sx={{ fontWeight: r.state === 'use' ? 600 : 400, color: r.state === 'off' ? 'text.secondary' : 'text.primary', fontFamily: r.kind === 'label' && r.value ? MONO : undefined }}>{show(r, r.value)}</Box>
          {r.pending !== undefined && (
            <Typography variant="caption" sx={{ color: rq.warn.fg }}>
              {t('price.pending', { value: show(r, r.pending) })}
            </Typography>
          )}
        </Box>
      );
    }
    if (r.base === undefined) {
      return (
        <Typography variant="caption" color="text.secondary">
          {t('price.notInChart')}
        </Typography>
      );
    }
    const typed = r.path in draft;
    const bad = typed && parsePrice(r.kind, draft[r.path]) === undefined;
    const moved = r.path in changes;
    // no thousands separators in what is typed over: "1.000" would read as one
    const initial = typeof r.base === 'number' ? new Intl.NumberFormat(lang, { maximumFractionDigits: 10, useGrouping: false }).format(r.base) : r.base;
    let help: string | undefined;
    if (bad) help = t('price.invalid');
    else if (moved) help = t('price.today', { value: show(r, r.base) });
    return (
      <TextField
        size="small"
        value={typed ? draft[r.path] : initial}
        onChange={e => setDraft(d => ({ ...d, [r.path]: e.target.value }))}
        error={bad}
        color={moved ? 'warning' : undefined}
        focused={moved || undefined}
        helperText={help}
        inputProps={{ 'aria-label': `${nameOf(r)}, ${t(r.unit)}`, inputMode: r.kind === 'label' ? 'text' : 'decimal', style: { textAlign: r.kind === 'label' ? 'left' : 'right' } }}
        sx={{ width: r.kind === 'label' ? 260 : 130 }}
      />
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {title}
      {loading && <Progress />}
      {error && (
        <EmptyState tone="neg" title={t('price.noRepo')}>
          {t('price.noRepoText', { error })}
        </EmptyState>
      )}
      {done && (
        <EmptyState title={t('price.pr.done', { n: done.pull.number })} action={<Link to={done.pull.url}>{t('price.pr.see')}</Link>}>
          {t('price.pr.doneText', { version: done.version })}
        </EmptyState>
      )}
      <Kpis
        items={[
          { label: t('price.kpi.all'), value: rows.length, note: t('price.kpi.allNote') },
          { label: t('price.kpi.use'), value: inUse, note: t('price.kpi.useNote') },
          { label: t('price.kpi.off'), value: rows.length - inUse, note: t('price.kpi.offNote') },
          { label: t('price.kpi.currency'), value: currency, note: t('price.kpi.currencyNote') },
          ...(description ? [{ label: t('price.kpi.base'), value: <Box sx={{ fontSize: 14, lineHeight: '20px', py: '7px' }}>{description}</Box> }] : []),
        ]}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <Seg<Filter> label={t('price.filter')} value={filter} onChange={setFilter} items={[['all', t('price.filter.all'), rows.length], ['use', t('price.filter.use'), inUse], ['off', t('price.filter.off'), rows.length - inUse]]} />
        <TextField size="small" type="search" placeholder={t('price.search')} value={query} onChange={e => setQuery(e.target.value)} inputProps={{ 'aria-label': t('price.searchLabel') }} sx={{ flex: '1 1 280px', maxWidth: 420 }} />
        {data && !data.may && (
          <Typography variant="caption" color="text.secondary">
            {t('price.mayNot', { groups: data.groups.join(', ') })}
          </Typography>
        )}
      </Box>
      <Box sx={{ bgcolor: rq.info.bg, color: rq.ink, borderRadius: '8px', px: 1.5, py: 1.25 }}>{t('price.kinds')}</Box>

      <Card title={t('price.calc')} sub={t('price.calc.sub', { model: example.model ? `, ${example.model}` : '' })}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 3fr)' }, alignItems: 'start' }}>
          <Box sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
            <Seg<Size> label={t('price.calc.size')} value={size} onChange={setSize} items={(Object.keys(SIZES) as Size[]).map(s => [s, t(`price.calc.${s}`)])} />
            <Typography variant="caption" color="text.secondary">
              {`${SIZES[size].cpu} vCPU · ${SIZES[size].ram} GiB · ${SIZES[size].disk} GiB ${t('price.calc.disk').toLowerCase()} · ${t('price.calc.perMonth')}`}
            </Typography>
            <Box role="status" sx={{ fontSize: 28, lineHeight: '34px', fontVariantNumeric: 'tabular-nums' }}>
              {money(example.total)}
            </Box>
            <Typography variant="caption" sx={{ color: edit && Math.abs(example.total - exampleToday.total) >= 0.005 ? rq.warn.fg : 'text.secondary' }}>
              {edit && Math.abs(example.total - exampleToday.total) >= 0.005 ? t('price.today', { value: money(exampleToday.total) }) : t('price.calc.zero')}
            </Typography>
          </Box>
          <Table
            head={[t('price.calc.part'), t('price.calc.perMonth'), t('price.calc.share')]}
            rows={example.parts.map(p => [t(`price.calc.${p.id}`), money(p.amount), example.total > 0 ? `${Math.round((p.amount / example.total) * 100)} %` : '—'])}
          />
        </Box>
      </Card>

      {shown.length === 0 && !extras && <EmptyState title={t('price.empty')} />}
      {GROUPS.map(g => {
        const all = rows.filter(r => r.group === g.id);
        const mine = shown.filter(r => r.group === g.id);
        if (!mine.length) return null;
        return (
          <Card key={g.id} title={t(`price.group.${g.id}`)}>
            <Head
              pills={
                <>
                  <Pill tone={g.by === 'opencost' ? 'info' : 'warn'} plain>
                    {t(`price.by.${g.by}`)}
                  </Pill>
                  <Typography variant="caption" color="text.secondary">
                    {t('price.inUse', { n: all.filter(r => r.state === 'use').length, total: all.length })}
                  </Typography>
                </>
              }
            >
              {t(`price.group.${g.id}.sub`)}
            </Head>
            <Table
              head={[t('price.col.price'), t('price.col.unit'), t('price.col.value', { currency }), t('price.col.state'), t('price.col.applies'), t('price.col.setting')]}
              rows={mine.map(r => [
                <Box key="n" sx={{ display: 'grid', gap: 0.25, minWidth: 200 }}>
                  <Box sx={{ fontWeight: 500 }}>{nameOf(r)}</Box>
                  {r.note && (
                    <Typography variant="caption" color="text.secondary">
                      {t(r.note)}
                    </Typography>
                  )}
                </Box>,
                t(r.unit),
                priceCell(r),
                <Pill key="s" tone={STATE_TONE[r.state]}>
                  {t(`price.state.${r.state}`)}
                </Pill>,
                <Typography key="a" variant="caption" color="text.secondary">
                  {t(`price.applies.${r.by}`)}
                </Typography>,
                <Box key="k" sx={{ display: 'grid', gap: 0.25 }}>
                  <Id>{r.path}</Id>
                  <Typography variant="caption" color="text.secondary">
                    {r.opencost ? t('price.opencostName', { name: r.opencost }) : t('price.consoleOnly')}
                  </Typography>
                </Box>,
              ])}
            />
          </Card>
        );
      })}

      {extras && (
        <>
          <Card title={t('price.list')}>
            <Head pills={<Pill>{t('price.state.off')}</Pill>}>{t('price.list.sub')}</Head>
            <Table
              head={[t('price.list.what'), t('price.list.matched'), t('price.list.example'), t('price.col.unit')]}
              rows={[
                [t('price.list.node'), t('price.list.byName'), <Id key="e">metadata.name</Id>, t('price.list.unitNode')],
                [t('price.list.node'), t('price.list.byLabel'), <Id key="e">metadata.labels.&lt;label&gt;</Id>, t('price.list.unitNode')],
                [t('price.list.node'), t('price.list.byType'), <Id key="e">region, instance type</Id>, t('price.list.unitNode')],
                [t('price.list.gpu'), t('price.list.byModel'), <Id key="e">metadata.labels.&lt;label&gt;</Id>, t('price.list.unitGpu')],
                [t('price.list.volume'), t('price.list.byClass'), <Id key="e">spec.storageClassName</Id>, t('price.list.unitDisk')],
                [t('price.list.volume'), t('price.list.byName'), <Id key="e">metadata.name</Id>, t('price.list.unitDisk')],
              ]}
            />
          </Card>
          <Card title={t('price.share')} sub={t('price.share.sub')}>
            <Table
              head={[t('price.list.what'), t('price.share.today'), t('price.share.canBe'), t('price.col.setting')]}
              rows={[
                [t('price.share.idle'), <Pill key="t" tone="pos">{t('price.share.idleToday')}</Pill>, t('price.share.idleCan'), <Id key="s">includeIdle · shareIdle</Id>],
                [t('price.share.byNode'), <Pill key="t" tone="pos">{t('price.share.byNodeToday')}</Pill>, t('price.share.byNodeCan'), <Id key="s">idleByNode</Id>],
                [t('price.share.lb'), <Pill key="t" tone="pos">{t('price.share.lbToday')}</Pill>, t('price.share.lbCan'), <Id key="s">shareLB</Id>],
              ]}
            />
          </Card>
          <Card title={t('price.other')} sub={t('price.other.sub')}>
            <Table
              head={[t('price.other.what'), t('price.other.brings'), t('price.col.state')]}
              rows={[
                [t('price.other.cloud'), t('price.other.cloudText'), <Pill key="s">{t('price.state.na')}</Pill>],
                [t('price.other.external'), t('price.other.externalText'), <Pill key="s">{t('price.state.off')}</Pill>],
                [t('price.other.carbon'), t('price.other.carbonText'), <Pill key="s">{t('price.state.off')}</Pill>],
                [t('price.other.spotGpu'), t('price.other.spotGpuText'), <Pill key="s">{t('price.state.noEffect')}</Pill>],
                [t('price.other.lbRules'), t('price.other.lbRulesText'), <Pill key="s">{t('price.state.noEffect')}</Pill>],
              ]}
            />
          </Card>
        </>
      )}
      {data && (
        <Typography variant="caption" color="text.secondary">
          <Link to={data.url}>{t('price.source')}</Link>
          {` · ${data.repo} · ${data.path}${data.version ? ` · chart ${data.version}` : ''}`}
        </Typography>
      )}

      {edit && (
        <Box sx={{ position: 'sticky', bottom: 8, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', bgcolor: rq.sheet, border: `1px solid ${rq.ink}`, borderRadius: '8px', px: 2, py: 1.25, boxShadow: '0 4px 16px rgba(18,24,32,.12)', zIndex: 1 }}>
          <Box role="status" sx={{ fontWeight: 600 }}>
            {changed.length === 1 ? t('price.changedOne') : t('price.changed', { n: changed.length })}
          </Box>
          {invalid.length > 0 && <Pill tone="neg">{t('price.invalidCount', { n: invalid.length })}</Pill>}
          <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 200px', minWidth: 0 }}>
            {rows
              .filter(r => r.path in changes)
              .map(r => `${nameOf(r)} ${show(r, r.base)} → ${show(r, changes[r.path])}`)
              .join(' · ')}
          </Typography>
          <Button variant="contained" disabled={!changed.length || invalid.length > 0} onClick={() => setStep('review')}>
            {t('price.review')}
          </Button>
          <Button variant="outlined" onClick={() => setStep('view')}>
            {t('price.discard')}
          </Button>
        </Box>
      )}
    </Box>
  );
};
