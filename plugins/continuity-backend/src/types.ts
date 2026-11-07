/**
 * The continuity profile of a platform service (schema continuity.schema.json v1, one YAML file per service in the
 * ConfigMap continuity-profiles of the chart continuity-oneke): what it keeps, how it is exported, which keys make
 * it valid, and how to leave it.
 */
export type Tier = 'A' | 'B' | 'C';
export type Lifecycle = 'supported' | 'deprecated' | 'retired' | 'external';
export type ProfileStatus = 'draft' | 'approved';
export type RecordKind = 'record' | 'definitions' | 'rebuildable' | 'operational';
export type AnchorKind = 'ca' | 'signing-key' | 'realm-keys' | 'passphrase';
export type OfflineCopy = 'yes' | 'no' | 'unknown' | 'n/a';

export type RecordExport = {
  method?: string;
  format?: string;
  schedule?: string;
  status?: 'planned' | 'active' | string;
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
  offlineCopy?: OfflineCopy | string;
  custodians?: number;
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

export type ComputedProfile = Profile & {
  /** the file it was read from (<service>.yaml) */
  file: string;
  recordsTotal: number;
  recordsWithoutActiveExport: number;
  state: 'ok' | Level;
  /** the key of the most severe reason, or 'ok' */
  stateReason: string;
  reasons: Reason[];
};

export type FlatAnchor = TrustAnchor & { service: string; live?: LiveCert; liveError?: string };

export type Attention = { level: Level; service: string; key: string; title: string; detail: string; vars?: Record<string, string | number> };

export type Summary = {
  profiles: ComputedProfile[];
  trustAnchors: FlatAnchor[];
  attention: Attention[];
  counts: {
    services: number;
    approved: number;
    draft: number;
    recordsTotal: number;
    recordsWithoutActiveExport: number;
    trustAnchors: number;
    anchorsWithoutOfflineCopy: number;
    deprecated: number;
    external: number;
    retired: number;
    ok: number;
    warning: number;
    critical: number;
  };
  warnings: string[];
};
