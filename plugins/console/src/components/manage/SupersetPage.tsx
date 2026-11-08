import { useI18n } from '../../i18n';
import type { Row } from '../ManagePages';
import { type Kind, ManageTabs } from './ManageObjectsView';

/**
 * Manage › Business intelligence (Superset) in the console: the dashboards of each application (its block dashboards:
 * on, or retired) and the shared connections of the platform, by pull request (backend manageHandlersSuperset.ts). The
 * dashboards, charts and datasets themselves come from the image of each application or are made in Superset.
 */

type Declared = { kind: 'platform' } | undefined;
const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));

export const SupersetPage = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const apps: Kind = {
    label: tx('Applications', 'Aplicaciones'),
    service: 'superset',
    object: 'dashboards',
    what: tx('dashboards', 'dashboards'),
    columns: [{ key: 'name', label: tx('Application', 'Aplicación') }],
    rowOf: d => ({ name: d.owner.kind === 'application' ? d.owner.name : d.id }),
    title: r => String(r.name),
    idFromOwner: true,
    noEdit: true,
    appFields: [],
    note: tx('An application with dashboards brings them in its image (platform/dashboards/); the platform imports them over its own database, read only. Here you turn them on for an application, or retire them (they, their charts, datasets and connection are deleted).',
      'Una aplicación con dashboards los trae en su imagen (platform/dashboards/); la plataforma los importa sobre su propia base de datos, en solo lectura. Aquí los activas para una aplicación o los retiras (se borran con sus gráficos, datasets y conexión).'),
  };
  const connections: Kind = {
    label: tx('Connections', 'Conexiones'),
    service: 'superset',
    object: 'connection',
    what: tx('connection', 'conexión'),
    live: { plugin: 'superset-manager', path: '/connections' },
    columns: [
      { key: 'name', label: tx('Connection', 'Conexión') },
      { key: 'backend', label: tx('Database', 'Base de datos'), render: r => String(r.backend ?? '—') },
    ],
    key: r => ((r.declared as Declared)?.kind === 'platform' ? { owner: { kind: 'platform' }, id: String(r.name) } : undefined),
    rowOf: d => ({ name: d.id, backend: d.spec.backend }),
    title: r => String(r.name),
    open: (_, host) => `${host('superset')}/databaseview/list/`,
    platformFields: [
      { key: 'name', label: tx('Name', 'Nombre'), kind: 'text', required: true, createOnly: true },
      { key: 'backend', label: tx('Engine', 'Motor'), kind: 'select', required: true, options: [{ value: 'postgresql', label: 'PostgreSQL' }] },
      { key: 'host', label: tx('Host', 'Host'), kind: 'text', required: true },
      { key: 'port', label: tx('Port', 'Puerto'), kind: 'text', pattern: { re: /^[0-9]{1,5}$/, message: '1-65535' } },
      { key: 'database', label: tx('Database', 'Base de datos'), kind: 'text', required: true },
      { key: 'username', label: tx('User (read only)', 'Usuario (solo lectura)'), kind: 'text' },
      { key: 'passwordFrom', label: tx('Password from the store', 'Contraseña del store'), kind: 'text', help: tx('<storeKey>.<property> of the secret store: the password itself never goes to git', '<storeKey>.<property> del store de secretos: la contraseña nunca va a git'), pattern: { re: /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$/, message: '<storeKey>.<property>' } },
      { key: 'exposeInSqlLab', label: tx('Usable in SQL Lab', 'Usable en SQL Lab'), kind: 'boolean' },
    ],
    values: d => {
      const p = d.spec.passwordFrom as { storeKey?: string; property?: string } | undefined;
      return { ...d.spec, port: d.spec.port === undefined ? undefined : String(d.spec.port), passwordFrom: p?.storeKey ? `${p.storeKey}.${p.property}` : undefined };
    },
    note: tx('Shared connections of the platform, read only. The connection of an application is the one of its dashboards.', 'Conexiones compartidas de la plataforma, en solo lectura. La conexión de una aplicación es la de sus dashboards.'),
  };
  const look = tx('Made from the images of the applications or in Superset: only to look.', 'Vienen de las imágenes de las aplicaciones o se hacen en Superset: solo para consultar.');
  const ro = (label: string, path: string, columns: Kind['columns'], open: Kind['open']): Kind => ({
    label, service: 'superset', object: '', what: label, readOnly: true, noCreate: true, live: { plugin: 'superset-manager', path }, columns, title: (r: Row) => String(r.name), open, note: look,
  });
  const dashboards = ro(tx('Dashboards', 'Dashboards'), '/dashboards', [{ key: 'name', label: 'Dashboard' }, { key: 'owners', label: tx('Owners', 'Propietarios'), render: r => list(r.owners) || '—' }], r => str(r.dashboardUrl));
  const charts = ro(tx('Charts', 'Gráficos'), '/charts', [{ key: 'name', label: tx('Chart', 'Gráfico') }, { key: 'vizType', label: tx('Type', 'Tipo') }], r => str(r.exploreUrl));
  const datasets = ro(tx('Datasets', 'Datasets'), '/datasets', [{ key: 'name', label: 'Dataset' }, { key: 'connection', label: tx('Connection', 'Conexión') }],
    (r, host) => (r.id ? `${host('superset')}/explore/?datasource_type=table&datasource_id=${enc(r.id)}` : undefined));
  return <ManageTabs kinds={[apps, connections, dashboards, charts, datasets]} label="Business intelligence" />;
};
