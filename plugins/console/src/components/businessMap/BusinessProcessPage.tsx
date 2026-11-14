import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { Progress } from '@backstage/core-components';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowForward from '@mui/icons-material/ArrowForward';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { Link, useLocation } from 'react-router-dom';
import { type CheckElement, type MapProcess, type Origin, useBusinessMap, useEngine, useProcessCheck } from '../../businessMap';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { EntityDependenciesContent } from '../EntityDependencies';
import { EmptyState, Id, Section, TitleRow } from '../ui';
import { chainColumns, closeAdvice, consolePath, editProcessUrl, gapText, nameOf, originText, parentsOf, workaroundText, type ProcessNode, subprocessTree, treeSize, UNASSIGNED } from './businessMapModel';
import { ProcessModel } from './ProcessModel';
import { CritPill, pair, ResultPill } from './parts';

/** The sub-processes of a process, nested, each a link to its page with its criticality and its check. */
const SubprocessList = ({ nodes }: { nodes: ProcessNode[] }) => {
  const rq = useRq();
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.5 }}>
      {nodes.map(n => (
        <li key={n.process.ref}>
          <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {(n.process.pcfId || n.process.modelId) && <Id>{n.process.pcfId ?? n.process.modelId}</Id>}
            <Link to={consolePath(n.process.ref)} style={{ color: rq.ink, fontWeight: 500 }} title={n.process.description}>
              {n.process.title}
            </Link>
            <CritPill value={n.process.criticality} />
            <ResultPill result={n.process.result} gaps={n.process.gaps} />
          </Box>
          {n.children.length > 0 && <SubprocessList nodes={n.children} />}
        </li>
      ))}
    </Box>
  );
};

/** One card of the requirement: the value, and where it comes from. */
const Card = ({ k, v, w }: { k: string; v: string; w?: string }) => {
  const rq = useRq();
  return (
    <Box sx={{ border: `1px solid ${rq.border}`, borderRadius: '8px', p: 1.5, display: 'grid', gap: 0.25, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {k}
      </Typography>
      <Box sx={{ fontSize: 20, lineHeight: '28px', overflowWrap: 'anywhere' }}>{v}</Box>
      {w && (
        <Typography variant="caption" color="text.secondary">
          {w}
        </Typography>
      )}
    </Box>
  );
};

/** One column of the chain: its heading and the elements, those with a gap marked. */
const Column = ({ title, items, label }: { title: string; items: Array<{ key: string; name: string; sub: string; bad?: boolean; to?: string }>; label?: string }) => {
  const rq = useRq();
  return (
    <Box sx={{ display: 'grid', gap: 1, alignContent: 'start', flex: '1 1 180px', minWidth: 0 }} aria-label={label ?? title}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: rq.muted }}>{title}</Typography>
      {items.map(i => (
        <Box key={i.key} sx={{ border: `1px solid ${i.bad ? rq.negative : rq.border}`, borderLeft: `4px solid ${i.bad ? rq.negative : rq.border}`, borderRadius: '6px', p: 1, display: 'grid', bgcolor: i.bad ? rq.neg.bg : rq.sheet }}>
          {i.to ? (
            <Link to={i.to} style={{ fontWeight: 600, color: i.bad ? rq.neg.fg : rq.ink, overflowWrap: 'anywhere' }}>
              {i.name}
            </Link>
          ) : (
            <Box component="b" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{i.name}</Box>
          )}
          <Typography variant="caption" sx={{ color: i.bad ? rq.neg.fg : rq.muted }}>
            {i.sub}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

/** What the process depends on, as columns: process → business services and applications → stages and blocks → platform services. */
const Chain = ({ p, elements }: { p: MapProcess; elements: CheckElement[] }) => {
  const { t } = useI18n();
  const rq = useRq();
  const cols = chainColumns(elements);
  const node = (e: CheckElement) => ({
    key: e.ref,
    name: nameOf(e.ref),
    sub: [`${e.kind}${e.type ? ` · ${e.type}` : ''}`, e.tier, e.delivers ? `RPO ${e.delivers.rpo ?? '—'} · RTO ${e.delivers.rto ?? '—'}` : undefined].filter(Boolean).join(' · '),
    bad: e.result === 'gap',
    to: consolePath(e.ref),
  });
  const arrow = (
    <Box aria-hidden sx={{ color: rq.control, display: { xs: 'none', md: 'flex' }, alignItems: 'center', pt: 3 }}>
      <ArrowForward fontSize="small" />
    </Box>
  );
  const columns = [
    { title: t('bmp.col.services'), items: [...cols.services, ...cols.applications].map(node) },
    { title: t('bmp.col.blocks'), items: cols.blocks.map(node) },
    { title: t('bmp.col.platform'), items: cols.platform.map(node) },
  ].filter(c => c.items.length);
  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'stretch' }}>
      <Column title={t('bmp.col.process')} items={[{ key: p.ref, name: p.title, sub: `${t(`bm.crit.${p.criticality}`)} · RPO ${p.requirement.rpo ?? '—'} · RTO ${p.requirement.rto ?? '—'}` }]} />
      {columns.map(c => (
        <Box key={c.title} sx={{ display: 'contents' }}>
          {arrow}
          <Column title={c.title} items={c.items} />
        </Box>
      ))}
    </Box>
  );
};

/** The link to the BPMN of the process in the engine (Operaton Cockpit), when it has a key and the engine is known. */
const BpmnButton = ({ processKey }: { processKey?: string }) => {
  const { t } = useI18n();
  const engine = useEngine(processKey);
  if (!processKey) return null;
  const href = engine.data?.definitionUrl ?? engine.data?.cockpitUrl;
  const label = t('bmp.bpmn', { key: processKey });
  if (!href) {
    return (
      <Tooltip title={engine.loading ? t('bmp.bpmn.loading') : t('bmp.bpmn.noEngine')}>
        <span>
          <Button variant="outlined" size="small" disabled>
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <Button variant="outlined" size="small" href={href} target="_blank" rel="noreferrer" endIcon={<OpenInNew sx={{ fontSize: '16px !important' }} />}>
      {label}
    </Button>
  );
};

/** The continuity check of the chain: each element, its support tier (for reference), what it delivers and needs. */
const CheckTable = ({ elements, needs }: { elements: CheckElement[]; needs: { rpo: string | null; rto: string | null } }) => {
  const { t } = useI18n();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('bmp.element')}</TableCell>
          <TableCell>{t('bmp.kind')}</TableCell>
          <TableCell>{t('bmp.tier')}</TableCell>
          <TableCell>{t('bmp.delivers')}</TableCell>
          <TableCell>{t('bmp.needs')}</TableCell>
          <TableCell>{t('bmp.result')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {elements.map(e => (
          <TableRow key={e.ref} hover>
            <TableCell>
              <Link to={consolePath(e.ref)}>
                <Id>{nameOf(e.ref)}</Id>
              </Link>
            </TableCell>
            <TableCell>
              {e.kind}
              {e.type ? ` · ${e.type}` : ''}
            </TableCell>
            <TableCell>{e.tier ?? '—'}</TableCell>
            <TableCell>{pair(e.delivers)}</TableCell>
            <TableCell>{pair(needs)}</TableCell>
            <TableCell>
              <ResultPill result={e.result} text={e.gap?.length ? e.gap.map(gapText).join(' · ') : undefined} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

/**
 * The console page of a BusinessProcess (/console/entity/:ns/businessprocess/:name): its continuity requirement and
 * where each value comes from, the chain under it, the check of each element, how to close the gaps, the BPMN in the
 * process engine and the data it handles. Dependencies: the dependency view the console has for any entity.
 */
export const BusinessProcessPage = ({ entity }: { entity: Entity }) => {
  const { t } = useI18n();
  const rq = useRq();
  const { pathname } = useLocation();
  const ns = entity.metadata.namespace ?? 'default';
  const ref = stringifyEntityRef(entity).toLowerCase();
  const map = useBusinessMap(ns);
  const check = useProcessCheck(ns, entity.metadata.name);
  const p = map.data?.processes.find(x => x.ref === ref);
  const all = map.data?.processes ?? [];
  const ancestors = p ? parentsOf(all, p) : [];
  const tree = p ? subprocessTree(all, p.ref) : [];
  const domain = map.data?.domains.find(d => d.ref === p?.domain);
  const parent = map.data?.domains.find(d => d.ref === domain?.parent);
  const base = consolePath(ref);
  const onDeps = pathname.replace(/\/+$/, '').endsWith('/dependencies');
  const elements = check.data?.elements ?? [];
  const gapCount = new Set(p?.gaps.map(g => g.element) ?? []).size;
  const advice = closeAdvice(elements);
  const from = (o: Origin | undefined) => originText(t, o ?? 'default', p?.criticality ?? 'standard');
  const crumbs: Array<[string, string?]> = [
    [t('nav.portal'), '/console'],
    [t('nav.businessMap'), `/console/business-map?ns=${encodeURIComponent(ns)}`],
    [ns],
    ...(parent ? [[parent.title] as [string]] : []),
    ...(domain ? [[domain.title] as [string]] : []),
    ...ancestors.map(a => [a.title, consolePath(a.ref)] as [string, string]),
    [entity.metadata.title ?? entity.metadata.name],
  ];
  const owner = p?.owner && p.owner !== UNASSIGNED ? nameOf(p.owner) : undefined;
  const noChain = check.loading ? t('bmp.reading') : t('bm.noApps');
  const noCheck = check.loading ? t('bmp.reading') : t('bmp.noCheck');

  return (
    <>
      <TitleRow
        crumbs={crumbs}
        title={entity.metadata.title ?? entity.metadata.name}
        pills={
          p && (
            <>
              <CritPill value={p.criticality} />
              {p.result === 'gap' ? <ResultPill result="gap" text={t('bmp.gaps', { n: gapCount })} /> : <ResultPill result={p.result} />}
              {(p.pcfId || p.modelId) && <ResultPill result="unknown" text={p.pcfId ? `PCF ${p.pcfId}` : String(p.modelId)} />}
              {p.deprecated && <ResultPill result="unknown" text={t('bm.deprecated')} />}
            </>
          )
        }
        sub={entity.metadata.description}
        actions={
          <>
            <BpmnButton processKey={p?.processKey} />
            {p && (
              <Button variant="contained" disableElevation size="small" component={Link} to={editProcessUrl(p)}>
                {t('bm.edit')}
              </Button>
            )}
          </>
        }
      />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: -1.5, mb: 2 }}>
        <Id>{ref}</Id>
        {ancestors.length > 0 && (
          <>
            {` · ${t('bmp.subprocessOf')} `}
            <Link to={consolePath(ancestors[ancestors.length - 1].ref)} style={{ color: rq.ink }}>
              {ancestors[ancestors.length - 1].title}
            </Link>
          </>
        )}
      </Typography>
      <Box component="nav" aria-label={t('native.sections')} sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        {[
          [t('nav.overview'), base, !onDeps],
          [t('page.dependencies'), `${base}/dependencies`, onDeps],
        ].map(([label, to, on]) => (
          <Link key={String(to)} to={String(to)} aria-current={on ? 'page' : undefined} style={{ padding: '8px 12px', color: 'inherit', fontWeight: on ? 600 : 400, borderBottom: on ? '2px solid currentColor' : '2px solid transparent', marginBottom: -1, textDecoration: 'none' }}>
            {String(label)}
          </Link>
        ))}
      </Box>
      {onDeps && (
        <EntityProvider entity={entity}>
          <EntityDependenciesContent />
        </EntityProvider>
      )}
      {!onDeps && (map.loading || check.loading) && !p && <Progress />}
      {!onDeps && map.error && (
        <EmptyState tone="neg" title={t('bm.error')}>
          {map.error}
        </EmptyState>
      )}
      {!onDeps && p && (
        <>
          {(p.issues ?? []).map(i => (
            <Alert key={i.key} severity="warning" sx={{ mb: 2 }}>
              {t('bmp.issue.rtoAboveMtpd', { rto: i.rto, mtpd: i.mtpd })}
            </Alert>
          ))}
          <Section title={t('bmp.requirement')}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 1.5 }}>
              <Card k="RPO" v={p.requirement.rpo ?? '—'} w={from(p.requirement.from.rpo)} />
              <Card k="RTO" v={p.requirement.rto ?? '—'} w={from(p.requirement.from.rto)} />
              <Card k={t('bm.retention')} v={p.requirement.retention ?? '—'} w={p.requirement.retention ? t('bm.from.override') : t('bmp.notDeclared')} />
              <Card k={t('bmp.mtpd')} v={p.requirement.mtpd ?? '—'} w={p.requirement.from.mtpd ? from(p.requirement.from.mtpd) : t('bmp.notDeclared')} />
              <Card
                k={t('bmp.workaround')}
                v={workaroundText(t, p.requirement.workaround)}
                w={p.requirement.workaround?.note ?? (p.requirement.from.workaround ? from(p.requirement.from.workaround) : t('bmp.notDeclared'))}
              />
              <Card k={t('bmp.ha')} v={p.requirement.ha ? t('bmp.required') : t('bmp.notRequired')} w={from('default')} />
              <Card k={t('bm.owner')} v={owner ?? t('bm.noOwner')} w={t('bmp.group')} />
              <Card k={t('bmp.classification')} v={p.classification ?? '—'} />
            </Box>
          </Section>
          {tree.length > 0 && (
            <Section title={t('bmp.subprocesses')} meta={t('bmp.subprocesses.meta', { n: treeSize(tree) })}>
              <SubprocessList nodes={tree} />
            </Section>
          )}
          <ProcessModel namespace={ns} process={entity.metadata.name} title={entity.metadata.title ?? entity.metadata.name} />
          <Section title={t('bmp.chain')} meta={t('bmp.onlyPro')}>
            {elements.length ? <Chain p={p} elements={elements} /> : <EmptyState title={noChain} />}
          </Section>
          <Section title={t('bmp.check')} flush foot={<span>{t('bmp.tierNote')}</span>}>
            {elements.length ? <CheckTable elements={elements} needs={{ rpo: p.requirement.rpo, rto: p.requirement.rto }} /> : <EmptyState title={noCheck}>{check.error}</EmptyState>}
          </Section>
          {advice.length > 0 && (
            <Section title={t('bmp.close')}>
              <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}>
                {advice.map((a, i) => (
                  <li key={i}>{t(a.key, a.vars)}</li>
                ))}
              </Box>
            </Section>
          )}
          <Section title={t('bmp.data')}>
            {p.dataProducts.length ? (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {p.dataProducts.map(d => (
                  <Box key={d} component="span" sx={{ px: 1.25, py: 0.5, borderRadius: 999, border: `1px solid ${rq.border}`, fontSize: 13 }}>
                    <Id>{d.replace(/^urn:li:dataProduct:/, '')}</Id>
                    {p.classification ? ` · ${p.classification}` : ''}
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography color="text.secondary">{t('bmp.noData')}</Typography>
            )}
          </Section>
        </>
      )}
      {!onDeps && !map.loading && !map.error && !p && <EmptyState title={t('bmp.notInMap')}>{t('bmp.notInMap.hint')}</EmptyState>}
    </>
  );
};
