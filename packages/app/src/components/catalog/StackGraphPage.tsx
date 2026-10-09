import { useEffect, useState } from 'react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { CatalogGraphPage } from '@backstage/plugin-catalog-graph';
import { catalogApiRef } from '@backstage/plugin-catalog-react';

/**
 * The "Graph" page of the menu. CatalogGraphPage on its own opens empty: it draws nothing
 * until somebody picks a root entity. Here it opens on the whole catalog instead: every Domain
 * and every System as roots, two levels deep (the systems, what each one holds, and how those
 * depend on each other). The filters of the page still change all of it, and a link that
 * carries its own selection in the URL is respected.
 */
export const StackGraphPage = () => {
  const catalogApi = useApi(catalogApiRef);
  const [roots, setRoots] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getEntities({
        filter: [{ kind: 'Domain' }, { kind: 'System' }],
        fields: ['kind', 'metadata.name', 'metadata.namespace'],
      })
      .then(({ items }) => {
        if (!cancelled) {
          setRoots(items.map(entity => stringifyEntityRef(entity)).sort());
        }
      })
      .catch(() => {
        // without the roots the page still works, empty as upstream
        if (!cancelled) {
          setRoots([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [catalogApi]);

  if (roots === undefined) {
    return <Progress />;
  }
  return (
    <CatalogGraphPage
      initialState={{
        rootEntityRefs: roots,
        maxDepth: 2,
        selectedKinds: ['domain', 'system', 'component', 'api'],
      }}
    />
  );
};
