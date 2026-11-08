import { useI18n } from '../../i18n';
import type { Row } from '../ManagePages';
import { type Kind, ManageTabs } from './ManageObjectsView';

/**
 * Manage › Monitoring (Grafana, Prometheus, Loki) in the console, by pull request (backend manageHandlersMonitoring.ts):
 *
 * - Applications: the block monitoring of each application (its file of the app-of-apps): Prometheus scrapes its API and
 *   each stage gets Logs and Performance in Applications/<application>/<stage> of Grafana. Only turned on from here.
 * - Dashboards: the dashboards of the application's own, platform/monitoring/<name>.json of its repository, from a
 *   template or a Grafana export. They travel in its image: dev gets them when it is built, pre and pro when promoted.
 */

const NAME = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));
/** the folder of an application in Grafana (observability-oneke grafana.folders: prefix app) */
const folderUid = (app: unknown) => `app-${String(app ?? '')}`.slice(0, 40);

export const MonitoringPage = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const TEMPLATES = [
    { value: 'database', label: tx('Database: its PostgreSQL pods (CPU, memory, volume, restarts)', 'Base de datos: sus pods de PostgreSQL (CPU, memoria, volumen, reinicios)') },
    { value: 'jobs', label: tx('Scheduled jobs: hours since the last success, failed jobs', 'Tareas programadas: horas desde el último éxito, tareas fallidas') },
    { value: 'platform', label: tx('Platform calls: processes, flows, s3, dms… by outcome and latency', 'Llamadas a la plataforma: procesos, flujos, s3, dms… por resultado y latencia') },
    { value: 'business', label: tx('Business metrics: the metrics its API exposes itself', 'Métricas de negocio: las métricas propias que expone su API') },
  ];
  const templateLabel = (v: unknown) => TEMPLATES.find(t => t.value === v)?.label.split(':')[0] ?? String(v ?? '');

  const apps: Kind = {
    label: tx('Applications', 'Aplicaciones'),
    service: 'monitoring',
    object: 'monitoring',
    what: tx('monitoring', 'monitorización'),
    columns: [
      { key: 'name', label: tx('Application', 'Aplicación') },
      { key: 'folder', label: tx('Grafana folder', 'Carpeta de Grafana'), render: r => <code>{String(r.folder)}</code> },
    ],
    rowOf: d => ({ name: d.owner.kind === 'application' ? d.owner.name : d.id, folder: `Applications/${d.owner.kind === 'application' ? d.owner.name : d.id}` }),
    title: r => String(r.name),
    open: (r, host) => `${host('grafana')}/dashboards/f/${enc(folderUid(r.name))}/`,
    idFromOwner: true,
    noEdit: true,
    noDelete: true,
    appFields: [],
    note: tx(
      'Turning monitoring on: Prometheus reads the request metrics of its API, and every stage of the application gets its folder Applications/<application>/<stage> in Grafana with Logs and Performance, and the Logging and Performance tabs in the portal. Who sees them: the Keycloak groups grafana-<application>-editors and -viewers (Manage › IAM).',
      'Al activar la monitorización, Prometheus lee las métricas de peticiones de su API y cada entorno de la aplicación tiene su carpeta Applications/<aplicación>/<entorno> en Grafana con Logs y Performance, y las pestañas Logging y Performance en el portal. Quién los ve: los grupos de Keycloak grafana-<aplicación>-editors y -viewers (Manage › IAM).',
    ),
  };

  const dashboards: Kind = {
    label: tx('Dashboards', 'Dashboards'),
    service: 'monitoring',
    object: 'dashboard',
    what: tx('dashboard', 'dashboard'),
    columns: [
      { key: 'name', label: tx('Dashboard', 'Dashboard') },
      { key: 'title', label: tx('Title', 'Título') },
      {
        key: 'source',
        label: tx('Made from', 'Origen'),
        render: r =>
          `${r.source === 'template' ? `${tx('template', 'plantilla')} · ${templateLabel(r.template)}` : tx('Grafana export', 'exportación de Grafana')}${r.replacesStandard ? ` · ${tx('replaces the standard one', 'sustituye al estándar')}` : ''}`,
      },
    ],
    rowOf: d => ({ name: d.id, app: d.owner.kind === 'application' ? d.owner.name : '', file: `platform/monitoring/${d.id}.json`, ...d.spec }),
    title: (r: Row) => `${String(r.app)} · ${String(r.name)}`,
    facts: r => [
      [tx('File', 'Fichero'), <code>{String(r.file)}</code>],
      [tx('In Grafana', 'En Grafana'), `Applications/${String(r.app)}/<stage> · "<${tx('title', 'título')}> - ${String(r.title)}"`],
    ],
    open: (r, host) => `${host('grafana')}/dashboards/f/${enc(folderUid(r.app))}/`,
    appFields: [
      {
        key: 'name',
        label: tx('Name', 'Nombre'),
        kind: 'text',
        required: true,
        createOnly: true,
        pattern: { re: NAME, message: tx('lowercase letters, digits and "-"', 'minúsculas, dígitos y "-"') },
        help: tx('The file platform/monitoring/<name>.json of the repository. Named logs or performance, it replaces the standard one.', 'El fichero platform/monitoring/<nombre>.json del repositorio. Si se llama logs o performance, sustituye al estándar.'),
      },
      {
        key: 'source',
        label: tx('Start from', 'Partir de'),
        kind: 'select',
        required: true,
        options: [
          { value: 'template', label: tx('A template', 'Una plantilla') },
          { value: 'import', label: tx('A Grafana export (JSON)', 'Una exportación de Grafana (JSON)') },
        ],
      },
      { key: 'template', label: tx('Template', 'Plantilla'), kind: 'select', required: true, options: TEMPLATES, when: v => v.source !== 'import' },
      {
        key: 'json',
        label: tx('Dashboard JSON', 'JSON del dashboard'),
        kind: 'textarea',
        required: true,
        when: v => v.source === 'import',
        help: tx(
          'Grafana › the dashboard › Share › Export › Copy to clipboard (or Save to file and paste it). id, uid and version are dropped; its datasources become those of the platform.',
          'Grafana › el dashboard › Share › Export › Copy to clipboard (o guárdalo y pégalo). Se quitan id, uid y version; sus fuentes de datos pasan a ser las de la plataforma.',
        ),
      },
      { key: 'title', label: tx('Title (optional)', 'Título (opcional)'), kind: 'text', help: tx('Grafana shows "<title of the application> - <this>".', 'Grafana muestra "<título de la aplicación> - <esto>".') },
    ],
    values: d => ({ source: d.spec.source, template: d.spec.template, title: d.spec.title }),
    note: tx(
      'A dashboard of its own is a file of the repository of the application (pull request there). It travels in its image: dev gets it when the image is built, pre and pro when it is promoted. What is edited in Grafana stays until its file changes: export it and update it here to keep it.',
      'Un dashboard propio es un fichero del repositorio de la aplicación (el pull request se abre allí). Viaja en su imagen: llega a dev al construirla y a pre y pro al promoverla. Lo que se edite en Grafana se mantiene hasta que cambie su fichero: expórtalo y actualízalo aquí para conservarlo.',
    ),
  };

  return <ManageTabs kinds={[apps, dashboards]} label="Monitoring" />;
};
