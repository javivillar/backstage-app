/**
 * The Continuity portal, without React: the shape of GET /api/continuity/summary
 * (plugins/continuity-backend/src/types.ts) and the small decisions of the page, so they can be tested.
 */
export type Level = 'critical' | 'warning';
export type State = 'ok' | Level;
export type Vars = Record<string, string | number>;

export type ContinuityRecord = {
  id: string;
  title?: string;
  kind: string;
  retention?: string;
  export?: { method?: string; format?: string; schedule?: string; status?: string };
  worm?: boolean;
  notes?: string;
};
export type LiveCert = { notAfter: string; notBefore: string; subject: string; daysLeft: number };
export type TrustAnchor = {
  id: string;
  title?: string;
  kind: string;
  probe?: string;
  offlineCopy?: string;
  custodians?: number;
  notes?: string;
  service: string;
  live?: LiveCert;
  liveError?: string;
};
export type Reason = { level: Level; key: string; title: string; detail: string; vars?: Vars };
export type ContinuityProfile = {
  service: string;
  title?: string;
  tier?: string;
  lifecycle: string;
  status: string;
  replacedBy?: string;
  managedIn?: string;
  notes?: string;
  records: ContinuityRecord[];
  trustAnchors: Array<Omit<TrustAnchor, 'service'>>;
  exit?: { alternative?: string; exportFormat?: string; upstream?: { project?: string; license?: string } };
  file: string;
  recordsTotal: number;
  recordsWithoutActiveExport: number;
  state: State;
  stateReason: string;
  reasons: Reason[];
};
export type Attention = Reason & { service: string };
export type ContinuitySummary = {
  profiles: ContinuityProfile[];
  trustAnchors: TrustAnchor[];
  attention: Attention[];
  counts: Record<string, number>;
  warnings: string[];
};

/** Where the profiles live; changes go by pull request there. */
export const PROFILES_REPO = 'https://github.com/javivillar/refresquito-services/tree/main/charts/continuity-oneke/files/profiles';
export const profileFileUrl = (p: Pick<ContinuityProfile, 'file' | 'service'>) => `${PROFILES_REPO.replace('/tree/', '/blob/')}/${p.file || `${p.service}.yaml`}`;

/** At risk: the filter "Con riesgo" of the services table. */
export const atRisk = (p: Pick<ContinuityProfile, 'state'>) => p.state !== 'ok';

type T = (key: string, vars?: Vars) => string;
type Has = (key: string) => boolean;

/** The text of a reason in the page's language (cont.reason.<key>), else the English title of the backend. */
export function reasonText(r: Reason & { service?: string }, t: T, has: Has): string {
  const key = `cont.reason.${r.key}`;
  return has(key) ? t(key, { service: r.service ?? '', ...(r.vars ?? {}) }) : r.title;
}

/** Its second line: the records it is about, the approver of a draft, or the backend's detail. */
export function reasonDetail(r: Reason, t: T): string {
  if (r.key === 'draft') return t('cont.reason.draft.detail');
  if ((r.key === 'record-no-export' || r.key === 'external-no-export') && r.vars?.records) return t('cont.reason.records', { records: r.vars.records });
  return r.detail;
}

/** A translated label of an enum value (cont.<group>.<value>), the value itself when unknown. */
export const label = (group: string, value: string | undefined, t: T, has: Has) => {
  if (!value) return '—';
  const key = `cont.${group}.${value}`;
  return has(key) ? t(key) : value;
};

/** The export of a record in one line: format · method · schedule. */
export const exportLine = (r: ContinuityRecord) => [r.export?.format, r.export?.method, r.export?.schedule].filter(Boolean).join(' · ');

/** The day of a live certificate (YYYY-MM-DD), "—" when not read. */
export const expiryDay = (a: Pick<TrustAnchor, 'live'>) => a.live?.notAfter.slice(0, 10) ?? '—';
