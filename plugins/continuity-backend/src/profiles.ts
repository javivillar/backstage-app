import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import type { ContinuityRecord, Profile, TrustAnchor } from './types';

const LIFECYCLES = ['supported', 'deprecated', 'retired', 'external'];
const STATUSES = ['draft', 'approved'];
const TIERS = ['A', 'B', 'C'];
const RECORD_KINDS = ['record', 'definitions', 'rebuildable', 'operational'];
const ANCHOR_KINDS = ['ca', 'signing-key', 'realm-keys', 'passphrase'];
/**
 * Fields of chart continuity-oneke 0.1.0 that are facts of one zone and left git in 0.1.1: still read (a cluster
 * with the old chart renders), ignored with a warning.
 */
const PER_ZONE_ANCHOR = ['offlineCopy', 'custodians', 'lastCeremony'];
const PER_ZONE_EXPORT = ['status'];

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * One profile from the text of its YAML file. Pure: throws on a file that is not a profile (no service), and adds a
 * warning (not an error) for each value outside the schema, so a profile with a typo still shows.
 */
export function parseProfile(text: string, file: string, warnings: string[] = []): Profile {
  const doc = obj(parse(text));
  const service = str(doc.service)?.trim();
  if (!service) throw new Error('no service');
  const expected = path.basename(file).replace(/\.ya?ml$/, '');
  if (expected !== service) warnings.push(`${file}: service is ${service}, the file is named ${expected}.yaml`);
  const check = (field: string, value: string | undefined, allowed: string[]) => {
    if (value !== undefined && !allowed.includes(value)) warnings.push(`${file}: ${field} "${value}" is not one of ${allowed.join(', ')}`);
  };

  const lifecycle = str(doc.lifecycle) ?? 'supported';
  const status = str(doc.status) ?? 'draft';
  const tier = str(doc.tier);
  check('lifecycle', lifecycle, LIFECYCLES);
  check('status', status, STATUSES);
  check('tier', tier, TIERS);

  const ignored = new Set<string>();
  const records: ContinuityRecord[] = list(doc.records).map((r, i) => {
    const o = obj(r);
    const e = o.export === undefined ? undefined : obj(o.export);
    const rec: ContinuityRecord = {
      id: str(o.id) ?? `record-${i + 1}`,
      title: str(o.title),
      kind: str(o.kind) ?? 'record',
      retention: str(o.retention),
      export: e && { method: str(e.method), format: str(e.format), schedule: str(e.schedule), workflow: str(e.workflow) },
      worm: o.worm === true,
      notes: str(o.notes),
    };
    check(`records[${rec.id}].kind`, rec.kind, RECORD_KINDS);
    PER_ZONE_EXPORT.filter(k => e && k in e).forEach(k => ignored.add(`records[].export.${k}`));
    return rec;
  });

  const trustAnchors: TrustAnchor[] = list(doc.trustAnchors).map((a, i) => {
    const o = obj(a);
    const anchor: TrustAnchor = {
      id: str(o.id) ?? `anchor-${i + 1}`,
      title: str(o.title),
      kind: str(o.kind) ?? 'ca',
      probe: str(o.probe),
      notes: str(o.notes),
    };
    check(`trustAnchors[${anchor.id}].kind`, anchor.kind, ANCHOR_KINDS);
    PER_ZONE_ANCHOR.filter(k => k in o).forEach(k => ignored.add(`trustAnchors[].${k}`));
    return anchor;
  });

  if (ignored.size) warnings.push(`${file}: ignored ${[...ignored].join(', ')} (facts of one zone, not in the profile since continuity-oneke 0.1.1)`);

  const exit = doc.exit === undefined ? undefined : obj(doc.exit);
  const upstream = exit && exit.upstream !== undefined ? obj(exit.upstream) : undefined;
  return {
    service,
    title: str(doc.title),
    tier,
    lifecycle,
    status,
    replacedBy: str(doc.replacedBy),
    approvedBy: str(doc.approvedBy),
    approvedAt: str(doc.approvedAt),
    managedIn: str(doc.managedIn),
    notes: str(doc.notes),
    records,
    trustAnchors,
    exit: exit && {
      alternative: str(exit.alternative),
      exportFormat: str(exit.exportFormat),
      upstream: upstream && { project: str(upstream.project), license: str(upstream.license) },
    },
  };
}

/** The profile files of a mounted ConfigMap: *.yaml / *.yml, not the hidden ..data entries of the volume. */
export const isProfileFile = (name: string) => !name.startsWith('.') && /\.ya?ml$/.test(name);

export class ProfilesUnavailableError extends Error {}

/**
 * Every profile of the directory, sorted by service. A file that cannot be read or parsed becomes a warning; the
 * directory itself missing is ProfilesUnavailableError (the page then says the portal is not configured).
 */
export async function loadProfiles(dir: string): Promise<{ profiles: Array<Profile & { file: string }>; warnings: string[] }> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (e) {
    throw new ProfilesUnavailableError(`The continuity profiles directory ${dir} cannot be read: ${(e as Error).message}`);
  }
  const warnings: string[] = [];
  const profiles: Array<Profile & { file: string }> = [];
  for (const name of names.filter(isProfileFile).sort()) {
    try {
      const text = await fs.promises.readFile(path.join(dir, name), 'utf8');
      profiles.push({ ...parseProfile(text, name, warnings), file: name });
    } catch (e) {
      warnings.push(`${name}: ${(e as Error).message}`);
    }
  }
  const seen = new Set<string>();
  const unique = profiles.filter(p => {
    if (seen.has(p.service)) {
      warnings.push(`${p.file}: service ${p.service} has more than one profile; only the first is shown`);
      return false;
    }
    seen.add(p.service);
    return true;
  });
  return { profiles: unique.sort((a, b) => a.service.localeCompare(b.service)), warnings };
}
