import { changeBlock, declaredBlock } from './manageBlocks';
import { appFile, ChangeError, editList, entriesOf, platformFile, platformList, registerHandler, type Owner } from './manageModel';

/**
 * Manage › Data management (DataHub).
 *
 * - Of the platform: domains and data products not of any application, manage.domains / manage.dataProducts of
 *   bootstrap/app-of-apps/platform/datahub.yaml, applied by the reconciler of datahub-oneke (charts/datahub-oneke/
 *   INSTALL.md, Platform objects). Entries are keyed by name (the slug of the urn); title is what DataHub shows.
 * - Of an application: its data product is its block datahub (urn:li:dataProduct:<program>-<app>, made by its
 *   provisioner in pro): create turns it on, update changes description, classification, retention and owners, delete
 *   is the block's tombstone (a soft delete in DataHub). Datasets and pipelines are not created here: the ingestion
 *   brings them.
 */

const SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : undefined);

/** owners as the reconciler reads them: { users, groups }; given by a form as two lists. */
export function ownersOf(spec: Record<string, unknown>) {
  const o = (spec.owners && typeof spec.owners === 'object' ? spec.owners : {}) as Record<string, unknown>;
  const users = strs(spec.ownerUsers) ?? strs(o.users);
  const groups = strs(spec.ownerGroups) ?? strs(o.groups);
  return users === undefined && groups === undefined ? undefined : { users: users ?? [], groups: groups ?? [] };
}

function common(action: string, spec: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (action === 'create' && !SLUG.test(str(spec.name) ?? '')) e.push('name: lowercase letters, digits and ._- (it is the id of the urn; it cannot change).');
  if (spec.description !== undefined && String(spec.description).length > 2000) e.push('description: at most 2000 characters.');
  return e;
}

/** Only the platform has its own domains: a domain of an application is the one of its program. */
const platformOnly = (what: string) => (owner: Owner) => {
  if (owner.kind !== 'platform') throw new ChangeError(422, `${what} belongs to the platform, not to an application.`);
  return platformFile('datahub');
};

registerHandler({
  service: 'datahub',
  object: 'domain',
  label: 'data domain',
  target: platformOnly('A domain'),
  validate: (action, spec) => [
    ...common(action, spec),
    ...(spec.parent !== undefined && spec.parent !== '' && !SLUG.test(String(spec.parent).replace(/^urn:li:domain:/, '')) ? ['parent: the name of another domain.'] : []),
  ],
  apply: (doc, req, touched) => {
    const s = req.spec ?? {};
    editList(doc, platformList(doc, 'domains', touched), req.action, req.id,
      { title: str(s.title), description: str(s.description), parent: str(s.parent) || undefined, owners: ownersOf(s) }, false);
  },
  declared: doc => entriesOf(doc, ['manage', 'domains']),
});

registerHandler({
  service: 'datahub',
  object: 'dataProduct',
  label: 'data product',
  target: owner => (owner.kind === 'platform' ? platformFile('datahub') : appFile(owner)),
  validate: (action, spec) => [
    ...common(action, spec),
    ...(spec.domain !== undefined && spec.domain !== '' && !SLUG.test(String(spec.domain).replace(/^urn:li:domain:/, '')) ? ['domain: the name of a domain.'] : []),
    ...(spec.retentionDays !== undefined && spec.retentionDays !== '' && !(Number(spec.retentionDays) > 0) ? ['retentionDays: a number of days.'] : []),
  ],
  apply: (doc, req, touched) => {
    const s = req.spec ?? {};
    if (req.owner.kind === 'application') {
      const owners = ownersOf(s);
      changeBlock(doc, 'datahub', req.action, req.id, req.owner, {
        description: str(s.description),
        classification: str(s.classification) || undefined,
        retentionDays: s.retentionDays === undefined || s.retentionDays === '' ? undefined : Number(s.retentionDays),
        domain: str(s.domain) || undefined,
        owners,
      }, touched);
      return;
    }
    if (req.action === 'create' && !str(s.title)) throw new ChangeError(422, 'The change is not valid.', ['title: the name DataHub shows.']);
    editList(doc, platformList(doc, 'dataProducts', touched), req.action, req.id, {
      title: str(s.title),
      description: str(s.description),
      domain: str(s.domain) || undefined,
      owners: ownersOf(s),
      classification: str(s.classification) || undefined,
      retentionDays: s.retentionDays === undefined || s.retentionDays === '' ? undefined : Number(s.retentionDays),
    }, false);
  },
  declared: (doc, owner) =>
    owner.kind === 'platform'
      ? entriesOf(doc, ['manage', 'dataProducts'])
      : declaredBlock(doc, 'datahub', b => ({ description: b.description, classification: b.classification, retentionDays: b.retentionDays, domain: b.domain, owners: b.owners })),
});
