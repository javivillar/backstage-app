import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';

/**
 * GET on the GitHub REST API through the backend proxy (`/api/proxy/github`, declared in app-config:
 * proxy.endpoints./github, GET only, with the token of the GitHub integration). Nobody signs in to
 * GitHub: Backstage reads it for every signed-in user, as it does for the catalog.
 */
export function useGithub<T>(path: string | undefined) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; value?: T; error?: Error }>({ loading: !!path });
  useEffect(() => {
    if (!path) {
      setState({ loading: false });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      const res = await fetchApi.fetch(`${await discoveryApi.getBaseUrl('proxy')}/github${path}`);
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      return (await res.json()) as T;
    })().then(
      value => !cancelled && setState({ loading: false, value }),
      error => !cancelled && setState({ loading: false, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [path, discoveryApi, fetchApi]);
  return state;
}

export const SLUG_ANNOTATION = 'github.com/project-slug';
/** The repository of an application of the Python Framework, on the entity of its deployment (<name>-oneke). */
export const REPOSITORY_ANNOTATION = 'refresquito.io/repository';
/** The file of the stack that deploys it: <owner>/<repo>:<path> (the app file, or the chart of a service). */
export const DEPLOYMENT_FILE_ANNOTATION = 'refresquito.io/deployment-file';

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
