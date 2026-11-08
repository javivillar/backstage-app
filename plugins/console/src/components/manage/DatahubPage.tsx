import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import type { DeclaredObject } from '../../manage';
import { Badge } from '../Badge';
import { TONES } from '../Flow';
import type { Row } from '../ManagePages';
import type { Field } from './manageFormModel';
import { type Kind, ManageTabs } from './ManageObjectsView';

/**
 * Manage › Data management (DataHub) in the console: data products and domains, created, changed and removed by pull
 * request (backend manageHandlersDatahub.ts). The data product of an application is its block datahub; the platform
 * has its own domains and data products. Datasets and pipelines come from the ingestion: only to look.
 */

type Declared = { kind: 'application'; name: string } | { kind: 'platform' } | undefined;
const names = (v: unknown) => (Array.isArray(v) ? v.map(x => String((x as { name?: string })?.name ?? '')).filter(Boolean).join(', ') : '');
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const governed = (v: unknown): ReactNode => {
  const sc = v as { score?: number; governed?: boolean } | undefined;
  return sc && typeof sc.score === 'number' ? <Badge label={`${Math.round(sc.score)} %`} {...TONES[sc.governed ? 'ok' : 'warn']} /> : '—';
};
/** owners { users, groups } of git as the two list fields of the form */
const withOwners = (d: DeclaredObject) => {
  const o = (d.spec.owners ?? {}) as { users?: string[]; groups?: string[] };
  return { ...d.spec, ownerUsers: o.users ?? [], ownerGroups: o.groups ?? [], retentionDays: d.spec.retentionDays === undefined ? undefined : String(d.spec.retentionDays) };
};

export const DatahubPage = () => {
  const { lang } = useI18n();
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const asset = (label: string, type: string, extra: Partial<Kind>): Kind => ({
    label,
    service: 'datahub',
    object: type,
    what: label,
    live: { plugin: 'datahub-manager', path: `/search?type=${type}&count=50` },
    columns: [
      { key: 'name', label: tx('Name', 'Nombre') },
      { key: 'classification', label: tx('Classification', 'Clasificación'), render: r => String(r.classification ?? '—') },
      { key: 'owners', label: tx('Owners', 'Responsables'), render: r => names(r.owners) || '—' },
      { key: 'score', label: tx('Governed', 'Gobernado'), render: r => governed(r.score) },
    ],
    title: r => String(r.name),
    facts: (r: Row) => [
      [tx('Description', 'Descripción'), String(r.description || '—')],
      [tx('Domain', 'Dominio'), String((r.domain as { name?: string } | undefined)?.name ?? '—')],
      [tx('Owners', 'Responsables'), names(r.owners) || '—'],
      [tx('Classification', 'Clasificación'), String(r.classification ?? '—')],
      [tx('Retention', 'Retención'), r.retentionDays ? `${String(r.retentionDays)} ${tx('days', 'días')}` : '—'],
      [tx('Governed', 'Gobernado'), governed(r.score)],
    ],
    open: r => str(r.url),
    ...extra,
  });
  const meta: Field[] = [
    { key: 'description', label: tx('Description', 'Descripción'), kind: 'text' },
    { key: 'classification', label: tx('Classification', 'Clasificación'), kind: 'text', help: tx('on the scale of this zone, at most the ceiling of this cluster', 'en la escala de esta zona, como mucho el techo de este cluster') },
    { key: 'retentionDays', label: tx('Retention (days)', 'Retención (días)'), kind: 'text', pattern: { re: /^[1-9][0-9]{0,5}$/, message: tx('a number of days', 'un número de días') } },
    { key: 'domain', label: tx('Domain', 'Dominio'), kind: 'text', help: tx('empty: the domain of the program', 'vacío: el dominio del programa') },
    { key: 'ownerUsers', label: tx('Owners (people)', 'Responsables (personas)'), kind: 'list' },
    { key: 'ownerGroups', label: tx('Owners (groups)', 'Responsables (grupos)'), kind: 'list' },
  ];
  const slug: Field = { key: 'name', label: tx('Id (part of its urn)', 'Id (parte de su urn)'), kind: 'text', required: true, createOnly: true, pattern: { re: /^[a-z0-9][a-z0-9._-]{0,62}$/, message: tx('lowercase letters, digits and ._-', 'minúsculas, dígitos y ._-') } };
  const title: Field = { key: 'title', label: tx('Name shown', 'Nombre visible'), kind: 'text', required: true };

  const products = asset(tx('Data products', 'Productos de datos'), 'dataProduct', {
    what: tx('data product', 'producto de datos'),
    key: r => {
      const d = r.declared as Declared;
      if (d?.kind === 'application') return { owner: { kind: 'application', name: d.name }, id: d.name };
      if (d?.kind === 'platform') return { owner: { kind: 'platform' }, id: String(r.urn ?? '').replace(/^urn:li:dataProduct:/, '') };
      return undefined;
    },
    rowOf: d => ({ name: String(d.spec.title ?? d.id), description: d.spec.description, classification: d.spec.classification }),
    idFromOwner: true,
    appFields: meta,
    platformFields: [slug, title, ...meta],
    values: withOwners,
    note: tx('The data product of an application gathers its database and tables (made by the platform in pro). Its description, classification, retention and owners are changed here.',
      'El producto de datos de una aplicación reúne su base de datos y sus tablas (lo crea la plataforma en pro). Aquí se cambian su descripción, clasificación, retención y responsables.'),
  });
  const domains: Kind = {
    label: tx('Domains', 'Dominios'),
    service: 'datahub',
    object: 'domain',
    what: tx('domain', 'dominio'),
    columns: [
      { key: 'name', label: 'Id', render: r => <code>{String(r.name)}</code> },
      { key: 'title', label: tx('Name', 'Nombre'), render: r => String(r.title ?? '—') },
      { key: 'parent', label: tx('Inside', 'Dentro de'), render: r => String(r.parent ?? tx('the program', 'el programa')) },
    ],
    rowOf: d => ({ name: d.id, title: d.spec.title, parent: d.spec.parent, description: d.spec.description }),
    title: r => String(r.title ?? r.name),
    platformFields: [slug, title, { key: 'description', label: tx('Description', 'Descripción'), kind: 'text' },
      { key: 'parent', label: tx('Inside the domain', 'Dentro del dominio'), kind: 'text', help: tx('empty: the domain of the program', 'vacío: el dominio del programa') },
      { key: 'ownerUsers', label: tx('Owners (people)', 'Responsables (personas)'), kind: 'list' },
      { key: 'ownerGroups', label: tx('Owners (groups)', 'Responsables (grupos)'), kind: 'list' }],
    values: withOwners,
    note: tx('Domains of the platform declared in git. The root domain of the program is made by DataHub itself.', 'Dominios de la plataforma declarados en git. El dominio raíz del programa lo crea el propio DataHub.'),
  };
  const ingest = tx('They come from the ingestion of each service: only to look.', 'Vienen de la ingesta de cada servicio: solo para consultar.');
  const datasets = asset(tx('Datasets', 'Conjuntos de datos'), 'dataset', { readOnly: true, noCreate: true, note: ingest });
  const flows = asset(tx('Pipelines', 'Flujos'), 'dataFlow', { readOnly: true, noCreate: true, note: ingest });
  return <ManageTabs kinds={[products, domains, datasets, flows]} label="Data management" />;
};
