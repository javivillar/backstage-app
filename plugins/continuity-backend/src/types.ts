/**
 * What is common and what is per zone: a profile (git, the same in every zone and programme) holds only what is
 * common: the records, how they are exported, the trust anchors, the exit plan, the policy approval. Facts of one
 * zone (export running, ceremony done, offline copy, custodians) never live in git; they are computed or recorded
 * in this zone (phase L2: CronWorkflows; phase L3: ceremonies in this Backstage's database).
 *
 * The continuity profile of a platform service (schema continuity.schema.json v1, one YAML file per service in the
 * ConfigMap continuity-profiles of the chart continuity-oneke): what it keeps, how it is exported, which keys make
 * it valid, and how to leave it.
 */
export type Tier = 'A' | 'B' | 'C';
export type Lifecycle = 'supported' | 'deprecated' | 'retired' | 'external';
export type ProfileStatus = 'draft' | 'approved';
export type RecordKind = 'record' | 'definitions' | 'rebuildable' | 'operational';
export type AnchorKind = 'ca' | 'signing-key' | 'realm-keys' | 'passphrase';
/** The ceremony of a trust anchor in this zone: not recorded until phase L3. */
export type Ceremony = 'unrecorded';

export type RecordExport = {
  method?: string;
  format?: string;
  schedule?: string;
  /** the WorkflowTemplate that runs it (phase L2) */
  workflow?: string;
};

export type ContinuityRecord = {
  id: string;
  title?: string;
  kind: RecordKind | string;
  retention?: string;
  export?: RecordExport;
  worm?: boolean;
  notes?: string;
};

export type TrustAnchor = {
  id: string;
  title?: string;
  kind: AnchorKind | string;
  probe?: string;
  notes?: string;
};

export type ExitPlan = {
  alternative?: string;
  exportFormat?: string;
  upstream?: { project?: string; license?: string };
};

export type Profile = {
  service: string;
  title?: string;
  tier?: Tier | string;
  lifecycle: Lifecycle | string;
  status: ProfileStatus | string;
  replacedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  managedIn?: string;
  notes?: string;
  records: ContinuityRecord[];
  trustAnchors: TrustAnchor[];
  exit?: ExitPlan;
};

/** What the platform itself says about a trust anchor (its certificate), when the backend can read it. */
export type LiveCert = { notAfter: string; notBefore: string; subject: string; daysLeft: number };

export type Level = 'critical' | 'warning';

/**
 * One cause of a state. key is stable (the page translates it: cont.reason.<key>); title and detail are English,
 * for logs and for a page that does not know the key.
 */
export type Reason = { level: Level; key: string; title: string; detail: string; vars?: Record<string, string | number> };

/** A record with what this zone says of it. */
export type ComputedRecord = ContinuityRecord & { exportActive: boolean };

export type ComputedProfile = Omit<Profile, 'records'> & {
  records: ComputedRecord[];
  /** the file it was read from (<service>.yaml) */
  file: string;
  /** a Component of that name is in this cluster's catalog (always true for lifecycle external) */
  installed: boolean;
  external: boolean;
  recordsTotal: number;
  recordsWithoutActiveExport: number;
  state: 'ok' | Level;
  /** the key of the most severe reason, or 'ok' */
  stateReason: string;
  reasons: Reason[];
};

export type FlatAnchor = TrustAnchor & { service: string; ceremony: Ceremony; live?: LiveCert; liveError?: string };

/** service is empty for an item about several services (key drafts: vars.n, vars.services). */
export type Attention = { level: Level; service: string; key: string; title: string; detail: string; vars?: Record<string, string | number> };

export type NotInstalled = { service: string; title?: string; tier?: string };

export type Summary = {
  /** the profiles of what is installed in this cluster, and the externals */
  profiles: ComputedProfile[];
  /** the profiles of services not installed in this programme (no state) */
  notInstalled: NotInstalled[];
  trustAnchors: FlatAnchor[];
  attention: Attention[];
  counts: {
    services: number;
    approved: number;
    draft: number;
    recordsTotal: number;
    recordsWithoutActiveExport: number;
    trustAnchors: number;
    anchorsUnrecorded: number;
    notInstalled: number;
    deprecated: number;
    external: number;
    retired: number;
    ok: number;
    warning: number;
    critical: number;
  };
  warnings: string[];
};
