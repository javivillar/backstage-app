import { useI18n } from '../../i18n';
import { Badge } from '../Badge';
import { TONES } from '../Flow';
import type { Row } from '../ManagePages';
import { type Kind, ManageTabs } from './ManageObjectsView';

/**
 * Manage › API management (Gravitee) in the console: the APIs of the gateway, created, changed and removed by pull
 * request (backend manageHandlersGravitee.ts). An application has one API at /gateway/<app>/ (its block gateway); the
 * platform may publish others under /gateway/.
 */

type Declared = { kind: 'application'; name: string } | { kind: 'platform' } | undefined;
const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));

export const GraviteePage = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const team = { key: 'team', label: tx('Team in Gravitee', 'Equipo en Gravitee'), kind: 'text' as const, help: tx('a gravitee-team-* group', 'un grupo gravitee-team-*'), pattern: { re: /^[a-z0-9][a-z0-9-]{1,62}$/, message: tx('a group name', 'un nombre de grupo') } };
  const apis: Kind = {
    label: 'APIs',
    service: 'gravitee',
    object: 'api',
    what: 'API',
    live: { plugin: 'gravitee-manager', path: '/apis' },
    columns: [
      { key: 'name', label: 'API', render: r => `${String(r.name)} ${String(r.version ?? '')}`.trim() },
      { key: 'contextPath', label: tx('Path', 'Ruta'), render: r => <code>{String(r.contextPath ?? '—')}</code> },
      { key: 'state', label: tx('State', 'Estado'), render: r => (r.state ? <Badge label={String(r.state)} {...TONES[r.state === 'STARTED' ? 'ok' : 'warn']} /> : '—') },
      { key: 'team', label: tx('Team', 'Equipo'), render: r => String(r.team ?? '—') },
    ],
    key: r => {
      const d = r.declared as Declared;
      if (d?.kind === 'application') return { owner: { kind: 'application', name: d.name }, id: d.name };
      if (d?.kind === 'platform') return { owner: { kind: 'platform' }, id: String(r.name) };
      return undefined;
    },
    rowOf: d => ({ name: d.id, contextPath: String(d.spec.path ?? `/gateway/${d.id}/`), team: d.spec.team }),
    title: r => String(r.name),
    facts: (r: Row) => [
      [tx('Description', 'Descripción'), String(r.description ?? '—')],
      [tx('Address', 'Dirección'), r.gatewayUrl ? <a href={String(r.gatewayUrl)} target="_blank" rel="noreferrer">{String(r.gatewayUrl)}</a> : '—'],
      [tx('Forwards to', 'Reenvía a'), <code>{String(r.backendUrl ?? '—')}</code>],
      [tx('Visibility', 'Visibilidad'), String(r.visibility ?? '—')],
      [tx('Team', 'Equipo'), String(r.team ?? '—')],
    ],
    open: (r, host) => (r.id ? `${host('gravitee')}/console/#!/DEFAULT/apis/${enc(r.id)}` : undefined),
    idFromOwner: true,
    appFields: [team],
    platformFields: [
      { key: 'name', label: tx('Name', 'Nombre'), kind: 'text', required: true, createOnly: true },
      { key: 'path', label: tx('Path', 'Ruta'), kind: 'text', required: true, help: '/gateway/<name>/', pattern: { re: /^\/gateway\/[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?\/?$/, message: '/gateway/<name>/' } },
      { key: 'target', label: tx('Forwards to (its backend)', 'Reenvía a (su backend)'), kind: 'text', required: true, pattern: { re: /^https?:\/\/\S+$/, message: tx('an http(s) URL', 'una URL http(s)') } },
      { key: 'description', label: tx('Description', 'Descripción'), kind: 'text' },
      { key: 'version', label: tx('Version', 'Versión'), kind: 'text' },
      { key: 'visibility', label: tx('Visibility in the portal', 'Visibilidad en el portal'), kind: 'select', options: [{ value: 'PRIVATE', label: tx('private', 'privada') }, { value: 'PUBLIC', label: tx('public', 'pública') }] },
      { key: 'plan', label: tx('Who may call it', 'Quién puede llamarla'), kind: 'select', options: [{ value: 'jwt', label: tx('a Keycloak token (plan JWT)', 'un token de Keycloak (plan JWT)') }, { value: 'keyless', label: tx('anyone (keyless)', 'cualquiera (sin clave)') }] },
      team,
    ],
    note: tx('The API of an application forwards /gateway/<application>/ to its own API: you publish it, set its team or retire it. The platform may publish others.',
      'La API de una aplicación reenvía /gateway/<aplicación>/ a su propia API: la publicas, fijas su equipo o la retiras. La plataforma puede publicar otras.'),
  };
  return <ManageTabs kinds={[apis]} label="API management" />;
};
