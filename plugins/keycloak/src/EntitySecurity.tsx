import { useEffect, useState } from 'react';
import { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  useApi,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { InfoCard } from '@backstage/core-components';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableBody from '@mui/material/TableBody';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

/*
 * The Security tab of a Component: the Keycloak groups, clients and roles that say they belong to it (attributes
 * refresquito.* in Keycloak, contract in identity/README.md of refresquito-services). A service of the stack is
 * found by the name of its Component; a stage of an application by refresquito.io/application and
 * refresquito.io/stage, set by the catalog of the stack.
 */

const APPLICATION = 'refresquito.io/application';
const STAGE = 'refresquito.io/stage';
const OVERRIDE = 'refresquito.io/keycloak-component';

export function securityTarget(entity: Entity): {
  component: string;
  stage?: string;
} {
  const a = entity.metadata.annotations ?? {};
  return {
    component: a[OVERRIDE] ?? a[APPLICATION] ?? entity.metadata.name,
    stage: a[STAGE],
  };
}

/** Components of the stack and of the applications: what carries tags in Keycloak. */
export const isSecurityAvailable = (entity: Entity): boolean =>
  entity.kind === 'Component' &&
  (Boolean(
    entity.metadata.annotations?.[APPLICATION] ||
      entity.metadata.annotations?.[OVERRIDE],
  ) ||
    entity.metadata.name.endsWith('-oneke'));

interface Holder {
  name: string;
  component?: string;
}
interface Tagged {
  kind?: string;
  grants?: string;
  stages: string[];
  zone?: string;
  program?: string;
  classification?: string;
}
interface Group extends Tagged {
  name: string;
  members: number;
  memberNames?: string[];
  roles: string[];
}
interface Role {
  name: string;
  grants?: string;
  heldBy: Holder[];
}
interface Client extends Tagged {
  clientId: string;
  publicClient: boolean;
  roles: Role[];
}
interface Security {
  component: string;
  stage?: string;
  isAdmin: boolean;
  groups: Group[];
  clients: Client[];
  realmRoles: (Role & Tagged)[];
  warnings?: string[];
}

function useKeycloakManager<T>(path: string | undefined) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [state, setState] = useState<{
    loading: boolean;
    data?: T;
    error?: string;
  }>({ loading: true });
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    (async () => {
      try {
        const base = await discoveryApi.getBaseUrl('keycloak-manager');
        const res = await fetchApi.fetch(`${base}${path}`);
        const body = await res.json();
        if (!res.ok)
          throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
        if (live) setState({ loading: false, data: body as T });
      } catch (e) {
        if (live) setState({ loading: false, error: (e as Error).message });
      }
    })();
    return () => {
      live = false;
    };
  }, [path, discoveryApi, fetchApi]);
  return state;
}

const Holders = ({
  holders,
  component,
}: {
  holders: Holder[];
  component: string;
}) =>
  holders.length === 0 ? (
    <Typography variant="body2" color="textSecondary">
      no group
    </Typography>
  ) : (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {holders.map(h => (
        <Tooltip
          key={h.name}
          title={
            h.component ? `group of ${h.component}` : 'group of no component'
          }
        >
          <Chip
            size="small"
            label={h.name}
            variant={h.component === component ? 'filled' : 'outlined'}
          />
        </Tooltip>
      ))}
    </Stack>
  );

const Scope = ({ t }: { t: Tagged }) => (
  <Typography variant="body2" color="textSecondary">
    {[t.stages.length ? t.stages.join(', ') : 'every stage', t.classification]
      .filter(Boolean)
      .join(' · ')}
  </Typography>
);

export const EntitySecurityContent = () => {
  const { entity } = useEntity();
  const { component, stage } = securityTarget(entity);
  const query = `/security?component=${encodeURIComponent(component)}${
    stage ? `&stage=${encodeURIComponent(stage)}` : ''
  }`;
  const { loading, data, error } = useKeycloakManager<Security>(query);

  if (loading) return <CircularProgress size={24} />;
  if (error) return <Typography color="error">Keycloak: {error}</Typography>;
  if (!data) return null;
  const empty =
    !data.groups.length && !data.clients.length && !data.realmRoles.length;
  const where = data.groups[0] ?? data.clients[0] ?? data.realmRoles[0];

  return (
    <Stack spacing={3}>
      {(data.warnings ?? []).map(w => (
        <Typography key={w} variant="body2" color="warning.main">
          {w}
        </Typography>
      ))}
      <Typography variant="body2" color="textSecondary">
        Keycloak objects tagged <code>refresquito.component={component}</code>
        {stage ? (
          <>
            {' '}
            for the stage <b>{stage}</b> (and those of every stage)
          </>
        ) : null}
        {where?.program ? ` in ${where.zone}/${where.program}` : ''}. Membership
        is managed in the Keycloak Manager.
      </Typography>
      {empty && (
        <Typography color="textSecondary">
          Nothing in Keycloak says it belongs to {component}: the component has
          no login of its own, or its groups have no tags yet (Keycloak Manager,
          unowned).
        </Typography>
      )}
      {data.groups.length > 0 && (
        <InfoCard title="Groups" subheader="Who gets in, and with which role">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Group</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Grants</TableCell>
                <TableCell>Roles it holds</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell align="right">Members</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.groups.map(g => (
                <TableRow key={g.name}>
                  <TableCell>
                    <b>{g.name}</b>
                  </TableCell>
                  <TableCell>
                    {g.kind && <Chip size="small" label={g.kind} />}
                  </TableCell>
                  <TableCell>{g.grants}</TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {g.roles.join(', ') || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Scope t={g} />
                  </TableCell>
                  <TableCell align="right">
                    {g.memberNames ? (
                      <Tooltip title={g.memberNames.join(', ') || 'nobody'}>
                        <span>{g.members}</span>
                      </Tooltip>
                    ) : (
                      g.members
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
      )}
      {data.clients.length > 0 && (
        <InfoCard
          title="SSO clients"
          subheader="How it signs people in, and the roles of each client"
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Client</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Grants</TableCell>
                <TableCell>Client roles → groups that hold them</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.clients.map(c => (
                <TableRow key={c.clientId}>
                  <TableCell>
                    <b>{c.clientId}</b>
                    <Typography
                      variant="caption"
                      display="block"
                      color="textSecondary"
                    >
                      {c.publicClient ? 'public' : 'confidential'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {c.kind && <Chip size="small" label={c.kind} />}
                  </TableCell>
                  <TableCell>
                    {c.grants}
                    <Scope t={c} />
                  </TableCell>
                  <TableCell>
                    {c.roles.length === 0 ? (
                      <Typography variant="body2" color="textSecondary">
                        no client role
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        {c.roles.map(r => (
                          <Box key={r.name}>
                            <Typography variant="body2">
                              <b>{r.name}</b>
                              {r.grants &&
                              r.grants !== `${c.clientId}: ${r.name}`
                                ? ` — ${r.grants}`
                                : ''}
                            </Typography>
                            <Holders holders={r.heldBy} component={component} />
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
      )}
      {data.realmRoles.length > 0 && (
        <InfoCard
          title="Realm roles"
          subheader="Roles of the whole realm that belong to it"
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Role</TableCell>
                <TableCell>Grants</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>Groups that hold it</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.realmRoles.map(r => (
                <TableRow key={r.name}>
                  <TableCell>
                    <b>{r.name}</b>
                  </TableCell>
                  <TableCell>{r.grants}</TableCell>
                  <TableCell>
                    <Scope t={r} />
                  </TableCell>
                  <TableCell>
                    <Holders holders={r.heldBy} component={component} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
      )}
    </Stack>
  );
};

/** For backstage-admin, on the Keycloak Manager: what belongs to no component (leftovers, or made without tags). */
export const KeycloakUnownedCard = () => {
  const { loading, data, error } = useKeycloakManager<{
    groups: string[];
    clients: string[];
    realmRoles: string[];
    warnings?: string[];
  }>('/security/unowned');
  if (loading) return <CircularProgress size={20} />;
  if (error || !data) return null;
  const row = (label: string, names: string[]) => (
    <Box sx={{ mb: 1 }}>
      <Typography variant="subtitle2">
        {label} ({names.length})
      </Typography>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {names.length
          ? names.map(n => (
              <Chip key={n} size="small" variant="outlined" label={n} />
            ))
          : '—'}
      </Stack>
    </Box>
  );
  return (
    <InfoCard
      title="Unowned"
      subheader="Groups, clients and realm roles that say no component (attribute refresquito.component): leftovers to remove, or objects created without their tags"
    >
      {row('Groups', data.groups)}
      {row('Clients', data.clients)}
      {row('Realm roles', data.realmRoles)}
      {(data.warnings ?? []).map(w => (
        <Typography key={w} variant="body2" color="warning.main">
          {w}
        </Typography>
      ))}
    </InfoCard>
  );
};
