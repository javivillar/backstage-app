import type { Messages } from '../i18n';

/** Texts of Portal › Support › Monitoring (MonitoringPage): key → English and Spanish. */
export const MONITORING: Messages = {
  'nav.monitoring': { en: 'Monitoring', es: 'Monitorización' },
  'nav.monitoring.hint': { en: 'Grafana dashboards of every service and application', es: 'Dashboards de Grafana de cada servicio y aplicación' },
  'mon.sub': {
    en: 'The Grafana dashboards of the Refresquito services and the business applications: performance and logs, without leaving the portal.',
    es: 'Los dashboards de Grafana de los servicios de Refresquito y de las aplicaciones de negocio: rendimiento y logs, sin salir del portal.',
  },
  'mon.services': { en: 'Services', es: 'Servicios' },
  'mon.applications': { en: 'Applications', es: 'Aplicaciones' },
  'mon.scope': { en: 'What to monitor', es: 'Qué monitorizar' },
  'mon.search': { en: 'Search', es: 'Buscar' },
  'mon.count': { en: '{n} of {total}', es: '{n} de {total}' },
  'mon.dashboards': { en: '{n} dashboards', es: '{n} dashboards' },
  'mon.dashboard': { en: '1 dashboard', es: '1 dashboard' },
  'mon.noDashboards': { en: 'no dashboards', es: 'sin dashboards' },
  'mon.noMatch': { en: 'Nothing matches “{q}”.', es: 'Nada coincide con «{q}».' },
  'mon.locked': { en: '{n} you can’t see', es: '{n} que no puedes ver' },
  'mon.lockedHint': {
    en: 'Their dashboards are for the members of grafana-<name>-viewers and -editors. Ask for access in Incidents.',
    es: 'Sus dashboards son para los miembros de grafana-<nombre>-viewers y -editors. Pide acceso en Incidents.',
  },
  'mon.requestAccess': { en: 'Request access', es: 'Pedir acceso' },
  'mon.performance': { en: 'Performance', es: 'Rendimiento' },
  'mon.logging': { en: 'Logging', es: 'Logging' },
  'mon.view': { en: 'View', es: 'Vista' },
  'mon.dashboardPick': { en: 'Dashboard', es: 'Dashboard' },
  'mon.environment': { en: 'Environment', es: 'Entorno' },
  'mon.folder': { en: 'Grafana folder', es: 'Carpeta de Grafana' },
  'mon.namespace': { en: 'namespace', es: 'namespace' },
  'mon.openEntity': { en: 'Open its page', es: 'Abrir su página' },
  'mon.pick': { en: 'Pick a service or an application on the left.', es: 'Elige un servicio o una aplicación a la izquierda.' },
  'mon.noneVisible': { en: 'There is nothing you can see here yet', es: 'Todavía no hay nada que puedas ver aquí' },
  'mon.noneVisibleText': {
    en: 'You are in no Grafana group of a service or an application. Ask for access in Incidents.',
    es: 'No estás en ningún grupo de Grafana de un servicio o aplicación. Pide acceso en Incidents.',
  },
  'mon.noCatalog': { en: 'The catalog has no dashboards of the services yet', es: 'El catálogo aún no tiene los dashboards de los servicios' },
  'mon.noCatalogText': {
    en: 'The Domain of the stack has no annotation refresquito.io/grafana-services: the app-of-apps of refresquito-services writes it.',
    es: 'El Domain del stack no tiene la anotación refresquito.io/grafana-services: la escribe el app-of-apps de refresquito-services.',
  },
  'mon.emptyAll': { en: '{name} has no dashboards yet', es: '{name} aún no tiene dashboards' },
  'mon.emptyAllText': {
    en: 'Its Grafana folder {folder} exists but is empty. Dashboards are files of the chart: add one and it shows here after the next sync.',
    es: 'Su carpeta de Grafana {folder} existe pero está vacía. Los dashboards son ficheros del chart: añade uno y aparecerá aquí tras la siguiente sincronización.',
  },
  'mon.emptyLogs': { en: 'No logging dashboard', es: 'Sin dashboard de logs' },
  'mon.emptyLogsText': {
    en: 'Its logs are in Loki anyway: open them in Grafana Explore with the namespace of the service.',
    es: 'Sus logs están en Loki de todas formas: ábrelos en Grafana Explore con el namespace del servicio.',
  },
  'mon.emptyPerf': { en: 'No performance dashboard', es: 'Sin dashboard de rendimiento' },
  'mon.emptyPerfText': {
    en: 'Its metrics are in Prometheus anyway: open them in Grafana Explore with the namespace of the service.',
    es: 'Sus métricas están en Prometheus de todas formas: ábrelas en Grafana Explore con el namespace del servicio.',
  },
  'mon.explore': { en: 'Open in Explore', es: 'Abrir en Explore' },
  'mon.hint': {
    en: 'Grafana decides what the frame shows with your own session. If it asks you to sign in, use Open in Grafana once.',
    es: 'Grafana decide lo que muestra el marco con tu propia sesión. Si te pide entrar, usa Abrir en Grafana una vez.',
  },
};
