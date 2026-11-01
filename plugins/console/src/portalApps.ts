import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { useEffect, useState } from 'react';

/** An application of the platform the Portal menu links to: found in the catalog by its application name. */
export type PortalApp = { application: string; label: string; hint?: string };
export type PortalLink = { label: string; url: string; hint?: string };

/** console.portalApps of app-config; by default the support (Incidents) and personnel security (Accreditation). */
export const DEFAULT_PORTAL_APPS: PortalApp[] = [
  { application: 'support', label: 'Incidents', hint: 'The support: open an incident, follow yours' },
  { application: 'personnelsecurity', label: 'Accreditation', hint: 'Personnel security: clearances and accreditations of the users' },
];
const STAGES = ['pro', 'pre', 'dev'];

/** The URL of an application: refresquito.io/url of its deployment in the catalog, the most stable stage first. */
export function appUrl(items: Array<{ metadata: { annotations?: Record<string, string> } }>): string | undefined {
  const url = (e: (typeof items)[number]) => e.metadata.annotations?.['refresquito.io/url'];
  const stage = (e: (typeof items)[number]) => e.metadata.annotations?.['refresquito.io/stage'] ?? 'pro';
  const best = items.filter(url).sort((a, b) => STAGES.indexOf(stage(a)) - STAGES.indexOf(stage(b)))[0];
  return best ? url(best)!.replace(/\/+$/, '') : undefined;
}

/** The links of the Portal menu to the applications of console.portalApps that the catalog knows where they are. */
export function usePortalLinks(): PortalLink[] {
  const config = useApi(configApiRef);
  const catalog = useApi(catalogApiRef);
  const apps: PortalApp[] =
    config.getOptionalConfigArray('console.portalApps')?.map(c => ({ application: c.getString('application'), label: c.getString('label'), hint: c.getOptionalString('hint') })) ??
    DEFAULT_PORTAL_APPS;
  const key = JSON.stringify(apps);
  const [links, setLinks] = useState<PortalLink[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all(
      apps.map(a =>
        catalog
          .getEntities({ filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': a.application }, fields: ['metadata.annotations'] })
          .then(r => ({ label: a.label, hint: a.hint, url: appUrl(r.items) }))
          .catch(() => ({ label: a.label, hint: a.hint, url: undefined })),
      ),
    ).then(all => alive && setLinks(all.filter((l): l is PortalLink => !!l.url)));
    return () => {
      alive = false;
    };
    // apps is read from config: its JSON is the dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, key]);
  return links;
}
