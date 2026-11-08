import { useI18n } from '../../i18n';
import type { ManageOwner } from '../../manage';
import { Badge } from '../Badge';
import { TONES } from '../Flow';
import type { HostOf, Row } from '../ManagePages';
import type { Field } from './manageFormModel';
import { type Kind, ManageTabs } from './ManageObjectsView';

/**
 * Manage › IAM (Keycloak) in the console: groups, the roles of each application and SSO clients, created, changed and
 * removed by pull request (backend manageHandlersIam.ts). People are not created here: they come from SSO and
 * onboarding; the list of users is only to look.
 */

type Declared = { kind: 'application'; name: string; stage?: string } | { kind: 'platform' } | undefined;
const kc = (host: HostOf, what: string) => `${host('iam')}/admin/RefresquitoTime/console/#/RefresquitoTime/${what}`;
const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));
const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '');
const ownerOfDeclared = (d: Declared): ManageOwner | undefined =>
  d?.kind === 'platform' ? { kind: 'platform' } : d?.kind === 'application' ? { kind: 'application', name: d.name } : undefined;

export const IamPage = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const yesNo = [{ value: 'false', label: tx('no', 'no') }, { value: 'true', label: tx('one per role', 'uno por rol') },
    ...[2, 3, 4, 5].map(n => ({ value: String(n), label: tx(`${n} per role`, `${n} por rol`) }))];
  const groupName: Field = { key: 'name', label: tx('Name', 'Nombre'), kind: 'text', required: true, createOnly: true, pattern: { re: /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/, message: tx('letters, digits and ._- (no "/")', 'letras, dígitos y ._- (sin "/")') } };

  const groups: Kind = {
    label: tx('Groups', 'Grupos'),
    service: 'iam',
    object: 'group',
    what: tx('group', 'grupo'),
    live: { plugin: 'keycloak-manager', path: '/groups' },
    columns: [
      { key: 'path', label: tx('Group', 'Grupo'), render: r => String(r.path ?? r.name) },
      { key: 'grants', label: tx('What it gives', 'Qué da'), render: r => String(r.grants ?? r.description ?? '—') },
    ],
    key: r => {
      const o = ownerOfDeclared(r.declared as Declared);
      return o ? { owner: o, id: String(r.name) } : undefined;
    },
    rowOf: d => ({ name: d.id, path: `/${d.id}`, grants: d.spec.role ? tx(`role ${String(d.spec.role)}`, `rol ${String(d.spec.role)}`) : d.spec.description }),
    title: r => String(r.path ?? r.name),
    open: (r, host) => (r.id ? kc(host, `groups/${enc(r.id)}`) : undefined),
    appFields: [groupName, { key: 'role', label: tx('Role of the application it gets', 'Rol de la aplicación que recibe'), kind: 'text', required: true, help: tx('one of the roles of the tab Roles; its members get it', 'uno de los roles de la pestaña Roles; sus miembros lo reciben') }],
    platformFields: [
      groupName,
      { key: 'description', label: tx('Description', 'Descripción'), kind: 'text' },
      { key: 'kind', label: tx('Kind', 'Tipo'), kind: 'select', options: ['team', 'access', 'role', 'data'].map(v => ({ value: v, label: v })) },
      { key: 'parent', label: tx('Inside the group', 'Dentro del grupo'), kind: 'text', help: tx('empty: a top-level group', 'vacío: un grupo de primer nivel') },
      { key: 'realmRoles', label: tx('Realm roles its members get', 'Roles del realm que reciben sus miembros'), kind: 'list' },
    ],
    note: tx('A group of an application is one its roles are given to; removing it takes the role away (and the platform deletes the group when nothing is left in it). Members are added in Keycloak or by onboarding, not here.',
      'Un grupo de una aplicación es uno al que se dan sus roles; quitarlo le retira el rol (y la plataforma borra el grupo cuando no le queda nada). Los miembros se añaden en Keycloak o en el onboarding, no aquí.'),
  };

  const roles: Kind = {
    label: tx('Roles of applications', 'Roles de aplicaciones'),
    service: 'iam',
    object: 'role',
    what: tx('role', 'rol'),
    columns: [
      { key: 'name', label: tx('Role', 'Rol') },
      { key: 'description', label: tx('What it may do', 'Qué puede hacer'), render: r => String(r.description ?? '—') },
    ],
    rowOf: d => ({ name: d.id, description: d.spec.description }),
    title: r => String(r.name),
    appFields: [
      { key: 'name', label: tx('Name', 'Nombre'), kind: 'text', required: true, createOnly: true, help: tx('the role is <application>-<name>', 'el rol es <aplicación>-<nombre>'), pattern: { re: /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, message: tx('lowercase letters, digits and "-"', 'minúsculas, dígitos y "-"') } },
      { key: 'description', label: tx('What someone with it may do', 'Qué puede hacer quien lo tenga'), kind: 'text', required: true },
    ],
  };

  const clients: Kind = {
    label: tx('SSO clients', 'Clientes SSO'),
    service: 'iam',
    object: 'client',
    what: tx('client', 'cliente'),
    live: { plugin: 'keycloak-manager', path: '/clients' },
    columns: [
      { key: 'clientId', label: tx('Client', 'Cliente'), render: r => <code>{String(r.clientId)}</code> },
      { key: 'type', label: tx('Type', 'Tipo'), render: r => (r.serviceAccount ? tx('service account', 'cuenta de servicio') : r.publicClient ? tx('public (PKCE)', 'público (PKCE)') : tx('confidential', 'confidencial')) },
      { key: 'stage', label: tx('Stage', 'Etapa'), render: r => ((r.declared as Declared)?.kind === 'application' ? String((r.declared as { stage?: string }).stage ?? 'pro') : '—') },
    ],
    key: r => {
      const d = r.declared as Declared;
      if (d?.kind === 'application') return { owner: { kind: 'application', name: d.name }, id: d.name };
      if (d?.kind === 'platform') return { owner: { kind: 'platform' }, id: String(r.clientId) };
      return undefined;
    },
    rowOf: d => ({ clientId: d.owner.kind === 'application' ? d.id : d.id, description: d.spec.description, publicClient: d.spec.type === 'public', serviceAccount: d.spec.type === 'service-account' }),
    title: r => String(r.clientId),
    facts: (r: Row) => [
      [tx('Client', 'Cliente'), <code>{String(r.clientId)}</code>],
      [tx('Description', 'Descripción'), String(r.description ?? '—')],
      [tx('Redirects', 'Redirecciones'), list(r.redirectUris) || '—'],
      [tx('Secret', 'Secreto'), r.publicClient ? tx('none (public)', 'ninguno (público)') : <Badge label={tx('in a Kubernetes Secret, never in git', 'en un Secret de Kubernetes, nunca en git')} {...TONES.ok} />],
    ],
    open: (r, host) => (r.id ? kc(host, `clients/${enc(r.id)}/settings`) : undefined),
    noCreateApp: true,
    appFields: [
      { key: 'extraRedirectUris', label: tx('Extra redirect URLs', 'URLs de redirección extra'), kind: 'list', help: tx('besides its own address, e.g. http://localhost:4200/*', 'además de su propia dirección, p. ej. http://localhost:4200/*') },
      { key: 'testUsers', label: tx('Test users', 'Usuarios de prueba'), kind: 'select', options: yesNo },
      { key: 'fromBackstage', label: tx('Its API is called from pages of Backstage', 'Su API se llama desde páginas de Backstage'), kind: 'boolean' },
    ],
    values: d => ({ ...d.spec, testUsers: String(d.spec.testUsers ?? false) }),
    platformFields: [
      { key: 'name', label: 'Client ID', kind: 'text', required: true, createOnly: true, pattern: { re: /^[a-z0-9][a-z0-9._-]{1,62}$/, message: tx('lowercase letters, digits and ._-', 'minúsculas, dígitos y ._-') } },
      { key: 'title', label: tx('Name shown', 'Nombre visible'), kind: 'text' },
      { key: 'description', label: tx('Description', 'Descripción'), kind: 'text' },
      { key: 'type', label: tx('Type', 'Tipo'), kind: 'select', required: true, options: [
        { value: 'confidential', label: tx('confidential (a server)', 'confidencial (un servidor)') },
        { value: 'public', label: tx('public (a browser, PKCE)', 'público (un navegador, PKCE)') },
        { value: 'service-account', label: tx('service account (machine to machine)', 'cuenta de servicio (máquina a máquina)') },
      ] },
      { key: 'redirectUris', label: tx('Redirect URLs', 'URLs de redirección'), kind: 'list' },
      { key: 'webOrigins', label: tx('Web origins', 'Orígenes web'), kind: 'list' },
      { key: 'roles', label: tx('Its roles', 'Sus roles'), kind: 'list' },
      { key: 'secretName', label: tx('Secret for its credentials', 'Secret para sus credenciales'), kind: 'text', help: tx('a Kubernetes Secret of iam-oneke the platform writes the client secret to (never git)', 'un Secret de Kubernetes de iam-oneke donde la plataforma escribe el secreto del cliente (nunca en git)') },
    ],
    note: tx('Every application has its own client per stage, made from its file: here you change its settings. A client of the platform (not of any application) is created here.',
      'Cada aplicación tiene su propio cliente por etapa, hecho desde su fichero: aquí cambias sus ajustes. Un cliente de la plataforma (de ninguna aplicación) se crea aquí.'),
  };

  const users: Kind = {
    label: tx('Users', 'Usuarios'),
    service: 'iam',
    object: 'user',
    what: tx('user', 'usuario'),
    readOnly: true,
    noCreate: true,
    live: { plugin: 'keycloak-manager', path: '/users' },
    columns: [
      { key: 'username', label: tx('User', 'Usuario') },
      { key: 'displayName', label: tx('Name', 'Nombre') },
      { key: 'email', label: 'Email' },
    ],
    title: r => String(r.username),
    open: (r, host) => (r.id ? kc(host, `users/${enc(r.id)}/settings`) : undefined),
    note: tx('People are not created in Manage: they come from single sign-on and onboarding. This list is only to look.',
      'Las personas no se crean en Manage: vienen del inicio de sesión único y del onboarding. Esta lista es solo para consultar.'),
  };

  return <ManageTabs kinds={[groups, roles, clients, users]} label="IAM" />;
};
