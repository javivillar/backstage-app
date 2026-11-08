import { useI18n } from '../../i18n';
import type { Row } from '../ManagePages';
import { type Kind, ManageTabs } from './ManageObjectsView';

/**
 * Manage › Business process (Operaton, operaton-oneke) in the console: which applications use the process engine, and
 * which Keycloak groups may start their processes and work their tasks, by pull request (backend
 * manageHandlersProcesses.ts). The processes themselves (BPMN, DMN) come from the image of each application
 * (platform/processes/): the list of definitions is only to look, with the way to Cockpit.
 */

const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : '');
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const ProcessesPage = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const apps: Kind = {
    label: tx('Applications', 'Aplicaciones'),
    service: 'processes',
    object: 'processes',
    what: tx('business processes', 'procesos de negocio'),
    columns: [
      { key: 'name', label: tx('Application', 'Aplicación') },
      { key: 'groups', label: tx('Groups that work its tasks', 'Grupos que trabajan sus tareas'), render: (r: Row) => list(r.groups) || '—' },
    ],
    rowOf: d => ({ name: d.owner.kind === 'application' ? d.owner.name : d.id, groups: d.spec.groups }),
    title: r => String(r.name),
    idFromOwner: true,
    appFields: [
      { key: 'groups', label: tx('Keycloak groups that may start its processes and work their tasks', 'Grupos de Keycloak que pueden iniciar sus procesos y trabajar sus tareas'), kind: 'list',
        help: tx('in Tasklist; a group taken out loses its grants', 'en Tasklist; un grupo que se quita pierde sus permisos') },
    ],
    note: tx('The processes of an application come in its image (platform/processes/*.bpmn) and run in Operaton, the open-source process engine (Camunda 7 compatible). Here you turn them on for an application, choose the groups that work their tasks, or retire them (never while instances are still running).',
      'Los procesos de una aplicación vienen en su imagen (platform/processes/*.bpmn) y se ejecutan en Operaton, el motor de procesos de código abierto (compatible con Camunda 7). Aquí los activas para una aplicación, eliges los grupos que trabajan sus tareas o los retiras (nunca con instancias aún en curso).'),
  };
  const definitions: Kind = {
    label: tx('Process definitions', 'Definiciones de procesos'),
    service: 'processes',
    object: '',
    what: tx('process', 'proceso'),
    readOnly: true,
    noCreate: true,
    live: { plugin: 'camunda-manager', path: '/process-definitions' },
    columns: [
      { key: 'name', label: tx('Process', 'Proceso') },
      { key: 'key', label: tx('Key', 'Clave'), render: r => <code>{String(r.key)}</code> },
      { key: 'version', label: tx('Version', 'Versión') },
    ],
    title: r => String(r.name ?? r.key),
    open: r => str(r.cockpitUrl),
    note: tx('Deployed from the images of the applications: only to look. Instances, incidents and tasks are in Cockpit and Tasklist of Operaton.',
      'Desplegados desde las imágenes de las aplicaciones: solo para consultar. Las instancias, incidencias y tareas están en Cockpit y Tasklist de Operaton.'),
  };
  return <ManageTabs kinds={[apps, definitions]} label="Business process" />;
};
