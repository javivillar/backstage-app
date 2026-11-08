import type { Messages } from '../i18n';

/** Texts of the shared pieces of Manage through git (components/manage): key → English and Spanish. */
export const MANAGE: Messages = {
  'mng.owner': { en: 'Belongs to', es: 'Pertenece a' },
  'mng.ownerHint': {
    en: 'Every object belongs to a business application (or to the platform): its file in git declares it, and DataHub links it to the application.',
    es: 'Cada objeto pertenece a una aplicación de negocio (o a la plataforma): lo declara su fichero en git y DataHub lo enlaza con la aplicación.',
  },
  'mng.ownerTeam': { en: 'team {team}', es: 'equipo {team}' },
  'mng.readOnly': { en: 'you can only see it', es: 'solo puedes verla' },
  'mng.noOwner': { en: 'You are in no team of an application yet: you can see, not change.', es: 'Aún no estás en el equipo de ninguna aplicación: puedes ver, no cambiar.' },
  'mng.reason': { en: 'Why (goes into the pull request)', es: 'Por qué (va en la pull request)' },
  'mng.preview': { en: 'Preview the change', es: 'Ver el cambio' },
  'mng.open': { en: 'Open the pull request', es: 'Abrir la pull request' },
  'mng.cancel': { en: 'Cancel', es: 'Cancelar' },
  'mng.diffTitle': { en: 'What changes in {file}', es: 'Qué cambia en {file}' },
  'mng.opened': {
    en: 'Pull request #{n} opened: {summary}. Once the team of the application approves and merges it, the platform applies it.',
    es: 'Pull request #{n} abierta: {summary}. Cuando el equipo de la aplicación la apruebe y la fusione, la plataforma la aplica.',
  },
  'mng.pending': { en: 'pending change #{n}', es: 'cambio pendiente #{n}' },
  'mng.required': { en: 'required', es: 'obligatorio' },
  'mng.listHint': { en: 'separated by commas', es: 'separados por comas' },
  'mng.delete': { en: 'Remove', es: 'Eliminar' },
  'mng.deleteTitle': { en: 'Remove {what} {id}?', es: '¿Eliminar {what} {id}?' },
  'mng.deleteText': {
    en: 'This opens a pull request that marks it for removal (state: absent). On merge the platform deletes it, with its content. Type its name to confirm.',
    es: 'Se abre una pull request que lo marca para eliminar (state: absent). Al fusionarla, la plataforma lo borra con su contenido. Escribe su nombre para confirmar.',
  },
  'mng.typeName': { en: 'Name to confirm', es: 'Nombre para confirmar' },
  'mng.create': { en: 'New {what}', es: 'Nuevo {what}' },
  'mng.edit': { en: 'Change {what} {id}', es: 'Cambiar {what} {id}' },
  'mng.viaPr': { en: 'Changes go through a pull request in refresquito-services.', es: 'Los cambios van por pull request en refresquito-services.' },
};
