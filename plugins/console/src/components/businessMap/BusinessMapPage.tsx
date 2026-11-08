import { Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type MapData, type MapProcess, type Origin, topProcesses, useBusinessMap } from '../../businessMap';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { EmptyState, Facts, Id, Kpis, TitleRow } from '../ui';
import { BusinessMapTabs, useCustomer } from './BusinessMapTabs';
import {
  adoptModelUrl,
  consolePath,
  CRITICALITIES,
  editProcessUrl,
  gapText,
  importModelUrl,
  mapBlocks,
  mapStats,
  nameOf,
  newProcessUrl,
  originText,
  UNASSIGNED,
} from './businessMapModel';
import { CritPill, ResultPill } from './parts';

const ownerName = (p: Pick<MapProcess, 'owner'>) => (p.owner && p.owner !== UNASSIGNED ? nameOf(p.owner) : undefined);

/** One process of the map as a card: title, criticality and its RPO / RTO, the check and the owner (the description
 *  as its tooltip, and how many sub-processes it has). */
const ProcessCard = ({ p, on, onPick }: { p: MapProcess; on: boolean; onPick: () => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  return (
    <Box
      component="button"
      type="button"
      onClick={onPick}
      aria-pressed={on}
      title={p.description}
      sx={{
        all: 'unset',
        boxSizing: 'border-box',
        cursor: 'pointer',
        display: 'grid',
        gap: 0.75,
        p: 1.25,
        borderRadius: '8px',
        border: `1px solid ${on ? rq.data : rq.border}`,
        boxShadow: on ? `inset 0 0 0 1px ${rq.data}` : 'none',
        bgcolor: rq.sheet,
        '&:hover': { borderColor: rq.data },
        '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 },
      }}
    >
      <Box component="span" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
        {p.title}
      </Box>
      <Box component="span" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <CritPill value={p.criticality} />
        <Box component="span" sx={{ fontSize: 12, color: rq.muted }}>
          RPO {p.requirement.rpo ?? '—'} · RTO {p.requirement.rto ?? '—'}
        </Box>
      </Box>
      <Box component="span" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <ResultPill result={p.result} gaps={p.gaps} />
        <Box component="span" sx={{ fontSize: 12, color: rq.muted }}>
          {ownerName(p) ?? t('bm.noOwner')}
          {p.subprocesses?.length ? ` · ${t('bm.subprocesses.count', { n: p.subprocesses.length })}` : ''}
        </Box>
      </Box>
    </Box>
  );
};

/** The side panel: the selected process, its requirement and where it comes from, and what it depends on. */
const ProcessPanel = ({ p }: { p?: MapProcess }) => {
  const { t } = useI18n();
  const rq = useRq();
  if (!p) return <Typography color="text.secondary">{t('bm.pick')}</Typography>;
  const from = (o: Origin) => originText(t, o, p.criticality);
  const id = p.pcfId ? `PCF ${p.pcfId}` : p.modelId;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box>
        <Typography variant="caption" color="text.secondary">
          {p.namespace}
          {id ? ` · ${id}` : ''}
        </Typography>
        <Typography variant="h5" component="h2">
          {p.title}
        </Typography>
        {p.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {p.description}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        <CritPill value={p.criticality} />
        <ResultPill result={p.result} gaps={p.gaps} />
        {p.deprecated && <ResultPill result="unknown" text={t('bm.deprecated')} />}
      </Box>
      <Facts
        labelWidth={88}
        items={[
          [t('bm.owner'), ownerName(p) ?? t('bm.noOwner')],
          ['RPO', <>{p.requirement.rpo ?? '—'} <Typography component="span" variant="caption" color="text.secondary">{from(p.requirement.from.rpo)}</Typography></>],
          ['RTO', <>{p.requirement.rto ?? '—'} <Typography component="span" variant="caption" color="text.secondary">{from(p.requirement.from.rto)}</Typography></>],
          [t('bm.retention'), p.requirement.retention ?? '—'],
          ['BPMN', p.processKey ? <Id>{p.processKey}</Id> : '—'],
          [t('bm.subprocesses'), p.subprocesses?.length ? t('bm.subprocesses.count', { n: p.subprocesses.length }) : '—'],
        ]}
      />
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: rq.muted }}>{t('bm.dependsOn')}</Typography>
      {p.services.length ? (
        <Box sx={{ display: 'grid', gap: 1 }}>
          {p.services.map(s => (
            <Box key={s.ref} sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'flex-start', p: 1, border: `1px solid ${rq.border}`, borderRadius: '6px' }}>
              <Box sx={{ minWidth: 0 }}>
                <Link to={consolePath(s.ref)} style={{ fontWeight: 500, color: rq.ink }}>
                  {s.title}
                </Link>
                <Typography variant="caption" color="text.secondary" component="div">
                  {[s.tier, s.delivers ? `RPO ${s.delivers.rpo ?? '—'} · RTO ${s.delivers.rto ?? '—'}` : undefined, ...s.gaps.map(g => `${nameOf(g.element)}: ${gapText(g)}`)]
                    .filter(Boolean)
                    .join(' · ') || t('bm.noSla')}
                </Typography>
              </Box>
              <ResultPill result={s.result} gaps={s.gaps} />
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t('bm.noApps')}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" disableElevation size="small" component={Link} to={consolePath(p.ref)}>
          {t('bm.openProcess')}
        </Button>
        <Button variant="outlined" size="small" component={Link} to={editProcessUrl(p)}>
          {t('bm.edit')}
        </Button>
      </Box>
    </Box>
  );
};

/** The bar of the map: which customer, all processes or the gaps only, and the criticality legend with its defaults. */
const MapBar = ({ map, gapsOnly, onGaps, onCustomer }: { map: MapData; gapsOnly: boolean; onGaps: (v: boolean) => void; onCustomer: (ns: string) => void }) => {
  const { t } = useI18n();
  const label = { fontSize: 12, color: 'text.secondary', mr: 1 };
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography component="span" id="bm-customer" sx={label}>
            {t('bm.customer')}
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={map.namespace ?? ''} aria-labelledby="bm-customer" onChange={(_, v) => v && onCustomer(v)}>
            {map.namespaces.map(ns => (
              <ToggleButton key={ns} value={ns} sx={{ textTransform: 'none', px: 1.25, py: 0.25 }}>
                {ns}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography component="span" id="bm-show" sx={label}>
            {t('bm.show')}
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={gapsOnly ? 'gaps' : 'all'} aria-labelledby="bm-show" onChange={(_, v) => v && onGaps(v === 'gaps')}>
            <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.25, py: 0.25 }}>
              {t('bm.all')}
            </ToggleButton>
            <ToggleButton value="gaps" sx={{ textTransform: 'none', px: 1.25, py: 0.25 }}>
              {t('bm.gapsOnly')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>
      <Box aria-label={t('bm.legend')} role="group" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography component="span" sx={label}>
          {t('bm.criticality')}
        </Typography>
        {CRITICALITIES.map(c => (
          <CritPill key={c} value={c}>
            {t(`bm.crit.${c}`)}
            {map.defaults[c] ? ` · RPO ${map.defaults[c]?.rpo ?? '—'} · RTO ${map.defaults[c]?.rto ?? '—'}` : ''}
          </CritPill>
        ))}
      </Box>
    </Box>
  );
};

/**
 * Business management › Business continuity (the business map): the business processes of each customer by domain and subdomain, whether the platform under
 * them meets their continuity requirement, and the way to change them (templates, by pull request). The customer
 * and the selected process are in the URL (?ns=&process=).
 */
export const BusinessMapPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const [ns, setNs] = useCustomer();
  const [params, setParams] = useSearchParams();
  const loaded = useBusinessMap(ns);
  const { loading, error } = loaded;
  // the map draws the top processes; the sub-processes are in the page of their parent
  const data = useMemo(() => (loaded.data ? topProcesses(loaded.data) : undefined), [loaded.data]);
  const gapsOnly = params.get('show') === 'gaps';
  const set = (k: string, v?: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const blocks = data ? mapBlocks(data, gapsOnly) : [];
  const stats = data ? mapStats(data) : undefined;
  const selected = data?.processes.find(p => p.name === params.get('process')) ?? undefined;
  const customer = data?.namespace;

  const actions = (
    <>
      <BusinessMapTabs />
      <Button variant="outlined" size="small" component={Link} to={importModelUrl(customer)}>
        {t('bm.import')}
      </Button>
      <Button variant="outlined" size="small" component={Link} to={adoptModelUrl(customer)}>
        {t('bm.adopt')}
      </Button>
      <Button variant="contained" disableElevation size="small" component={Link} to={newProcessUrl(selected?.domain || undefined)}>
        {t('bm.new')}
      </Button>
    </>
  );

  return (
    <>
      <TitleRow crumbs={[[t('nav.portal'), '/console'], [t('nav.businessMap')]]} title={t('nav.businessMap')} sub={t('bm.sub')} actions={actions} />
      {loading && !data && <Progress />}
      {error && (
        <EmptyState tone="neg" title={t('bm.error')}>
          {error}
        </EmptyState>
      )}
      {data && !data.namespaces.length && (
        <EmptyState title={t('bm.empty')} action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" disableElevation size="small" component={Link} to={importModelUrl()}>
              {t('bm.import')}
            </Button>
            <Button variant="outlined" size="small" component={Link} to={adoptModelUrl()}>
              {t('bm.adopt')}
            </Button>
          </Box>
        }>
          {t('bm.empty.hint')}
        </EmptyState>
      )}
      {data && stats && data.namespaces.length > 0 && (
        <>
          <MapBar map={data} gapsOnly={gapsOnly} onGaps={v => set('show', v ? 'gaps' : undefined)} onCustomer={setNs} />
          <Kpis
            items={[
              { label: t('bm.kpi.processes'), value: stats.processes },
              { label: t('bm.kpi.critical'), value: stats.critical },
              { label: t('bm.kpi.gaps'), value: stats.gaps, tone: stats.gaps ? 'bad' : undefined },
              { label: t('bm.kpi.unowned'), value: stats.unowned },
              { label: t('bm.kpi.model'), value: <Box component="span" sx={{ fontSize: 16 }}>{stats.model?.title ?? '—'}</Box>, note: stats.model?.version },
            ]}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, gap: 3, alignItems: 'start' }}>
            <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
              {blocks.map(b => (
                <Box component="section" key={b.domain?.ref ?? 'other'} aria-label={b.domain?.title ?? t('bm.otherDomain')} sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', p: 2, display: 'grid', gap: 1.5, bgcolor: rq.raised }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Typography variant="h5" component="h2">
                      {b.domain?.title ?? t('bm.otherDomain')}
                    </Typography>
                    {(b.domain?.pcfId || b.domain?.modelId) && (
                      <Typography variant="caption" color="text.secondary">
                        {b.domain?.pcfId ? `PCF ${b.domain.pcfId}` : b.domain?.modelId}
                      </Typography>
                    )}
                  </Box>
                  {b.subs.map(s => (
                    <Box key={s.domain?.ref ?? 'direct'} sx={{ display: 'grid', gap: 1 }}>
                      {s.domain && (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: 13, fontWeight: 600, color: rq.muted }}>
                          <span>{s.domain.title}</span>
                          {(s.domain.pcfId || s.domain.modelId) && <Box component="span" sx={{ fontWeight: 400, fontSize: 12 }}>{s.domain.pcfId ?? s.domain.modelId}</Box>}
                        </Box>
                      )}
                      {s.processes.length ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1 }}>
                          {s.processes.map(p => (
                            <ProcessCard key={p.ref} p={p} on={selected?.ref === p.ref} onPick={() => set('process', selected?.ref === p.ref ? undefined : p.name)} />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {t('bm.noProcesses')}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              ))}
              {!blocks.length && <EmptyState title={gapsOnly ? t('bm.noGaps') : t('bm.noProcessesYet')} />}
            </Box>
            <Box component="aside" aria-label={t('bm.selected')} sx={{ position: { lg: 'sticky' }, top: { lg: 16 }, border: `1px solid ${rq.border}`, borderRadius: '8px', p: 2, bgcolor: rq.sheet }}>
              <ProcessPanel p={selected} />
            </Box>
          </Box>
        </>
      )}
    </>
  );
};
