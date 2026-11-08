import type { LoggerService, RootConfigService, SchedulerServiceTaskRunner } from '@backstage/backend-plugin-api';
import { ANNOTATION_EDIT_URL, ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, ANNOTATION_VIEW_URL, type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type { EntityProvider, EntityProviderConnection } from '@backstage/plugin-catalog-node';
import { parseAllDocuments } from 'yaml';
import { type FolderFile, GitHubRateLimitError, readFolder } from './githubFolder';

/**
 * The entity provider `business-map` (docs/business-map.md): the Domains, BusinessProcesses and ReferenceModels of
 * catalog/business-map/<namespace>/*.yaml of refresquito-services, read through GraphQL every 10 minutes (the tree in
 * one query, the text of the files that changed in batches) and given to the catalog as a full mutation. It replaces the Location that read every file through the
 * contents API on each refresh (thousands of requests an hour for one customer, the whole limit of the token).
 *
 * A file that is not valid YAML, or a document that is not one of these kinds, is left out and logged: the rest go
 * on. When GitHub limits the token, or cannot be read, the run is skipped and the catalog keeps what it has.
 */

export const PROVIDER_NAME = 'business-map';
export const LOCATION_KEY = 'business-map-provider';
const FOLDER = 'catalog/business-map';
const KINDS = new Set(['Domain', 'BusinessProcess', 'ReferenceModel']);

export type Skipped = { path: string; reason: string };

/** The entities of the files, annotated with where each one is; what cannot be one is in skipped. */
export function providerEntities(files: FolderFile[], src: { repo: string; branch: string }): { entities: Entity[]; skipped: Skipped[] } {
  const entities: Entity[] = [];
  const skipped: Skipped[] = [];
  const seen = new Map<string, string>();
  for (const f of files) {
    const blob = `https://github.com/${src.repo}/blob/${src.branch}/${f.path}`;
    const edit = `https://github.com/${src.repo}/edit/${src.branch}/${f.path}`;
    let docs;
    try {
      docs = parseAllDocuments(f.text);
    } catch (e) {
      skipped.push({ path: f.path, reason: `not YAML: ${(e as Error).message}` });
      continue;
    }
    docs.forEach((doc, i) => {
      const where = docs.length > 1 ? `${f.path} (document ${i + 1})` : f.path;
      if (doc.errors.length) {
        skipped.push({ path: where, reason: `not YAML: ${doc.errors[0].message}` });
        return;
      }
      const e = doc.toJS() as Partial<Entity> | null;
      if (e === null || e === undefined) return; // an empty document (a trailing ---)
      if (typeof e !== 'object' || typeof e.apiVersion !== 'string' || typeof e.kind !== 'string' || typeof e.metadata?.name !== 'string') {
        skipped.push({ path: where, reason: 'not an entity (apiVersion, kind and metadata.name)' });
        return;
      }
      if (!KINDS.has(e.kind)) {
        skipped.push({ path: where, reason: `${e.kind} is none of ${[...KINDS].join(', ')}` });
        return;
      }
      const entity: Entity = {
        ...(e as Entity),
        metadata: {
          ...e.metadata,
          namespace: e.metadata.namespace ?? 'default',
          annotations: {
            ...(e.metadata.annotations ?? {}),
            [ANNOTATION_LOCATION]: `url:${blob}`,
            [ANNOTATION_ORIGIN_LOCATION]: `url:${blob}`,
            [ANNOTATION_VIEW_URL]: blob,
            [ANNOTATION_EDIT_URL]: edit,
          },
        },
      };
      const ref = stringifyEntityRef(entity);
      if (seen.has(ref)) {
        skipped.push({ path: where, reason: `${ref} is also in ${seen.get(ref)}` });
        return;
      }
      seen.set(ref, where);
      entities.push(entity);
    });
  }
  return { entities, skipped };
}

export type ProviderOptions = { repo: string; branch: string; token?: string; fetchFn?: typeof fetch };

/** businessMap.repo / .branch (as the importer), the token of the GitHub integration, and the schedule. */
export function providerConfig(config: RootConfigService) {
  return {
    enabled: config.getOptionalBoolean('businessMap.provider.enabled') ?? true,
    frequency: config.getOptionalNumber('businessMap.provider.frequency') ?? 10,
    repo: config.getOptionalString('businessMap.repo') ?? config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services',
    branch: config.getOptionalString('businessMap.branch') ?? 'main',
    token: config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token'),
  };
}

export class BusinessMapEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly options: ProviderOptions,
    private readonly logger: LoggerService,
    private readonly runner?: SchedulerServiceTaskRunner,
  ) {}

  getProviderName(): string {
    return PROVIDER_NAME;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.runner?.run({
      id: `${PROVIDER_NAME}:refresh`,
      fn: async () => {
        await this.refresh();
      },
    });
  }

  /** One run: read the folder, give the catalog every entity (or keep what it has when GitHub cannot be read). */
  async refresh(): Promise<'applied' | 'skipped'> {
    if (!this.connection) throw new Error('business-map provider: not connected to the catalog yet');
    let files: FolderFile[];
    try {
      files = await readFolder({ repo: this.options.repo, branch: this.options.branch, token: this.options.token }, FOLDER, 2, this.options.fetchFn ?? fetch);
    } catch (e) {
      const why = e instanceof GitHubRateLimitError ? e.message : `cannot read ${this.options.repo}/${FOLDER}: ${(e as Error).message}`;
      this.logger.warn(`business-map provider: run skipped, the catalog keeps what it has. ${why}`);
      return 'skipped';
    }
    const { entities, skipped } = providerEntities(files, this.options);
    for (const s of skipped) this.logger.warn(`business-map provider: left out ${s.path}: ${s.reason}`);
    await this.connection.applyMutation({ type: 'full', entities: entities.map(entity => ({ entity, locationKey: LOCATION_KEY })) });
    this.logger.info(`business-map provider: ${entities.length} entities from ${files.length} files of ${this.options.repo}@${this.options.branch} (GraphQL: the tree + the changed files in batches of 50)${skipped.length ? `, ${skipped.length} left out` : ''}`);
    return 'applied';
  }
}
