import { configApiRef, useApi } from '@backstage/core-plugin-api';

export type ClusterKind = 'zone' | 'program';

export type ClusterRef = {
  id: string;
  kind: ClusterKind;
  url: string;
  zone?: string;
  program?: string;
};

export type ConsoleConfig = {
  enabled: boolean;
  allowedGroups: string[];
  classicBaseUrl: string;
  cluster: { id: string; kind: ClusterKind; zone?: string; program?: string };
  clusters: ClusterRef[];
};

const kindOf = (v: string | undefined, fallback: ClusterKind): ClusterKind =>
  v === 'zone' || v === 'program' ? v : fallback;

/** console.* of app-config; every key is optional and the defaults keep the console off. */
export function useConsoleConfig(): ConsoleConfig {
  const config = useApi(configApiRef);
  const c = config.getOptionalConfig('console');
  const own = c?.getOptionalConfig('cluster');
  const program = own?.getOptionalString('program');
  return {
    enabled: c?.getOptionalBoolean('enabled') ?? false,
    allowedGroups: c?.getOptionalStringArray('allowedGroups') ?? [],
    classicBaseUrl: (c?.getOptionalString('classicBaseUrl') ?? '').replace(/\/+$/, ''),
    cluster: {
      id: own?.getOptionalString('id') ?? 'this-cluster',
      kind: kindOf(own?.getOptionalString('kind'), program ? 'program' : 'zone'),
      zone: own?.getOptionalString('zone'),
      program,
    },
    clusters: (c?.getOptionalConfigArray('clusters') ?? []).map(x => ({
      id: x.getString('id'),
      kind: kindOf(x.getOptionalString('kind'), 'program'),
      url: x.getString('url').replace(/\/+$/, ''),
      zone: x.getOptionalString('zone'),
      program: x.getOptionalString('program'),
    })),
  };
}

/** A path of the classic pages (e.g. /catalog/default/component/petstore), on the host that serves them. */
export const classicUrl = (cfg: Pick<ConsoleConfig, 'classicBaseUrl'>, path: string) =>
  `${cfg.classicBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
