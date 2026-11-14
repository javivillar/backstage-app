import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { applicationsOfTeam, countsOf, type Organisation, type OrganisationData, type Side } from '../../organisation';
import { useRq } from '../../theme/consoleTheme';
import { Table } from '../NetworkPage';
import { EmptyState, Facts, Id, Kpis, Pill, Section } from '../ui';
import { Choice, KeycloakPill, OrganisationFrame, PersonCell, useSide } from './OrgParts';
import { CritPill } from './parts';

const importUrl = (ns: string, side: Side) => `/console/business-map/organisation/import?ns=${encodeURIComponent(ns)}&side=${side}`;

/** Saves the organisation as the Excel template (the backend writes it), so it can be changed and imported again. */
function useTemplateDownload(namespace: string, side: Side) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [error, setError] = useState<string>();
  const download = async () => {
    setError(undefined);
    try {
      const res = await fetch(`${await discovery.getBaseUrl('business-map')}/organisation/template?side=${side}&namespace=${encodeURIComponent(namespace)}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `organisation-${side}.xlsx`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { download, error };
}
export { useTemplateDownload };

/** The chart: the head, its units in a row, the teams of each unit stacked under it. */
const Chart = ({ org, data, picked, onPick }: { org: Organisation; data: OrganisationData; picked?: string; onPick: (key: string) => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  const line = rq.control;
  const node = { boxSizing: 'border-box' as const, display: 'grid', gap: '2px', border: `1px solid ${rq.border}`, borderRadius: '8px', bgcolor: rq.sheet, px: 1.5, py: 1, textAlign: 'left' as const, width: 200 };
  return (
    <Box sx={{ overflowX: 'auto', pb: 1 }}>
      <Box sx={{ display: 'grid', justifyItems: 'center', minWidth: 'max-content' }}>
        <Box sx={{ ...node, width: 280, textAlign: 'center', bgcolor: rq.primary, color: rq.onPrimary, borderColor: rq.primary }}>
          <b style={{ fontWeight: 600 }}>{org.title}</b>
          <Typography variant="caption" sx={{ color: 'inherit', opacity: 0.85 }}>
            {org.head ? `${org.head.name}${org.head.role ? ` · ${org.head.role}` : ''}` : t('org.noHead')}
          </Typography>
        </Box>
        {org.units.length > 0 && <Box sx={{ width: '1px', height: 18, bgcolor: line }} />}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', position: 'relative', pt: '18px', '&::before': { content: '""', position: 'absolute', top: 0, left: 100, right: 100, height: '1px', bgcolor: line } }}>
          {org.units.map(u => (
            <Box key={u.name} sx={{ display: 'grid', justifyItems: 'start', position: 'relative', '&::before': { content: '""', position: 'absolute', top: -18, left: 100, width: '1px', height: 18, bgcolor: line } }}>
              <Box sx={{ ...node, bgcolor: rq.raised, borderColor: line }}>
                <b style={{ fontWeight: 600 }}>{u.name}</b>
                <Typography variant="caption" color="text.secondary">
                  {u.head ? u.head.name : t('org.noHead')}
                </Typography>
                {u.head?.role && (
                  <Typography variant="caption" color="text.secondary">
                    {u.head.role}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'grid', gap: 1, mt: 1.25, ml: 2, pl: 1.75, borderLeft: `1px solid ${line}` }}>
                {u.teams.map(team => {
                  const key = `${u.name}/${team.name}`;
                  const apps = applicationsOfTeam(data.applications, org.side, u.name, team.name).length;
                  const missing = team.people.filter(p => p.inKeycloak === false).length;
                  return (
                    <Box
                      key={key}
                      component="button"
                      type="button"
                      aria-pressed={picked === key}
                      onClick={() => onPick(key)}
                      sx={{
                        all: 'unset',
                        ...node,
                        width: 184,
                        cursor: 'pointer',
                        position: 'relative',
                        borderColor: picked === key ? rq.data : rq.border,
                        boxShadow: picked === key ? `0 0 0 1px ${rq.data}` : 'none',
                        '&:hover': { borderColor: rq.data },
                        '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: 2 },
                        '&::before': { content: '""', position: 'absolute', left: -15, top: 18, width: 14, height: '1px', bgcolor: line },
                      }}
                    >
                      <b style={{ fontWeight: 600 }}>{team.name}</b>
                      <Typography variant="caption" color="text.secondary">
                        {t('org.people', { n: team.people.length })}
                        {team.people[0] ? ` · ${team.people[0].name}` : ''}
                      </Typography>
                      {(apps > 0 || missing > 0) && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {apps > 0 && (
                            <Pill tone="info" plain>
                              {t(`org.po.${org.side}`, { n: apps })}
                            </Pill>
                          )}
                          {missing > 0 && <Pill tone="neg">{t('org.kpi.notInKc', { n: missing })}</Pill>}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

const Body = ({ data, side, setSide, picked, onPick }: { data: OrganisationData; side: Side; setSide: (s: Side) => void; picked?: string; onPick: (key: string) => void }) => {
  const { t } = useI18n();
  const org = data[side];
  const tpl = useTemplateDownload(data.namespace, side);
  const toggle = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
      <Choice label={t('org.side')} value={side} onChange={setSide} options={[['customer', t('org.side.customer')], ['provider', t('org.side.provider')]]} />
      {org && (
        <Typography variant="caption" color="text.secondary">
          {t('org.file')} <Id>{org.path}</Id>
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {org && (
        <Button variant="outlined" size="small" onClick={tpl.download}>
          {t('org.template')}
        </Button>
      )}
      {data.may && data.namespace && (
        <Button variant="outlined" size="small" component={Link} to={importUrl(data.namespace, side)}>
          {t('org.import')}
        </Button>
      )}
    </Box>
  );
  if (!data.namespace) return <EmptyState title={t('org.noCustomer')} />;
  if (!org) {
    return (
      <>
        {toggle}
        <Section>
          <EmptyState
            title={t(`org.none.${side}`)}
            action={
              data.may ? (
                <Button variant="contained" disableElevation component={Link} to={importUrl(data.namespace, side)}>
                  {t('org.import')}
                </Button>
              ) : undefined
            }
          >
            {t('org.none.why')}
          </EmptyState>
        </Section>
      </>
    );
  }
  const c = countsOf(org);
  const owned = data.applications.filter(a => a[side]).length;
  const all = data.applications.length;
  const teams = org.units.flatMap(u => u.teams.map(team => ({ key: `${u.name}/${team.name}`, unit: u, team })));
  // the team picked, else the first one that answers for an application, else the first
  const sel = teams.find(x => x.key === picked) ?? teams.find(x => applicationsOfTeam(data.applications, side, x.unit.name, x.team.name).length) ?? teams[0];
  const apps = sel ? applicationsOfTeam(data.applications, side, sel.unit.name, sel.team.name) : [];
  let kcNote = t('org.kpi.kcUnknown');
  if (data.keycloak) kcNote = c.notInKeycloak ? t('org.kpi.notInKc', { n: c.notInKeycloak }) : t('org.kpi.allInKc');
  return (
    <>
      {toggle}
      {tpl.error && <Typography color="error">{tpl.error}</Typography>}
      <Kpis
        items={[
          { label: t('org.kpi.units'), value: c.units },
          { label: t('org.kpi.teams'), value: c.teams },
          { label: t('org.kpi.people'), value: c.people, note: kcNote },
          { label: t(`org.kpi.owners.${side}`), value: `${owned} / ${all}`, note: owned < all ? t('org.kpi.without', { n: all - owned }) : t('org.kpi.covered'), tone: owned < all ? 'bad' : undefined },
        ]}
      />
      <Section
        title={org.title}
        foot={
          <span>
            {t(`org.po.${side}`, { n: 'N' })}: {t('org.legend.po')}
            {data.keycloak ? ` · ${t('org.notInKc')}: ${t('org.legend.kc')}` : ''}
          </span>
        }
      >
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          {t('org.chartSub')}
        </Typography>
        <Chart org={org} data={data} picked={sel?.key} onPick={onPick} />
      </Section>
      {sel && (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, alignItems: 'start' }}>
          <Section title={sel.team.name} flush>
            <Box sx={{ px: 2.25, pb: 1.5 }}>
              <Facts items={[[t('org.team.unit'), sel.unit.name], [t('org.team.reports'), sel.unit.head ? `${sel.unit.head.name}${sel.unit.head.role ? ` · ${sel.unit.head.role}` : ''}` : t('org.noHead')]]} />
            </Box>
            <Table
              head={[t('org.col.person'), t('org.col.role'), ...(data.keycloak ? [t('org.col.keycloak')] : [])]}
              rows={sel.team.people.map(p => [<PersonCell key="p" person={p} />, p.role ?? '—', ...(data.keycloak ? [<KeycloakPill key="k" inKeycloak={p.inKeycloak} />] : [])])}
            />
          </Section>
          <Section title={t('org.team.apps')} flush>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 2.25, pb: 1.25 }}>
              {t(`org.team.appsSub.${side}`)}
            </Typography>
            {apps.length === 0 ? (
              <Typography color="text.secondary" sx={{ px: 2.25, pb: 2 }}>
                {t('org.team.noApps')}
              </Typography>
            ) : (
              <Table
                head={[t('org.col.application'), t('org.col.owner'), t('org.col.criticality')]}
                rows={apps.map(a => [
                  <Box key="a">
                    <Box>{a.title}</Box>
                    <Typography variant="caption" color="text.secondary" component="div">
                      <Id>{a.name}</Id>
                    </Typography>
                  </Box>,
                  a[side] ? <PersonCell key="o" person={a[side]!} /> : '—',
                  a.criticality ? <CritPill key="c" value={a.criticality as 'critical' | 'important' | 'standard'} /> : '—',
                ])}
              />
            )}
            <Box sx={{ px: 2.25, py: 1.5 }}>
              <Link to={`/console/business-map/ownership?ns=${encodeURIComponent(data.namespace)}`}>{t('org.team.seeAll')}</Link>
            </Box>
          </Section>
        </Box>
      )}
    </>
  );
};

/** Business continuity › Organisation: the organisation of the customer or of the provider as a chart, and the team picked. */
export const OrganisationPage = () => {
  const { t } = useI18n();
  const [side, setSide] = useSide();
  const [params, setParams] = useSearchParams();
  const pick = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('team', key);
    setParams(next, { replace: true });
  };
  return (
    <OrganisationFrame view={t('bm.view.organisation')} title={t('bm.view.organisation')} sub={t('org.sub')}>
      {data => <Body data={data} side={side} setSide={setSide} picked={params.get('team') ?? undefined} onPick={pick} />}
    </OrganisationFrame>
  );
};
