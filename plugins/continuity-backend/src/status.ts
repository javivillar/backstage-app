import type { Attention, Ceremony, ComputedProfile, ContinuityRecord, FlatAnchor, Level, Profile, Reason, Summary, TrustAnchor } from './types';

/** A live certificate closer than this to its end is a warning. */
export const EXPIRY_WARNING_DAYS = 90;
/** More services than this with records without an active export: one item in the attention list, not one each. */
export const EXPORTS_AGGREGATE_ABOVE = 5;

/**
 * What this zone says of the platform (not in git: the profiles are common to every zone). Empty in phase L1; filled
 * when the zone runs the exports (phase L2) and records its ceremonies (phase L3).
 */
export type ZoneState = { cluster?: string };

/**
 * Whether this zone runs the export of a record. Always false in phase L1, there is nothing to look up yet.
 * phase L2: a CronWorkflow of this zone runs record.export.workflow
 */
export function isExportActive(_record: ContinuityRecord, _zone: ZoneState = {}): boolean {
  return false;
}

/**
 * The ceremony of a trust anchor in this zone (key generated, offline copy, custodians). Always unrecorded in
 * phase L1. phase L3: recorded from the portal in this zone's Backstage database.
 */
export function ceremonyOf(_anchor: TrustAnchor, _zone: ZoneState = {}): Ceremony {
  return 'unrecorded';
}

const anchorName = (a: { id: string; title?: string }) => a.title || a.id;

/**
 * The state of one profile and its causes. Pure. Rules:
 *   critical  lifecycle external and a record without an active export in this zone (the knowledge and evidence
 *             live only outside the zone)
 *   warning   a record without an active export in this zone, lifecycle deprecated, status draft, a live
 *             certificate with less than 90 days left
 * The ceremonies of the trust anchors are not a reason of the profile: they show as one item of the summary.
 * anchors: the trust anchors of this profile with what the platform says about them (live), if read.
 */
export function computeProfile(
  p: Profile & { file: string },
  anchors: FlatAnchor[] = [],
  opts: { installed?: boolean; zone?: ZoneState } = {},
): ComputedProfile {
  const records = p.records.map(r => ({ ...r, exportActive: isExportActive(r, opts.zone) }));
  const kept = records.filter(r => r.kind === 'record');
  const missing = kept.filter(r => !r.exportActive);
  const external = p.lifecycle === 'external';
  const reasons: Reason[] = [];
  const add = (level: Level, key: string, title: string, detail: string, vars?: Reason['vars']) => reasons.push({ level, key, title, detail, vars });
  const ids = missing.map(r => r.title || r.id).join(', ');

  if (missing.length && external) {
    add('critical', 'external-no-export', `${p.service}: knowledge and evidence only outside the zone`, `Records without an active export in this zone: ${ids}`, { n: missing.length, records: ids });
  } else if (missing.length) {
    add('warning', 'record-no-export', `${p.service}: ${missing.length} record(s) without an active export in this zone`, `Records: ${ids}`, { n: missing.length, records: ids });
  }
  for (const a of anchors.filter(x => x.service === p.service && x.live)) {
    const days = a.live!.daysLeft;
    if (days < EXPIRY_WARNING_DAYS) {
      add('warning', 'cert-expiring', `${p.service}: ${anchorName(a)} expires in ${days} days`, `Not after ${a.live!.notAfter}`, { anchor: anchorName(a), days });
    }
  }
  if (p.lifecycle === 'deprecated') {
    const by = p.replacedBy ? `, replaced by ${p.replacedBy}` : '';
    add('warning', p.replacedBy ? 'deprecated-replaced' : 'deprecated', `${p.service} deprecated${by}`, '', { replacedBy: p.replacedBy ?? '' });
  }
  if (p.status === 'draft') add('warning', 'draft', `${p.service}: profile not approved yet`, 'Approved by the group continuity-officer', {});

  reasons.sort((a, b) => Number(b.level === 'critical') - Number(a.level === 'critical'));
  return {
    ...p,
    records,
    installed: external || (opts.installed ?? true),
    external,
    recordsTotal: kept.length,
    recordsWithoutActiveExport: missing.length,
    state: reasons[0]?.level ?? 'ok',
    stateReason: reasons[0]?.key ?? 'ok',
    reasons,
  };
}

/** The trust anchors of every profile in one list, each with its service, its ceremony and what the platform says. */
export function flattenAnchors(
  profiles: Profile[],
  live: (service: string, id: string) => Pick<FlatAnchor, 'live' | 'liveError'> = () => ({}),
  zone: ZoneState = {},
): FlatAnchor[] {
  return profiles.flatMap(p => p.trustAnchors.map(a => ({ ...a, service: p.service, ceremony: ceremonyOf(a, zone), ...live(p.service, a.id) })));
}

const byLevelThenService = (a: Attention, b: Attention) => Number(b.level === 'critical') - Number(a.level === 'critical') || a.service.localeCompare(b.service);

/**
 * The whole summary of the page. Pure. installed: the names of the Components of this cluster's catalog
 * (undefined: unknown, everything counts as installed). Only what is installed (and the externals) counts in the
 * KPIs, the attention list and the trust anchors; the rest is listed apart, without state.
 * Attention: the critical items per service, then one item each for the drafts, the unrecorded ceremonies and (above
 * 5 services) the records without an active export, then the other warnings per service.
 */
export function buildSummary(
  all: Array<Profile & { file: string }>,
  anchorsOfAll: FlatAnchor[],
  warnings: string[] = [],
  installed?: ReadonlySet<string>,
  zone: ZoneState = {},
): Summary {
  const isIn = (p: Profile) => p.lifecycle === 'external' || !installed || installed.has(p.service);
  const present = all.filter(isIn);
  const services = new Set(present.map(p => p.service));
  const anchors = anchorsOfAll.filter(a => services.has(a.service));
  const computed = present.map(p => computeProfile(p, anchors, { installed: true, zone }));

  const perService = computed.flatMap(p =>
    p.reasons.map(r => ({ level: r.level, service: p.service, key: r.key, title: r.title, detail: r.detail, vars: r.vars }) as Attention),
  );
  const critical = perService.filter(a => a.level === 'critical').sort(byLevelThenService);
  const servicesOf = (key: string) => perService.filter(a => a.key === key).map(a => a.service);
  const aggregated: Attention[] = [];

  const drafts = servicesOf('draft');
  if (drafts.length) {
    aggregated.push({ level: 'warning', service: '', key: 'drafts', title: `${drafts.length} profile(s) not approved yet`, detail: 'Approved by the group continuity-officer', vars: { n: drafts.length, services: drafts.join(', ') } });
  }
  const unrecorded = anchors.filter(a => a.ceremony === 'unrecorded');
  if (unrecorded.length) {
    aggregated.push({
      level: 'warning',
      service: '',
      key: 'ceremonies-unrecorded',
      title: `${unrecorded.length} trust anchor(s) without a ceremony recorded in this zone`,
      detail: '',
      vars: { n: unrecorded.length },
    });
  }
  const noExport = servicesOf('record-no-export');
  const aggregateExports = noExport.length > EXPORTS_AGGREGATE_ABOVE;
  if (aggregateExports) {
    aggregated.push({
      level: 'warning',
      service: '',
      key: 'exports-missing',
      title: `${noExport.length} services with records without an active export in this zone`,
      detail: noExport.join(', '),
      vars: { n: noExport.length, services: noExport.join(', ') },
    });
  }
  const rest = perService
    .filter(a => a.level !== 'critical' && a.key !== 'draft' && !(aggregateExports && a.key === 'record-no-export'))
    .sort(byLevelThenService);

  const by = (f: (p: ComputedProfile) => boolean) => computed.filter(f).length;
  const notInstalled = all.filter(p => !isIn(p)).map(p => ({ service: p.service, title: p.title, tier: p.tier }));
  return {
    profiles: computed,
    notInstalled,
    trustAnchors: anchors,
    attention: [...critical, ...aggregated, ...rest],
    counts: {
      services: computed.length,
      approved: by(p => p.status === 'approved'),
      draft: by(p => p.status === 'draft'),
      recordsTotal: computed.reduce((n, p) => n + p.recordsTotal, 0),
      recordsWithoutActiveExport: computed.reduce((n, p) => n + p.recordsWithoutActiveExport, 0),
      trustAnchors: anchors.length,
      anchorsUnrecorded: unrecorded.length,
      deprecated: by(p => p.lifecycle === 'deprecated'),
      external: by(p => p.external),
      retired: by(p => p.lifecycle === 'retired'),
      notInstalled: notInstalled.length,
      ok: by(p => p.state === 'ok'),
      warning: by(p => p.state === 'warning'),
      critical: by(p => p.state === 'critical'),
    },
    warnings,
  };
}
