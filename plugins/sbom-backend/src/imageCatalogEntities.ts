import { coreServices, createBackendModule, LoggerService, SchedulerServiceTaskRunner } from '@backstage/backend-plugin-api';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
// Not from '/alpha': plugin-catalog-node 2.x exports it only from its main entry (see keycloak-backend catalogModule).
import { catalogProcessingExtensionPoint, EntityProvider, EntityProviderConnection } from '@backstage/plugin-catalog-node';
import { ImageCatalogService, ImageCatalogView, ImageView } from './imageCatalog';
import { imageCatalogFromConfig } from './imageCatalogConfig';

export const IMAGE_SYSTEM = 'image-catalog';
export const ANNOTATION_HARBOR_REPOSITORY = 'refresquito.io/harbor-repository';

/** A catalog name: lower case letters, digits and '-', at most 63 characters. */
export const entityNameOf = (repository: string) =>
  `image-${repository.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 63).replace(/-+$/, '');

const tagOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);

/** The entities of the image catalog: one System and one Resource (type container-image) per repository. */
export function entitiesOf(view: ImageCatalogView): Entity[] {
  const location = `url:${view.harbor}/common/image-catalog`;
  const managed = { [ANNOTATION_LOCATION]: location, [ANNOTATION_ORIGIN_LOCATION]: location };
  const system: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'System',
    metadata: {
      name: IMAGE_SYSTEM,
      title: 'Image catalog',
      description: 'Container images of Harbor that the systems of the PaaS may use (common, framework-python, framework-spring).',
      annotations: managed,
      links: [{ url: '/images', title: 'Images', icon: 'catalog' }],
    },
    spec: { owner: 'platform-team' },
  };
  return [system, ...view.images.map(i => resourceOf(i, managed))];
}

function resourceOf(image: ImageView, managed: Record<string, string>): Entity {
  const first = image.tags[0];
  const states = new Set(image.tags.map(t => t.state));
  const lifecycle = states.has('approved') || states.has('unknown') ? 'production' : 'deprecated';
  const versions = image.tags.map(t => t.tag).join(', ');
  const tags = [...new Set([first?.category, first?.audience === 'unknown' ? '' : first?.audience, image.project].filter(Boolean).map(t => tagOf(t as string)))];
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: entityNameOf(image.repository),
      title: image.repository,
      description: first?.summary || `Image ${image.repository} of Harbor (tags: ${versions})`,
      tags,
      annotations: {
        ...managed,
        [ANNOTATION_HARBOR_REPOSITORY]: image.repository,
        'refresquito.io/image-tags': versions,
        ...(image.source ? { 'refresquito.io/image-source': image.source } : {}),
      },
      links: [
        { url: `/images?repository=${encodeURIComponent(image.repository)}`, title: 'In the image catalog', icon: 'catalog' },
        { url: image.harborUrl, title: 'In Harbor', icon: 'web' },
      ],
    },
    spec: {
      type: 'container-image',
      owner: first?.owner || 'platform-team',
      lifecycle,
      system: IMAGE_SYSTEM,
    },
  };
}

export class ImageCatalogEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly service: ImageCatalogService,
    private readonly logger: LoggerService,
    private readonly taskRunner: SchedulerServiceTaskRunner,
  ) {}

  getProviderName(): string {
    return 'refresquito-image-catalog';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.taskRunner.run({ id: this.getProviderName(), fn: () => this.refresh() });
  }

  async refresh(): Promise<void> {
    if (!this.connection) throw new Error('image catalog entity provider not connected yet');
    const view = await this.service.view();
    // Harbor unreachable: keep the entities we have instead of emptying the catalog
    if (view.images.length === 0 && view.errors.length > 0) {
      this.logger.warn(`image catalog: nothing read from Harbor, entities kept (${view.errors[0]})`);
      return;
    }
    const entities = entitiesOf(view);
    await this.connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({ entity, locationKey: this.getProviderName() })),
    });
    this.logger.info(`image catalog: ${entities.length - 1} images in the catalog (published catalog: ${view.catalog?.published})`);
  }
}

/** Catalog module: the images of the image catalog as entities (only when sbom.imageCatalog is configured). */
export const catalogModuleImageCatalog = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'refresquito-image-catalog',
  register(reg) {
    reg.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        const service = imageCatalogFromConfig(config, logger);
        if (!service) {
          logger.info('sbom.imageCatalog not set: no image entities');
          return;
        }
        const taskRunner = scheduler.createScheduledTaskRunner({ frequency: { minutes: 30 }, timeout: { minutes: 5 } });
        catalog.addEntityProvider(new ImageCatalogEntityProvider(service, logger, taskRunner));
      },
    });
  },
});
