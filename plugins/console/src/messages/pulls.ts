import type { Messages } from '../i18n';

/** Texts of the pending changes: the pull requests a page opened and where each one stands. */
export const PULLS: Messages = {
  'pc.title': { en: 'Changes asked for', es: 'Cambios solicitados' },
  'pc.sub.pending': { en: '{n} waiting to be accepted. A change applies once its pull request is merged.', es: '{n} pendientes de aceptar. Un cambio se aplica cuando se fusiona su pull request.' },
  'pc.sub.none': { en: 'Nothing is waiting. These are the changes of the last 14 days.', es: 'No hay nada pendiente. Estos son los cambios de los últimos 14 días.' },
  'pc.sub.empty': { en: 'No change asked for from here in the last 14 days.', es: 'No se ha solicitado ningún cambio desde aquí en los últimos 14 días.' },
  'pc.refresh': { en: 'Refresh', es: 'Actualizar' },
  'pc.refreshing': { en: 'Reading GitHub…', es: 'Leyendo GitHub…' },
  'pc.readAt': { en: 'State read at {time}', es: 'Estado leído a las {time}' },
  'pc.col.change': { en: 'Change', es: 'Cambio' },
  'pc.col.by': { en: 'Asked by', es: 'Solicitado por' },
  'pc.col.when': { en: 'Opened', es: 'Abierto' },
  'pc.col.state': { en: 'State', es: 'Estado' },
  'pc.col.link': { en: 'Pull request', es: 'Pull request' },
  'pc.state.checking': { en: 'Checks running', es: 'Comprobaciones en curso' },
  'pc.state.failed': { en: 'Checks failed', es: 'Comprobaciones fallidas' },
  'pc.state.conflict': { en: 'Conflicts: it cannot be merged', es: 'Conflictos: no se puede fusionar' },
  'pc.state.ready': { en: 'Ready to accept', es: 'Listo para aceptar' },
  'pc.state.open': { en: 'Open', es: 'Abierto' },
  'pc.state.merged': { en: 'Accepted', es: 'Aceptado' },
  'pc.state.closed': { en: 'Closed without accepting', es: 'Cerrado sin aceptar' },
  'pc.hint.checking': { en: 'Wait for the checks before accepting it.', es: 'Espera a las comprobaciones antes de aceptarlo.' },
  'pc.hint.failed': { en: 'Open it to see which check failed.', es: 'Ábrelo para ver qué comprobación falló.' },
  'pc.hint.conflict': { en: 'Another change touched the same file: close it and ask for the change again.', es: 'Otro cambio tocó el mismo fichero: ciérralo y vuelve a pedir el cambio.' },
  'pc.hint.open': { en: 'The state of its checks could not be read.', es: 'No se pudo leer el estado de sus comprobaciones.' },
  'pc.hint.merged': { en: 'Accepted on {date}.', es: 'Aceptado el {date}.' },
  'pc.link.accept': { en: 'Review and accept in GitHub', es: 'Revisar y aceptar en GitHub' },
  'pc.link.review': { en: 'Review in GitHub', es: 'Revisar en GitHub' },
  'pc.link.see': { en: 'See in GitHub', es: 'Ver en GitHub' },
  'price.pr.applies': {
    en: 'An accepted price is charged from the next deployment of the chart cnoe-oneke, not before.',
    es: 'Un precio aceptado se cobra desde el siguiente despliegue del chart cnoe-oneke, no antes.',
  },
  'dp.plans.applies': {
    en: 'An accepted plan applies when Argo CD syncs protection-oneke.',
    es: 'Un plan aceptado se aplica cuando Argo CD sincroniza protection-oneke.',
  },
  'org.pr.applies': {
    en: 'An accepted change shows here once the catalogue reads the repository again (a few minutes).',
    es: 'Un cambio aceptado se ve aquí cuando el catálogo vuelve a leer el repositorio (unos minutos).',
  },
};
