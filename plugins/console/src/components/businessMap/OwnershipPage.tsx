import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { type ApplicationOwnership, hasGap, type OrganisationData, type Owner, ownershipCounts, ownerState, peopleOf, type PullAnswer, type Side, useBusinessMapPost } from '../../organisation';
import { Table } from '../NetworkPage';
import { EmptyState, Id, Kpis, Pill, Section } from '../ui';
import { Choice, KeycloakPill, OrganisationFrame } from './OrgParts';
import { CritPill } from './parts';

const NOBODY = '';

/** The product owner of one side: the person, its user, its team and its unit; or nobody. */
const OwnerCell = ({ owner, side, namespace }: { owner?: Owner; side: Side; namespace: string }) => {
  const { t } = useI18n();
  if (!owner) return <Pill tone="neg">{t('own.nobody')}</Pill>;
  const team = owner.unit && owner.team ? `${owner.unit}/${owner.team}` : undefined;
  return (
    <Box sx={{ minWidth: 190 }}>
      <Box>{owner.name}</Box>
      <Typography variant="caption" color="text.secondary" component="div">
        <Id>{owner.user}</Id>
        {owner.team && (
          <>
            {' · '}
            <Link to={`/console/business-map/organisation?ns=${encodeURIComponent(namespace)}&side=${side}${team ? `&team=${encodeURIComponent(team)}` : ''}`}>{owner.team}</Link>
          </>
        )}
      </Typography>
      {owner.unit && (
        <Typography variant="caption" color="text.secondary" component="div">
          {owner.unit}
        </Typography>
      )}
      {owner.inKeycloak === false && (
        <Box sx={{ mt: 0.5 }}>
          <KeycloakPill inKeycloak={false} />
        </Box>
      )}
    </Box>
  );
};

/** Names the product owner of an application on each side: a person of that organisation; each change is a pull request. */
const AssignDialog = ({ app, data, onClose, onDone }: { app: ApplicationOwnership; data: OrganisationData; onClose: () => void; onDone: (text: string) => void }) => {
  const { t } = useI18n();
  const post = useBusinessMapPost();
  const [pick, setPick] = useState<Record<Side, string>>({ customer: app.customer?.user ?? NOBODY, provider: app.provider?.user ?? NOBODY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const changed = (['customer', 'provider'] as Side[]).filter(s => data[s] && pick[s] !== (app[s]?.user ?? NOBODY));
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const opened: number[] = [];
      for (const side of changed) {
        const a = await post<PullAnswer>('/organisation/owner', { side, namespace: data.namespace, application: app.name, user: pick[side] || undefined });
        opened.push(a.pull.number);
      }
      onDone(opened.map(n => t('own.opened', { n })).join(' '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('own.dialog', { app: app.title })}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {(['customer', 'provider'] as Side[]).map(side => {
          const org = data[side];
          if (!org) {
            return (
              <Typography key={side} color="text.secondary">
                {t('own.dialog.noOrg', { side: t(`org.side.${side}`).toLowerCase() })}
              </Typography>
            );
          }
          return (
            <TextField key={side} select size="small" label={t(`own.col.${side}`)} value={pick[side]} onChange={e => setPick(p => ({ ...p, [side]: e.target.value }))}>
              <MenuItem value={NOBODY}>{t('own.dialog.none')}</MenuItem>
              {peopleOf(org).map(p => (
                <MenuItem key={p.user} value={p.user}>
                  {p.name} · {p.team ?? p.unit ?? org.title}
                  {p.inKeycloak === false ? ` · ${t('org.notInKc').toLowerCase()}` : ''}
                </MenuItem>
              ))}
            </TextField>
          );
        })}
        {error && <Typography color="error">{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('own.dialog.cancel')}</Button>
        <Button variant="contained" disableElevation disabled={busy || changed.length === 0} onClick={save}>
          {t('own.dialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/** Business continuity › Ownership: the customer and the provider product owner of each business application. */
export const OwnershipPage = () => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'all' | 'gaps'>('all');
  const [editing, setEditing] = useState<ApplicationOwnership>();
  const [note, setNote] = useState<string>();
  return (
    <OrganisationFrame view={t('bm.view.ownership')} title={t('bm.view.ownership')} sub={t('own.sub')}>
      {(data, reload) => {
        const c = ownershipCounts(data.applications);
        const shown = data.applications.filter(a => mode === 'all' || hasGap(a));
        return (
          <>
            <Kpis
              items={[
                { label: t('own.kpi.apps'), value: c.applications, note: t('own.kpi.of', { ns: data.namespace }) },
                { label: t('own.kpi.complete'), value: c.complete, note: t('own.kpi.completeNote') },
                { label: t('own.kpi.none'), value: c.noCustomer + c.noProvider, note: t('own.kpi.noneNote', { c: c.noCustomer, p: c.noProvider }), tone: c.noCustomer + c.noProvider ? 'bad' : undefined },
                { label: t('own.kpi.noUser'), value: c.noUser, note: t('own.kpi.noUserNote'), tone: c.noUser ? 'bad' : undefined },
              ]}
            />
            <Section title={t('own.title')} flush>
              <Box sx={{ px: 2.25, pb: 1.5, display: 'grid', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('own.tableSub')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                  <Choice label={t('own.show')} value={mode} onChange={setMode} options={[['all', t('own.all')], ['gaps', t('own.gaps')]]} />
                  <Typography variant="caption" color="text.secondary">
                    {t('own.gapNote')}
                  </Typography>
                </Box>
                {note && (
                  <Typography role="status" variant="body2">
                    {note}
                  </Typography>
                )}
                {!data.may && (
                  <Typography variant="caption" color="text.secondary">
                    {t('own.onlyWriters')}
                  </Typography>
                )}
              </Box>
              {data.applications.length === 0 && <EmptyState title={t('own.none')}>{t('own.none.why')}</EmptyState>}
              {data.applications.length > 0 && shown.length === 0 && <EmptyState title={t('own.noGaps')} />}
              {shown.length > 0 && (
                <Table
                  head={[t('own.col.app'), t('org.col.criticality'), t('own.col.customer'), t('own.col.provider'), t('own.col.state'), ...(data.may ? [''] : [])]}
                  rows={shown.map(a => {
                    const sc = ownerState(a.customer);
                    const sp = ownerState(a.provider);
                    return [
                      <Box key="a" sx={{ minWidth: 200 }}>
                        <Box>{a.title}</Box>
                        <Typography variant="caption" color="text.secondary" component="div">
                          <Id>{a.name}</Id> · {t('own.processes', { n: a.processes })}
                        </Typography>
                      </Box>,
                      a.criticality ? <CritPill key="c" value={a.criticality as 'critical' | 'important' | 'standard'} /> : '—',
                      <OwnerCell key="oc" owner={a.customer} side="customer" namespace={data.namespace} />,
                      <OwnerCell key="op" owner={a.provider} side="provider" namespace={data.namespace} />,
                      <Box key="s" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {sc === 'ok' && sp === 'ok' && <Pill tone="pos">{t('own.state.complete')}</Pill>}
                        {sc === 'none' && <Pill tone="neg">{t('own.state.noCustomer')}</Pill>}
                        {sp === 'none' && <Pill tone="neg">{t('own.state.noProvider')}</Pill>}
                        {(sc === 'no-user' || sp === 'no-user') && <Pill tone="warn">{t('own.state.noUser')}</Pill>}
                      </Box>,
                      ...(data.may
                        ? [
                            <Button key="b" size="small" onClick={() => setEditing(a)} sx={{ textTransform: 'none' }}>
                              {t(sc === 'none' || sp === 'none' ? 'own.assign' : 'own.change')}
                            </Button>,
                          ]
                        : []),
                    ];
                  })}
                />
              )}
            </Section>
            {editing && (
              <AssignDialog
                app={editing}
                data={data}
                onClose={() => setEditing(undefined)}
                onDone={text => {
                  setEditing(undefined);
                  setNote(text);
                  reload();
                }}
              />
            )}
          </>
        );
      }}
    </OrganisationFrame>
  );
};
