import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBusinessMap } from '../../businessMap';
import { useI18n } from '../../i18n';
import { type OrganisationData, type Person, type Side, useOrganisation } from '../../organisation';
import { useRq } from '../../theme/consoleTheme';
import { Id, Pill, TitleRow } from '../ui';
import { BusinessMapTabs, useCustomer } from './BusinessMapTabs';
import { NamespacePicker } from './DashboardParts';

/** Which organisation a page shows: ?side= in the URL, the customer's unless it says provider. */
export function useSide(): [Side, (s: Side) => void] {
  const [params, setParams] = useSearchParams();
  const side: Side = params.get('side') === 'provider' ? 'provider' : 'customer';
  const set = (s: Side) => {
    const next = new URLSearchParams(params);
    next.set('side', s);
    next.delete('team');
    setParams(next, { replace: true });
  };
  return [side, set];
}

/** Two or three choices in one control, one of them pressed. */
export const Choice = <T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) => {
  const rq = useRq();
  return (
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', border: `1px solid ${rq.control}`, borderRadius: '6px', overflow: 'hidden' }}>
      {options.map(([k, text]) => (
        <Box
          key={k}
          component="button"
          type="button"
          aria-pressed={k === value}
          onClick={() => onChange(k)}
          sx={{ all: 'unset', cursor: 'pointer', px: 1.75, py: 0.75, fontSize: 14, lineHeight: '20px', color: k === value ? rq.onPrimary : rq.muted, bgcolor: k === value ? rq.primary : 'transparent', '&:focus-visible': { outline: `2px solid ${rq.data}`, outlineOffset: -2 } }}
        >
          {text}
        </Box>
      ))}
    </Box>
  );
};

/** A person: its name over its user name. */
export const PersonCell = ({ person, role }: { person: Pick<Person, 'name' | 'user'>; role?: string }) => (
  <Box>
    <Box>{person.name}</Box>
    <Typography variant="caption" color="text.secondary" component="div">
      <Id>{person.user}</Id>
      {role ? ` · ${role}` : ''}
    </Typography>
  </Box>
);

/** Whether a person has a Keycloak user; nothing when the catalog could not tell. */
export const KeycloakPill = ({ inKeycloak }: { inKeycloak?: boolean }) => {
  const { t } = useI18n();
  if (inKeycloak === undefined) return null;
  return <Pill tone={inKeycloak ? 'pos' : 'neg'}>{t(inKeycloak ? 'org.inKc' : 'org.notInKc')}</Pill>;
};

/** The frame of the organisation pages: title, customer picker, the views, then the organisations of the customer. */
export const OrganisationFrame = ({ view, title, sub, children }: { view: string; title: string; sub: string; children: (data: OrganisationData, reload: () => void) => ReactNode }) => {
  const { t } = useI18n();
  const [ns, setNs] = useCustomer();
  const map = useBusinessMap(ns);
  const org = useOrganisation(ns);
  const namespace = org.data?.namespace ?? map.data?.namespace;
  const crumbs: Array<[string, string?]> = [[t('nav.portal'), '/console'], [t('bmd.crumb'), '/console/business-map'], [view]];
  return (
    <Box>
      <TitleRow
        crumbs={crumbs}
        title={namespace ? `${title} · ${namespace}` : title}
        sub={sub}
        actions={map.data ? <NamespacePicker namespaces={map.data.namespaces} value={namespace} onChange={setNs} /> : undefined}
      />
      <BusinessMapTabs />
      <Box sx={{ display: 'grid', gap: 2.5, mt: 2.5 }}>
        {org.loading && !org.data && <Progress />}
        {org.error && <WarningPanel title={t('bm.error')} message={org.error} />}
        {org.data && children(org.data, org.reload)}
      </Box>
    </Box>
  );
};
