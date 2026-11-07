import type { Attention, ComputedProfile, FlatAnchor, Level, Profile, Reason, Summary } from './types';

/** A live certificate closer than this to its end is a warning. */
export const EXPIRY_WARNING_DAYS = 90;

const isRecord = (r: { kind: string }) => r.kind === 'record';
const hasActiveExport = (r: { export?: { status?: string } }) => r.export?.status === 'active';
const anchorName = (a: { id: string; title?: string }) => a.title || a.id;

/**
 * The state of one profile and its causes. Pure. Rules:
 *   critical  lifecycle external and a record without an active export (the knowledge lives only outside the zone)
 *             a trust anchor without an offline copy (offlineCopy no)
 *   warning   a record without an active export, lifecycle deprecated, status draft,
 *             a trust anchor whose offline copy is unknown, a live certificate with less than 90 days left
 * anchors: the trust anchors of this profile with what the platform says about them (live), if read.
 */
export function computeProfile(p: Profile & { file: string }, anchors: FlatAnchor[] = []): ComputedProfile {
  const records = p.records.filter(isRecord);
  const missing = records.filter(r => !hasActiveExport(r));
  const reasons: Reason[] = [];
  const add = (level: Level, key: string, title: string, detail: string, vars?: Reason['vars']) => reasons.push({ level, key, title, detail, vars });
  const ids = missing.map(r => r.title || r.id).join(', ');

  if (missing.length && p.lifecycle === 'external') {
    add('critical', 'external-no-export', `${p.service}: knowledge only outside the zone`, `Records without an active export: ${ids}`, { n: missing.length, records: ids });
  } else if (missing.length) {
    add('warning', 'record-no-export', `${p.service}: ${missing.length} record(s) without an active export`, `Records: ${ids}`, { n: missing.length, records: ids });
  }
  for (const a of p.trustAnchors) {
    if (a.offlineCopy === 'no') {
      add('critical', 'anchor-no-offline', `${p.service}: ${anchorName(a)} without offline copy`, a.notes ?? '', { anchor: anchorName(a) });
    } else if (a.offlineCopy === 'unknown') {
      add('warning', 'anchor-offline-unknown', `${p.service}: offline copy of ${anchorName(a)} unknown`, a.notes ?? '', { anchor: anchorName(a) });
    }
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
  const state = reasons[0]?.level ?? 'ok';
  return {
    ...p,
    recordsTotal: records.length,
    recordsWithoutActiveExport: missing.length,
    state,
    stateReason: reasons[0]?.key ?? 'ok',
    reasons,
  };
}

/** The trust anchors of every profile in one list, each with its service and what the platform says of it. */
export function flattenAnchors(profiles: Profile[], live: (service: string, id: string) => Pick<FlatAnchor, 'live' | 'liveError'> = () => ({})): FlatAnchor[] {
  return profiles.flatMap(p => p.trustAnchors.map(a => ({ ...a, service: p.service, ...live(p.service, a.id) })));
}

/** The whole summary of the page, from the profiles and the anchors as read. Pure. */
export function buildSummary(profiles: Array<Profile & { file: string }>, anchors: FlatAnchor[], warnings: string[] = []): Summary {
  const computed = profiles.map(p => computeProfile(p, anchors));
  const attention: Attention[] = computed
    .flatMap(p => p.reasons.map(r => ({ level: r.level, service: p.service, key: r.key, title: r.title, detail: r.detail, vars: r.vars })))
    .sort((a, b) => Number(b.level === 'critical') - Number(a.level === 'critical') || a.service.localeCompare(b.service));
  const by = (f: (p: ComputedProfile) => boolean) => computed.filter(f).length;
  return {
    profiles: computed,
    trustAnchors: anchors,
    attention,
    counts: {
      services: computed.length,
      approved: by(p => p.status === 'approved'),
      draft: by(p => p.status === 'draft'),
      recordsTotal: computed.reduce((n, p) => n + p.recordsTotal, 0),
      recordsWithoutActiveExport: computed.reduce((n, p) => n + p.recordsWithoutActiveExport, 0),
      trustAnchors: anchors.length,
      anchorsWithoutOfflineCopy: anchors.filter(a => a.offlineCopy === 'no' || a.offlineCopy === 'unknown').length,
      deprecated: by(p => p.lifecycle === 'deprecated'),
      external: by(p => p.lifecycle === 'external'),
      retired: by(p => p.lifecycle === 'retired'),
      ok: by(p => p.state === 'ok'),
      warning: by(p => p.state === 'warning'),
      critical: by(p => p.state === 'critical'),
    },
    warnings,
  };
}
