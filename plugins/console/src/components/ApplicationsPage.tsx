import { Link, Progress, WarningPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useConsoleConfig } from '../config';
import { useClusterOverview } from '../overview';
import { appRank } from './ClusterOverviewPage';
import { useI18n } from '../i18n';
import { Id, Pill, Section, TitleRow, choose, type Tone } from './ui';
import { healthTone, syncTone } from './ui-infra';
import { Table } from './NetworkPage';

/** Component names of the catalog, to link an Argo CD application to its page when they share the name. */
function useComponentNames() {
  const catalog = useApi(catalogApiRef);
  const [names, setNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter: { kind: 'component' }, fields: ['metadata.name'] }).then(
      r => alive && setNames(new Set(r.items.map(e => e.metadata.name))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return names;
}

/** Cluster layer › Applications: every Argo CD application of this cluster, problems first. */
export const ApplicationsPage = () => {
  const cfg = useConsoleConfig();
  const { loading, data, error, reload } = useClusterOverview();
  const names = useComponentNames();
  const { t } = useI18n();
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [text, setText] = useState('');
  const apps = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (data?.apps ?? [])
      .filter(a => !onlyProblems || appRank(a) < 2)
      .filter(a => !q || a.name.toLowerCase().includes(q) || (a.namespace ?? '').toLowerCase().includes(q))
      .sort((a, b) => appRank(a) - appRank(b) || a.name.localeCompare(b.name));
  }, [data, onlyProblems, text]);
  const problems = (data?.apps ?? []).filter(a => appRank(a) < 2).length;
  const bad = (data?.apps ?? []).filter(a => a.health !== 'Healthy').length;
  const sync = (data?.apps ?? []).filter(a => a.sync !== 'Synced').length;
  return (
    <Box sx={{ maxWidth: 1240 }}>
      <TitleRow
        crumbs={[[cfg.cluster.id, '/console/cluster'], [t('nav.applications')]]}
        title={t('apps.title', { cluster: cfg.cluster.id })}
        pills={data && <Pill tone={problems ? 'warn' : 'pos'} plain>{`${data.apps.length}`}</Pill>}
        sub={t('apps.sub')}
        finding={data && (problems ? t('apps.finding', { bad, sync }) : t('apps.findingOk'))}
        findingTone={choose<Tone>([[bad, 'neg'], [problems, 'warn']], 'pos')}
        actions={
          <Button variant="text" onClick={reload} disabled={loading}>
            {t('cluster.refresh')}
          </Button>
        }
      />
      {loading && !data && <Progress />}
      {error && <WarningPanel title={t('apps.unreadable')} message={error} />}
      {data && (
        <Section flush>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', px: 2.25, py: 1.5 }}>
            <TextField size="small" label={t('apps.find')} value={text} onChange={e => setText(e.target.value)} sx={{ minWidth: 240 }} />
            <Box role="group" aria-label="Filter" sx={{ display: 'inline-flex', p: '2px', gap: '2px', borderRadius: '6px', bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
              {[false, true].map(v => (
                <Button
                  key={String(v)}
                  size="small"
                  variant="text"
                  onClick={() => setOnlyProblems(v)}
                  aria-pressed={onlyProblems === v}
                  sx={{ px: 1.5, height: 28, color: onlyProblems === v ? 'text.primary' : 'text.secondary', bgcolor: onlyProblems === v ? 'background.paper' : 'transparent', boxShadow: onlyProblems === v ? 1 : 0 }}
                >
                  {v ? t('apps.problems', { n: problems }) : `${t('apps.all')} ${data.apps.length}`}
                </Button>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {t('apps.shown', { n: apps.length, total: data.apps.length })}
            </Typography>
          </Box>
          <Table
            head={[t('cluster.application'), t('cluster.health'), t('cluster.sync'), t('cluster.namespace')]}
            rows={apps.map(a => [
              names.has(a.name) ? (
                <Link to={`/console/entity/default/component/${a.name}`} style={{ fontWeight: 500 }}>
                  {a.name}
                </Link>
              ) : (
                <Box component="span" sx={{ fontWeight: 500 }}>
                  {a.name}
                </Box>
              ),
              <Pill tone={healthTone(a.health)}>{a.health}</Pill>,
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                <Pill tone={syncTone(a.sync)}>{a.sync}</Pill>
                {a.autosync && <Pill plain>auto</Pill>}
              </Box>,
              a.namespace ? (
                <Link to={`/console/namespaces/${a.namespace}`}>
                  <Id>{a.namespace}</Id>
                </Link>
              ) : (
                '—'
              ),
            ])}
          />
        </Section>
      )}
    </Box>
  );
};
