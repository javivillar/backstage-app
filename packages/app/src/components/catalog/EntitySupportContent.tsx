import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  EmptyState,
  InfoCard,
  Link,
  Progress,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { keycloakOIDCAuthApiRef } from '@internal/plugin-keycloak';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

/** The application of the support (refresquito-specs, systems/support): the deployment it is in the catalog. */
export const SUPPORT_APPLICATION = 'support';
const STAGES = ['pro', 'pre', 'dev'];

/**
 * Where the support is: the URL (annotation refresquito.io/url) of the deployment of the application `support` in
 * the catalog, the most stable stage first (pro, then pre, then dev). Nothing to configure: when it is deployed, the
 * catalog says where.
 */
export function supportUrl(deployments: Entity[]): string | null {
  const url = (e: Entity) => e.metadata.annotations?.['refresquito.io/url'];
  const stage = (e: Entity) =>
    e.metadata.annotations?.['refresquito.io/stage'] ?? 'pro';
  const sorted = deployments
    .filter(e => url(e))
    .sort((a, b) => STAGES.indexOf(stage(a)) - STAGES.indexOf(stage(b)));
  return sorted.length ? url(sorted[0])!.replace(/\/+$/, '') : null;
}

/** The two links of the support for an element: open an incident on it, and its incidents not closed. */
export function supportLinks(
  base: string,
  entity: Entity,
): { open: string; incidents: string } {
  const ref = stringifyEntityRef(entity); // kind:namespace/name, the reference the support keeps
  const [entityPart, name] = ref.split('/');
  return {
    open: `${base}/incidents/new?element=${encodeURIComponent(ref)}`,
    incidents: `${base}/elements/${encodeURIComponent(
      entityPart,
    )}/${encodeURIComponent(name)}`,
  };
}

/** An incident as the API of the support gives it (GET /api/incidents), only what the tab shows. */
export type SupportIncident = {
  id: number;
  title: string;
  priority: string;
  state: string;
  requester: string;
  requester_name: string | null;
  assignee: string | null;
  opened_at: string;
};

/** What the tab knows of the incidents of the element: read, not readable (and why), or being read. */
type Incidents =
  | { status: 'loading' }
  | { status: 'ok'; items: SupportIncident[]; total: number }
  | { status: 'error'; message: string };

/**
 * The incidents not closed of an element, read from the API of the support in the browser with the token of the
 * person signed in to Backstage (Keycloak): the support sees the same person and the same roles as in its own web
 * (python-app-oneke, platform.sso.fromBackstage). A requester gets only their own, the support team all of them.
 */
export async function fetchIncidents(
  base: string,
  ref: string,
  token: string,
): Promise<{ items: SupportIncident[]; total: number }> {
  const url = `${base}/api/incidents?element=${encodeURIComponent(
    ref,
  )}&open=true&size=50`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    throw new Error('The support did not accept the sign-in of Backstage.');
  }
  if (response.status === 403) {
    throw new Error(
      'You have no role in the support: ask the platform administrator.',
    );
  }
  if (!response.ok) {
    throw new Error(`The support answered ${response.status}.`);
  }
  const page = await response.json();
  return { items: page.items ?? [], total: page.total ?? 0 };
}

const STATES: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** The table of the incidents not closed of the element, each one a link to it in the support. */
const SupportIncidents = ({
  base,
  entityRef,
}: {
  base: string;
  entityRef: string;
}) => {
  const keycloak = useApi(keycloakOIDCAuthApiRef);
  const [incidents, setIncidents] = useState<Incidents>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    keycloak
      .getAccessToken(undefined, { optional: true })
      .then(token => {
        if (!token) {
          throw new Error(
            'Sign in to Backstage with Keycloak to see them here.',
          );
        }
        return fetchIncidents(base, entityRef, token);
      })
      .then(page => current && setIncidents({ status: 'ok', ...page }))
      .catch(
        (error: Error) =>
          current &&
          setIncidents({
            status: 'error',
            // fetch fails with a TypeError when the support cannot be reached (down, or no CORS for Backstage)
            message:
              error instanceof TypeError
                ? 'The support could not be reached.'
                : error.message,
          }),
      );
    return () => {
      current = false;
    };
  }, [keycloak, base, entityRef]);

  if (incidents.status === 'loading') {
    return <Progress />;
  }
  if (incidents.status === 'error') {
    return (
      <InfoCard title="Its incidents not closed">
        <Typography variant="body2">
          {incidents.message} The link above opens them in the support.
        </Typography>
      </InfoCard>
    );
  }
  const columns: TableColumn<SupportIncident>[] = [
    {
      title: 'Incident',
      field: 'id',
      width: '90px',
      render: i => <Link to={`${base}/incidents/${i.id}`}>#{i.id}</Link>,
    },
    {
      title: 'Title',
      field: 'title',
      render: i => <Link to={`${base}/incidents/${i.id}`}>{i.title}</Link>,
    },
    { title: 'Priority', field: 'priority', width: '90px' },
    { title: 'State', field: 'state', render: i => STATES[i.state] ?? i.state },
    {
      title: 'Opened by',
      field: 'requester',
      render: i => i.requester_name ?? i.requester,
    },
    { title: 'Assigned to', field: 'assignee', render: i => i.assignee ?? '—' },
    {
      title: 'Opened',
      field: 'opened_at',
      render: i => new Date(i.opened_at).toLocaleString(),
    },
  ];
  return (
    <Table<SupportIncident>
      title={`Its incidents not closed (${incidents.total})`}
      subtitle="A requester sees their own; the support team, all of them"
      columns={columns}
      data={incidents.items}
      options={{
        search: false,
        paging: incidents.items.length > 10,
        pageSize: 10,
        padding: 'dense',
      }}
      emptyContent={
        <Typography style={{ padding: 16 }}>
          No incident open on this element.
        </Typography>
      }
    />
  );
};

/**
 * The tab "Incidents" of an element of the catalog (incidents: Open an incident from the page of an element; The
 * incidents of an element). It links to the support and lists the incidents not closed of the element, read with the
 * login of Keycloak: the requester sees only their own incidents and the support team all of them.
 */
export const EntitySupportContent = () => {
  const { entity } = useEntity();
  const catalogApi = useApi(catalogApiRef);
  // undefined while it is read; null when the support is not in the catalog (or the catalog could not be read)
  const [base, setBase] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    catalogApi
      .getEntities({
        filter: {
          kind: 'component',
          'metadata.annotations.refresquito.io/application':
            SUPPORT_APPLICATION,
        },
        fields: [
          'kind',
          'metadata.name',
          'metadata.namespace',
          'metadata.annotations',
        ],
      })
      .then(({ items }) => current && setBase(supportUrl(items)))
      .catch(() => current && setBase(null));
    return () => {
      current = false;
    };
  }, [catalogApi]);

  if (base === undefined) {
    return <Progress />;
  }
  if (!base) {
    return (
      <EmptyState
        missing="info"
        title="The support is not deployed"
        description="The application support is not in the catalog of this installation: incidents are opened there once it is deployed."
      />
    );
  }
  const links = supportLinks(base, entity);
  const title = entity.metadata.title ?? entity.metadata.name;
  return (
    <>
      <InfoCard title="Incidents">
        <Typography variant="body1" paragraph>
          Something of <strong>{title}</strong> does not work as it should? Open
          an incident: the support team gets it with its priority, and you
          follow it until it is solved. You see your own incidents; the support
          team sees all of them.
        </Typography>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            href={links.open}
            target="_blank"
            rel="noopener"
          >
            Open an incident on {title}
          </Button>
          <Button
            variant="outlined"
            href={links.incidents}
            target="_blank"
            rel="noopener"
          >
            Its incidents not closed
          </Button>
        </div>
      </InfoCard>
      <div style={{ marginTop: 16 }}>
        <SupportIncidents base={base} entityRef={stringifyEntityRef(entity)} />
      </div>
    </>
  );
};
