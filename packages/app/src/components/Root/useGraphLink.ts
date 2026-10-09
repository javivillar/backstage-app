import { useEffect, useState } from 'react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';

const GRAPH = 'catalog-graph';

/**
 * Where the "Graph" item of the menu goes. The graph page draws nothing until it has a root
 * entity, so the plain link opened an empty page. This one carries the selection in the URL,
 * the way the page itself writes it: every Domain and System as roots, two levels deep (the
 * systems, what each one holds, and how those depend on each other).
 *
 * The page has to stay a direct element of the routes (a routable extension cannot be wrapped
 * by another component), which is why this is done in the link and not around the page.
 */
export function useGraphLink(): string {
  const catalogApi = useApi(catalogApiRef);
  const [to, setTo] = useState(GRAPH);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getEntities({
        filter: [{ kind: 'Domain' }, { kind: 'System' }],
        fields: ['kind', 'metadata.name', 'metadata.namespace'],
      })
      .then(({ items }) => {
        if (cancelled || items.length === 0) {
          return;
        }
        const params = [
          ...items
            .map(entity => stringifyEntityRef(entity))
            .sort()
            .map(ref => ['rootEntityRefs[]', ref]),
          ['maxDepth', '2'],
          ...['domain', 'system', 'component', 'api'].map(kind => [
            'selectedKinds[]',
            kind,
          ]),
        ];
        setTo(
          `${GRAPH}?${params
            .map(
              ([key, value]) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
            )
            .join('&')}`,
        );
      })
      .catch(() => {
        // the plain link still works: the page opens empty, as upstream
      });
    return () => {
      cancelled = true;
    };
  }, [catalogApi]);

  return to;
}
