import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { EmptyState, InfoCard, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
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
  const stage = (e: Entity) => e.metadata.annotations?.['refresquito.io/stage'] ?? 'pro';
  const sorted = deployments
    .filter(e => url(e))
    .sort((a, b) => STAGES.indexOf(stage(a)) - STAGES.indexOf(stage(b)));
  return sorted.length ? url(sorted[0])!.replace(/\/+$/, '') : null;
}

/** The two links of the support for an element: open an incident on it, and its incidents not closed. */
export function supportLinks(base: string, entity: Entity): { open: string; incidents: string } {
  const ref = stringifyEntityRef(entity); // kind:namespace/name, the reference the support keeps
  const [entityPart, name] = ref.split('/');
  return {
    open: `${base}/incidents/new?element=${encodeURIComponent(ref)}`,
    incidents: `${base}/elements/${encodeURIComponent(entityPart)}/${encodeURIComponent(name)}`,
  };
}

/**
 * The tab "Incidents" of an element of the catalog (incidents: Open an incident from the page of an element; The
 * incidents of an element). It links to the support, where the requester sees only their own incidents and the
 * support team all of them: the access is the support's, with the same login of Keycloak.
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
        filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': SUPPORT_APPLICATION },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'],
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
    <InfoCard title="Incidents">
      <Typography variant="body1" paragraph>
        Something of <strong>{title}</strong> does not work as it should? Open an incident: the support team gets it
        with its priority, and you follow it until it is solved. You see your own incidents; the support team sees
        all of them.
      </Typography>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="contained" href={links.open} target="_blank" rel="noopener">
          Open an incident on {title}
        </Button>
        <Button variant="outlined" href={links.incidents} target="_blank" rel="noopener">
          Its incidents not closed
        </Button>
      </div>
    </InfoCard>
  );
};
