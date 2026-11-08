import { parseEntityRef } from '@backstage/catalog-model';
import { Link, Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useRq } from '../../theme/consoleTheme';
import { EmptyState, Facts, Id, Kpis, Pill, Section, TitleRow, type Tone, choose } from '../ui';
import { cell } from './heatmap';
import { type AppRow, type Line, STAGES, compareLines, daysBetween, latestLines } from './model';
import { Chips, Table, argoName, entityPath, factNum, levelTone, lineClass, todayIso } from './shared';
import { type FactsMap, useFrameworksData } from './useFrameworksData';

type TabId = 'apps' | 'security' | 'requirements' | 'notes';
const TABS: TabId[] = ['apps', 'security', 'requirements', 'notes'];

/** the instances of the applications of a framework that run a line */
const onLine = (apps: AppRow[], l: Line) =>
  apps.filter(a => a.framework === l.framework).flatMap(a => STAGES.filter(s => a.lines[s] === l.line && a.instances[s]).map(s => ({ app: a, stage: s, ref: a.instances[s]! })));

/** sum of a fact over the instances that report it; undefined when none does */
const sumOf = (refs: string[], facts: FactsMap, keys: string[]) => {
  const known = refs.map(r => facts.get(r)).filter(f => keys.every(k => factNum(f, k) !== undefined));
  return known.length ? known.reduce((a, f) => a + keys.reduce((b, k) => b + (factNum(f, k) ?? 0), 0), 0) : undefined;
};

const healthTone = (h?: string): Tone => choose<Tone>([[h === 'Healthy', 'pos'], [h === 'Progressing', 'info'], [h === 'Degraded' || h === 'Missing', 'neg']], 'neu');

/** framework vs own vulnerabilities per line, as two bars with their numbers */
const Layers = ({ lines, apps, facts }: { lines: Line[]; apps: AppRow[]; facts: FactsMap }) => {
  const t = useRq();
  const { t: tr } = useI18n();
  const rows = [...lines].reverse().map(l => {
    const refs = onLine(apps, l).map(i => i.ref);
    return { l, fw: sumOf(refs, facts, ['frameworkLayerCritical', 'frameworkLayerHigh']), own: sumOf(refs, facts, ['ownLayerCritical', 'ownLayerHigh']), n: refs.length };
  }).filter(r => r.n);
  const max = Math.max(1, ...rows.map(r => (r.fw ?? 0) + (r.own ?? 0)));
  if (!rows.length) return <EmptyState title={tr('ln.noApps')} />;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {rows.map(r => (
        <Box key={r.l.ref} sx={{ display: 'grid', gridTemplateColumns: '60px minmax(0, 1fr)', gap: 1, alignItems: 'center', fontSize: 14 }}>
          <span>{r.l.line}</span>
          {r.fw === undefined && r.own === undefined ? (
            <Box component="span" sx={{ color: t.muted }}>
              n/a
            </Box>
          ) : (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', height: 18, width: `${(((r.fw ?? 0) + (r.own ?? 0)) / max) * 70}%`, minWidth: 4, borderRadius: '3px', overflow: 'hidden', bgcolor: t.rule }}>
                <Box sx={{ flex: r.fw ?? 0, bgcolor: t.warning }} />
                <Box sx={{ flex: r.own ?? 0, bgcolor: t.data }} />
              </Box>
              <Box component="span" sx={{ fontSize: 12, color: t.muted, whiteSpace: 'nowrap' }}>
                {r.fw ?? 'n/a'} {tr('ln.layer.framework')} · {r.own ?? 'n/a'} {tr('ln.layer.own')}
              </Box>
            </Box>
          )}
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary">
        <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 10, height: 10, bgcolor: t.warning, mr: 0.5, borderRadius: '2px' }} />
        <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 10, height: 10, bgcolor: t.data, mx: 0.5, borderRadius: '2px' }} />
        {tr('ln.layer.legend')}
      </Typography>
    </Box>
  );
};

/**
 * Portal › Development › Frameworks › a line: what it is and until when, the applications on it, where their
 * vulnerabilities come from, what it needs from the platform and its release notes. /console/frameworks/:line (the
 * name of the line's entity, python-framework-3-3).
 */
export const FrameworkLinePage = () => {
  const { line: name } = useParams();
  const { t: tr } = useI18n();
  const t = useRq();
  const [params, setParams] = useSearchParams();
  const { loading, error, lines, apps, facts, health, entities } = useFrameworksData();
  const today = todayIso();
  const tab: TabId = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as TabId) : 'apps';

  if (loading && !lines.length) return <Progress />;
  if (error) return <WarningPanel title={tr('dev.noCatalog')} message={error} />;
  const l = lines.find(x => parseEntityRef(x.ref).name === name);
  const crumbs: Array<[string, string?]> = [[tr('nav.portal'), '/console'], [tr('dev.development')], [tr('nav.frameworks'), '/console/frameworks']];
  if (!l)
    return (
      <>
        <TitleRow crumbs={[...crumbs, [name ?? '']]} title={name ?? ''} />
        <EmptyState title={tr('ln.notFound')}>{tr('ln.notFoundText')}</EmptyState>
      </>
    );

  const own = lines.filter(x => x.framework === l.framework);
  const isLatest = latestLines(lines).get(l.framework) === l;
  const k = lineClass(l, isLatest);
  const instances = onLine(apps, l);
  const older = apps
    .filter(a => a.framework === l.framework)
    .flatMap(a => STAGES.filter(s => a.lines[s] && compareLines(a.lines[s]!, l.line) < 0).map(s => ({ app: a.application, stage: s, line: a.lines[s]! })));
  const fwSum = sumOf(instances.map(i => i.ref), facts, ['frameworkLayerCritical', 'frameworkLayerHigh']);
  const entity = entities.get(l.ref);
  const finding = l.supportedUntil ? tr('ln.supportedUntil', { date: l.supportedUntil, n: Math.max(0, daysBetween(today, l.supportedUntil)) }) : tr('ln.support', { text: l.supportText || '—' });
  const appHealth = (ref: string) => health.get(argoName(ref, entities));

  return (
    <>
      <TitleRow
        crumbs={[...crumbs, [l.frameworkTitle], [l.line]]}
        title={l.title}
        pills={
          <>
            <Pill tone={choose<Tone>([[k === 'current', 'pos'], [k === 'deprecated', 'warn']], 'neu')}>{tr(`dev.lc.${k}`)}</Pill>
            {l.lifecycle && <Pill plain>{l.lifecycle}</Pill>}
          </>
        }
        sub={
          <>
            <Id>{l.ref}</Id> · {tr('ln.of', { framework: l.frameworkTitle })}
          </>
        }
        finding={finding}
        findingTone={l.supportedUntil && daysBetween(today, l.supportedUntil) < 183 ? 'neg' : 'info'}
        actions={
          <>
            {l.links.slice(0, 3).map(x => (
              <Button key={x.url} href={x.url} target="_blank" rel="noreferrer" variant="outlined" size="small" endIcon={<OpenInNew fontSize="small" />}>
                {x.title}
              </Button>
            ))}
            {isLatest && (
              <Button component={Link} to={`/console/development/${l.framework}-app`} variant="contained" disableElevation size="small">
                {tr('ln.newOn', { line: l.line })}
              </Button>
            )}
          </>
        }
      />
      <Kpis
        items={[
          { label: tr('ln.kpi.apps', { line: l.line }), value: new Set(instances.map(i => i.app.application)).size },
          { label: tr('ln.kpi.pro'), value: instances.filter(i => i.stage === 'pro').length },
          { label: tr('ln.kpi.toCome'), value: new Set(older.map(o => o.app)).size },
          { label: tr('ln.kpi.fwVulns'), value: fwSum ?? 'n/a', tone: fwSum ? 'bad' : undefined },
        ]}
      />
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v }, { replace: true })} aria-label={tr('ln.tabs')} sx={{ mb: 2, borderBottom: `1px solid ${t.border}` }}>
        {TABS.map(x => (
          <Tab key={x} value={x} label={tr(`ln.tab.${x}`)} sx={{ textTransform: 'none' }} />
        ))}
      </Tabs>

      {tab === 'apps' && (
        <Section flush foot={older.length ? <span>{tr('ln.coming', { line: l.line, list: older.map(o => `${o.app} (${o.line}, ${o.stage})`).join(', ') })}</span> : undefined}>
          {instances.length ? (
            <Table head={[tr('dev.application'), tr('dev.stage'), tr('ln.health'), tr('ln.coverage'), tr('ln.ownVulns'), tr('dev.blocks')]} minWidth={760}>
              {instances.map(i => {
                const f = facts.get(i.ref);
                const ctx = { status: { kind: 'latest' as const }, hasDocs: true };
                const cov = cell('coverage', f, ctx);
                const ov = cell('ownVulns', f, ctx);
                const h = appHealth(i.ref);
                return (
                  <tr key={i.ref}>
                    <td>
                      <Link to={entityPath(i.ref)} style={{ fontWeight: 500 }}>
                        {i.app.application}
                      </Link>
                      <Box sx={{ fontSize: 12, color: t.muted }}>{(i.app.owner ?? '').replace(/^group:(default\/)?/, '')}</Box>
                    </td>
                    <td>{i.stage}</td>
                    <td>
                      <Pill tone={healthTone(h)}>{h ?? 'n/a'}</Pill>
                    </td>
                    <td>
                      <Pill tone={levelTone(cov.level)}>{cov.text}</Pill>
                    </td>
                    <td>
                      <Pill tone={levelTone(ov.level)}>{ov.text}</Pill>
                    </td>
                    <td>
                      <Chips items={i.app.blocks} />
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState title={tr('ln.noApps')} />
          )}
        </Section>
      )}

      {tab === 'security' && (
        <>
          <Section title={tr('ln.layers')}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {tr('ln.layersMeta')}
            </Typography>
            <Layers lines={own} apps={apps} facts={facts} />
          </Section>
          <Section title={tr('ln.eol')} meta={tr('ln.eolMeta')} flush>
            <Table head={[tr('fw.line'), tr('ln.eol.os'), tr('ln.eol.ended'), tr('ln.eol.soon'), tr('ln.eol.which')]} minWidth={720}>
              {[...own].reverse().map(x => {
                const refs = onLine(apps, x).map(i => i.ref);
                if (!refs.length) return null;
                const which = [...new Set(refs.flatMap(r => String(facts.get(r)?.componentsOutOfSupport ?? '').split(',').map(s => s.trim()).filter(Boolean)))];
                const num = (key: string) => sumOf(refs, facts, [key]) ?? 'n/a';
                return (
                  <tr key={x.ref}>
                    <td>{x.line}</td>
                    <td>{num('osEndOfLife')}</td>
                    <td>{num('componentsEndOfLife')}</td>
                    <td>{num('componentsEndingSoon')}</td>
                    <td>{which.length ? which.join(', ') : '—'}</td>
                  </tr>
                );
              })}
            </Table>
          </Section>
        </>
      )}

      {tab === 'requirements' && (
        <Section title={tr('ln.req')} meta={tr('ln.reqMeta')} flush>
          {l.requires.length ? (
            <Table head={[tr('ln.req.service'), tr('ln.health'), tr('ln.req.status')]} minWidth={480}>
              {l.requires.map(r => {
                const h = health.get(r);
                return (
                  <tr key={r}>
                    <td>
                      <Id>{r}</Id>
                    </td>
                    <td>{h ?? '—'}</td>
                    <td>
                      <Pill tone={choose<Tone>([[h === 'Healthy', 'pos'], [!h, 'neg']], 'warn')}>{choose<string>([[h === 'Healthy', tr('ln.req.ok')], [!h, tr('ln.req.missing')]], h ?? '')}</Pill>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState title={tr('ln.req.none')}>{tr('ln.req.noneText')}</EmptyState>
          )}
        </Section>
      )}

      {tab === 'notes' && (
        <Section title={tr('ln.notes')}>
          <Box sx={{ display: 'grid', gap: 2 }}>
            {entity?.metadata.description && <Typography sx={{ maxWidth: '90ch' }}>{entity.metadata.description}</Typography>}
            <Facts
              items={[
                [tr('dev.framework'), l.frameworkTitle],
                ['refresquito.io/versions', l.versions || '—'],
                ['refresquito.io/supported-until', l.supportText || '—'],
              ]}
              labelWidth={220}
            />
            <Box>
              <Typography variant="h6" component="h3" sx={{ fontSize: 15, mb: 0.75 }}>
                {tr('ln.links')}
              </Typography>
              {l.links.length ? (
                <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.5 }}>
                  {l.links.map(x => (
                    <li key={x.url}>
                      <a href={x.url} target="_blank" rel="noreferrer">
                        {x.title}
                      </a>
                    </li>
                  ))}
                </Box>
              ) : (
                <Typography color="text.secondary">{tr('ln.noLinks')}</Typography>
              )}
            </Box>
          </Box>
        </Section>
      )}
      {loading && <Progress />}
    </>
  );
};
