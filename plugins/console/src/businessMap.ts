import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/**
 * The business map in the console: the answers of the backend business-map (packages/backend/src/plugins/businessMap,
 * mapModel.ts and continuityModel.ts) and the hooks that read them. The map, the heat map, the glass and the matrix
 * read the same GET /map of one customer.
 */
export type Criticality = 'critical' | 'important' | 'standard';
export type CheckResult = 'meets' | 'gap' | 'unknown';
export type Duration = string | null;
export type Delivers = { rpo: Duration; rto: Duration };
export type CriticalityDefaults = Partial<Record<Criticality, { rpo?: string; rto?: string; ha?: boolean }>>;

export type ElementGap = { element: string; field: 'rpo' | 'rto'; needs: string; delivers: string };
export type MapDomain = { ref: string; title: string; description?: string; pcfId?: string; modelId?: string; parent?: string };
export type MapService = { ref: string; title: string; type?: string; tier?: string; delivers: Delivers | null; result: CheckResult; gaps: ElementGap[] };
/** Where a value of the requirement comes from: the criticality's default, the process itself, or a parent process. */
export type Origin = 'default' | 'override' | 'inherited';
/** The manual way to go on while the systems are down (business impact analysis). */
export type Workaround = { manual: boolean; maxDuration?: string; note?: string };
/** mtpd and workaround only when the process (or a parent) says them. */
export type MapRequirement = {
  rpo: Duration;
  rto: Duration;
  retention: Duration;
  ha?: boolean;
  mtpd?: string;
  workaround?: Workaround;
  from: { rpo: Origin; rto: Origin; mtpd?: Origin; workaround?: Origin };
};
/** Something wrong in a requirement itself: an RTO above the MTPD. */
export type RequirementIssue = { key: 'rto-above-mtpd'; rto: string; mtpd: string };
export type InheritedField = 'criticality' | 'rpo' | 'rto' | 'mtpd' | 'retention' | 'workaround' | 'dependsOn';
export type MapProcess = {
  ref: string;
  name: string;
  namespace: string;
  title: string;
  description?: string;
  /** the Domain (or subdomain) it belongs to (a sub-process: that of its top process) */
  domain: string;
  /** a sub-process (APQC level 4 and below): its parent process */
  parent?: string;
  /** its direct sub-processes ([] or absent when none) */
  subprocesses?: string[];
  /** a sub-process: what it takes from its parent chain */
  inherited?: InheritedField[];
  /** an RTO above the MTPD */
  issues?: RequirementIssue[];
  owner?: string;
  criticality: Criticality;
  requirement: MapRequirement;
  classification?: string;
  pcfId?: string;
  modelId?: string;
  /** the key of its BPMN in the process engine */
  processKey?: string;
  deprecated?: boolean;
  /** what it depends on directly (business services, components, resources) */
  dependsOn: string[];
  result: CheckResult;
  gaps: ElementGap[];
  services: MapService[];
  dataProducts: string[];
};
export type ModelSummary = { ref: string; title: string; source?: string; industry?: string; version?: string; namespace?: string };
/** GET /api/business-map/map?namespace= */
export type MapData = {
  namespace?: string;
  namespaces: string[];
  models: ModelSummary[];
  defaults: CriticalityDefaults;
  domains: MapDomain[];
  processes: MapProcess[];
};

export type ImpactProcess = {
  ref: string;
  title: string;
  namespace: string;
  criticality: Criticality;
  needs: Delivers;
  /** the way down from the process to the element, without both ends */
  through: string[];
  result: CheckResult;
  gap?: Array<{ field: 'rpo' | 'rto'; needs: string; delivers: string }>;
};
export type LineStage = { stage: string; instance: string; line?: string; lineTitle?: string; version?: string; lifecycle?: string; supportedUntil?: string };
export type LineService = { ref: string; title: string; owner?: string; stages: LineStage[]; processes: string[] };
export type LineSummary = { ref: string; title: string; version?: string; lifecycle?: string; supportedUntil?: string };
/** GET /api/business-map/impact?entity= */
export type ImpactData = {
  entity: string;
  role: 'run-time' | 'framework-line' | 'development-service';
  delivers: Delivers | null;
  processes: ImpactProcess[];
  support?: { lifecycle?: string; supportedUntil?: string; version?: string; lines: LineSummary[] };
  services?: LineService[];
};

/** GET /api/business-map/engine?key= */
export type EngineData = { baseUrl?: string; cockpitUrl?: string; tasklistUrl?: string; definitionUrl?: string };

export type CheckElement = {
  ref: string;
  kind: string;
  type?: string;
  tier?: string;
  delivers: Delivers | null;
  result: CheckResult;
  gap?: Array<{ field: 'rpo' | 'rto'; needs: string; delivers: string }>;
};
/** GET /api/business-map/processes/:namespace/:name/check */
export type ProcessCheck = { process: string; requirement: { criticality: Criticality; rpo: Duration; rto: Duration; from: string[] }; elements: CheckElement[]; issues?: RequirementIssue[] };

type Loaded<T> = { loading: boolean; data?: T; error?: string };

/** GET of a path of the backend business-map; skipped (and not loading) when path is undefined. */
export function useBusinessMapGet<T>(path: string | undefined): Loaded<T> & { reload: () => void } {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<Loaded<T>>({ loading: path !== undefined });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (path === undefined) {
      setState({ loading: false });
      return undefined;
    }
    setState(s => ({ ...s, loading: true }));
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('business-map')}${path}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      return body as T;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, path, tick]);
  const reload = useCallback(() => setTick(n => n + 1), []);
  return { ...state, reload };
}

/**
 * The map as the views draw it (map, heat map, glass, matrix): the top processes only; the sub-processes are reached
 * from the page of their parent.
 */
export const topProcesses = (map: MapData): MapData => ({ ...map, processes: map.processes.filter(p => !p.parent) });

/** The map of a customer (the first one when namespace is empty). */
export const useBusinessMap = (namespace?: string) =>
  useBusinessMapGet<MapData>(`/map${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`);

/** The processes that depend on an entity (kind:namespace/name), or who runs on a framework line. */
export const useImpact = (ref: string | undefined) => useBusinessMapGet<ImpactData>(ref ? `/impact?entity=${encodeURIComponent(ref)}` : undefined);

/** The links into the process engine, with the definition of a process key when the engine knows it. */
export const useEngine = (key?: string) => useBusinessMapGet<EngineData>(`/engine${key ? `?key=${encodeURIComponent(key)}` : ''}`);

/** The continuity check of every element of the chain of a process. */
export const useProcessCheck = (namespace: string, name: string) =>
  useBusinessMapGet<ProcessCheck>(`/processes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/check`);
