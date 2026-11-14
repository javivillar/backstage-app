import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback } from 'react';
import { useBusinessMapGet } from './businessMap';

/**
 * The organisations behind the business applications of a customer (its own and the service provider's), who answers
 * for each application on each side, and the BPMN model of a process: what the backend business-map gives
 * (organisationRouter.ts) and what the pages work out of it.
 */
export type Side = 'customer' | 'provider';
export type Person = { name: string; user: string; role?: string; inKeycloak?: boolean };
export type Team = { name: string; people: Person[] };
export type Unit = { name: string; head?: Person; teams: Team[] };
export type ProductOwner = { application: string; user: string };
export type Organisation = { side: Side; name: string; title: string; head?: Person; units: Unit[]; productOwners: ProductOwner[]; path: string };
export type Owner = { user: string; name: string; role?: string; unit?: string; team?: string; inKeycloak?: boolean };
export type ApplicationOwnership = { name: string; title: string; ref: string; criticality?: string; processes: number; customer?: Owner; provider?: Owner };
/** GET /api/business-map/organisation?namespace= */
export type OrganisationData = {
  namespace: string;
  may: boolean;
  /** whether the catalog has Keycloak users to compare with: without them nobody is marked */
  keycloak: boolean;
  customer?: Organisation;
  provider?: Organisation;
  applications: ApplicationOwnership[];
  paths: Record<Side, string>;
};
export type Counts = { units: number; teams: number; people: number; notInKeycloak: number; productOwners: number };
export type RowError = { row: number; message: string };
/** POST /api/business-map/organisation/preview */
export type OrganisationPreview = { organisation: Organisation; counts: Counts; keycloak: boolean; errors: RowError[]; replaces: boolean; fileName: string; sheet: string };
export type PullAnswer = { pull: { number: number; url: string }; path: string };
/** GET /api/business-map/bpmn?namespace=&process= */
export type BpmnData = { xml: string; path: string; url: string };

export const useOrganisation = (namespace?: string) => useBusinessMapGet<OrganisationData>(`/organisation${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`);
export const useBpmn = (namespace: string, process: string) => useBusinessMapGet<BpmnData>(`/bpmn?namespace=${encodeURIComponent(namespace)}&process=${encodeURIComponent(process)}`);

/** POST to the backend business-map; throws its reason. */
export function useBusinessMapPost() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return useCallback(
    async <T,>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`${await discovery.getBaseUrl('business-map')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((answer as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      return answer as T;
    },
    [discovery, fetch],
  );
}

export type Placed = Person & { unit?: string; team?: string; position: 'head' | 'unit head' | 'member' };

/** Every person of an organisation, with where it is. */
export function peopleOf(org: Organisation): Placed[] {
  return [
    ...(org.head ? [{ ...org.head, position: 'head' as const }] : []),
    ...org.units.flatMap(u => [
      ...(u.head ? [{ ...u.head, unit: u.name, position: 'unit head' as const }] : []),
      ...u.teams.flatMap(t => t.people.map(p => ({ ...p, unit: u.name, team: t.name, position: 'member' as const }))),
    ]),
  ];
}

export function countsOf(org: Organisation): Counts {
  const people = peopleOf(org);
  return {
    units: org.units.length,
    teams: org.units.reduce((n, u) => n + u.teams.length, 0),
    people: people.length,
    notInKeycloak: people.filter(p => p.inKeycloak === false).length,
    productOwners: org.productOwners.length,
  };
}

/** The applications whose product owner (of that side) is in the team. */
export function applicationsOfTeam(apps: ApplicationOwnership[], side: Side, unit: string, team: string): ApplicationOwnership[] {
  return apps.filter(a => a[side]?.unit === unit && a[side]?.team === team);
}

export type OwnerState = 'ok' | 'none' | 'no-user';
/** A product owner: named and with a Keycloak user, named without one, or nobody. */
export const ownerState = (o?: Owner): OwnerState => {
  if (!o) return 'none';
  return o.inKeycloak === false ? 'no-user' : 'ok';
};
/** An application with something missing: no product owner on a side, or one without a Keycloak user. */
export const hasGap = (a: ApplicationOwnership) => ownerState(a.customer) !== 'ok' || ownerState(a.provider) !== 'ok';

export function ownershipCounts(apps: ApplicationOwnership[]) {
  return {
    applications: apps.length,
    complete: apps.filter(a => !hasGap(a)).length,
    noCustomer: apps.filter(a => !a.customer).length,
    noProvider: apps.filter(a => !a.provider).length,
    noUser: apps.filter(a => ownerState(a.customer) === 'no-user' || ownerState(a.provider) === 'no-user').length,
  };
}

// ---- the model of a process

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Whether the file names the same process (a tool may add nothing, or another case or punctuation). */
export const sameProcessName = (inFile: string | undefined, title: string) => !inFile || norm(inFile) === norm(title);

/** The team of the customer a lane is: the same name, or the name and something after it ("Stores · AOG desk"). */
export function teamOfLane(lane: string, teams: string[]): string | undefined {
  const l = norm(lane);
  return teams.find(t => l === norm(t) || l.startsWith(`${norm(t)} `));
}

/** The names of the teams of an organisation. */
export const teamNames = (org?: Organisation): string[] => (org ? org.units.flatMap(u => u.teams.map(t => t.name)) : []);

export const BPMN_STEP_KINDS: Record<string, 'person' | 'automatic' | 'process' | 'step'> = {
  'bpmn:UserTask': 'person',
  'bpmn:ManualTask': 'person',
  'bpmn:ServiceTask': 'automatic',
  'bpmn:SendTask': 'automatic',
  'bpmn:ReceiveTask': 'automatic',
  'bpmn:ScriptTask': 'automatic',
  'bpmn:BusinessRuleTask': 'automatic',
  'bpmn:CallActivity': 'process',
  'bpmn:SubProcess': 'process',
  'bpmn:Task': 'step',
};
export type BpmnStep = { id: string; name: string; kind: 'person' | 'automatic' | 'process' | 'step'; lane?: string };
export type BpmnModel = { name?: string; steps: BpmnStep[]; lanes: string[]; gateways: number; events: number; warnings: number };

/** What a file read by the viewer holds: its steps in reading order, each with its lane. */
export function modelOf(
  elements: Array<{ id: string; type: string; x?: number; y?: number; businessObject?: { name?: string; flowNodeRef?: Array<{ id: string }> } }>,
  name: string | undefined,
  warnings: number,
): BpmnModel {
  const lanes = elements.filter(e => e.type === 'bpmn:Lane');
  const laneOf = (id: string) => lanes.find(l => (l.businessObject?.flowNodeRef ?? []).some(r => r.id === id))?.businessObject?.name;
  const steps = elements
    .filter(e => BPMN_STEP_KINDS[e.type])
    .sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0))
    .map(e => ({ id: e.id, name: e.businessObject?.name || e.id, kind: BPMN_STEP_KINDS[e.type], lane: laneOf(e.id) }));
  return {
    name,
    steps,
    lanes: lanes.map(l => l.businessObject?.name ?? '').filter(Boolean),
    gateways: elements.filter(e => /Gateway$/.test(e.type)).length,
    events: elements.filter(e => /Event$/.test(e.type)).length,
    warnings,
  };
}
