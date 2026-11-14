import { type PropsWithChildren, createContext, useCallback, useContext, useMemo, useState } from 'react';
// the texts of the pages, one file per area so they can be translated apart
import { ZONE } from './messages/zone';
import { CLUSTER } from './messages/cluster';
import { PORTAL } from './messages/portal';
import { ENTITY } from './messages/entity';
import { CONTINUITY } from './messages/continuity';
import { MONITORING } from './messages/monitoring';
import { MANAGE } from './messages/manage';
import { BUSINESS_MAP } from './messages/businessMap';
import { BUSINESS_MAP_DASHBOARDS } from './messages/businessMapDashboards';
import { DEVELOPMENT } from './messages/development';
import { INTERCONNECTION } from './messages/interconnection';
import { PROGRAMMES } from './messages/programmes';
import { ACCESS_ADMIN } from './messages/accessAdmin';

/**
 * The languages of the console: English and Spanish. Texts live in MESSAGES by key; a page calls t('key', {n: 3}).
 * A key without a Spanish text shows the English one, so a page can be translated bit by bit. The choice is kept in
 * the browser (localStorage), and starts from the browser's language.
 */
export type Lang = 'en' | 'es';
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

export type Messages = Record<string, { en: string; es?: string }>;

const SHELL: Messages = {
  // shell
  'shell.switchConsole': { en: 'Switch console', es: 'Cambiar de consola' },
  'shell.platform': { en: 'Platform', es: 'Plataforma' },
  'shell.cluster': { en: 'Cluster', es: 'Clúster' },
  'shell.portal': { en: 'Portal', es: 'Portal' },
  'shell.platform.what': { en: 'Zones, segregations, clusters and VMs', es: 'Zonas, segregaciones, clústeres y VMs' },
  'shell.cluster.what': { en: '{cluster}: applications, network, nodes', es: '{cluster}: aplicaciones, red, nodos' },
  'shell.portal.what': { en: 'Applications and Refresquito services', es: 'Aplicaciones y servicios de Refresquito' },
  'shell.zone': { en: 'Zone', es: 'Zona' },
  'shell.thisCluster': { en: 'This cluster', es: 'Este clúster' },
  'shell.itsPortal': { en: 'its portal', es: 'su portal' },
  'shell.otherClusters': { en: 'Other clusters', es: 'Otros clústeres' },
  'shell.allClusters': { en: 'All clusters…', es: 'Todos los clústeres…' },
  'shell.classic': { en: 'Classic view', es: 'Vista clásica' },
  'shell.menu': { en: 'Menu', es: 'Menú' },
  'shell.sections': { en: 'Sections', es: 'Secciones' },
  'shell.scope': { en: 'Scope', es: 'Ámbito' },
  'shell.day': { en: 'Day mode', es: 'Modo día' },
  'shell.night': { en: 'Night mode', es: 'Modo noche' },
  'shell.language': { en: 'Language', es: 'Idioma' },
  'shell.find': { en: 'Find an application, service or API', es: 'Busca una aplicación, servicio o API' },
  'shell.findLabel': { en: 'Find in the catalog', es: 'Buscar en el catálogo' },
  'shell.reading': { en: 'Reading the catalog…', es: 'Leyendo el catálogo…' },
  'shell.nothing': { en: 'Nothing matches.', es: 'No hay coincidencias.' },
  'shell.business': { en: 'Business application', es: 'Aplicación de negocio' },
  'shell.service': { en: 'Refresquito service', es: 'Servicio de Refresquito' },
  'shell.businessService': { en: 'Business service', es: 'Servicio de negocio' },
  'shell.development': { en: 'Development service', es: 'Servicio de desarrollo' },
  // menu groups and entries
  'nav.platform': { en: 'Platform', es: 'Plataforma' },
  'nav.zonesSegregations': { en: 'Zones and segregations', es: 'Zonas y segregaciones' },
  'nav.k8sClusters': { en: 'Kubernetes clusters', es: 'Clústeres Kubernetes' },
  'nav.marketplace': { en: 'Marketplace', es: 'Marketplace' },
  'nav.interconnection': { en: 'Interconnection', es: 'Interconexión' },
  'nav.infrastructure': { en: 'Infrastructure', es: 'Infraestructura' },
  'nav.vms': { en: 'Virtual machines', es: 'Máquinas virtuales' },
  'nav.networks': { en: 'Networks', es: 'Redes' },
  'nav.securityGroups': { en: 'Security groups', es: 'Grupos de seguridad' },
  'nav.templates': { en: 'Templates', es: 'Plantillas' },
  'nav.zoneStorage': { en: 'Storage', es: 'Almacenamiento' },
  'nav.cluster': { en: 'Cluster {cluster}', es: 'Clúster {cluster}' },
  'nav.overview': { en: 'Overview', es: 'Resumen' },
  'nav.applications': { en: 'Applications', es: 'Aplicaciones' },
  'nav.network': { en: 'Network', es: 'Red' },
  'nav.scale': { en: 'Scale', es: 'Escalar' },
  'nav.storage': { en: 'Storage', es: 'Almacenamiento' },
  'nav.cisCluster': { en: 'CIS cluster', es: 'CIS del clúster' },
  'nav.yourClusters': { en: 'Your clusters', es: 'Tus clústeres' },
  'nav.allYouAdminister': { en: 'All you administer', es: 'Todos los que administras' },
  'nav.itsPortal': { en: 'Its portal', es: 'Su portal' },
  'nav.openPortal': { en: 'Open the portal', es: 'Abrir el portal' },
  'nav.portal': { en: 'Portal', es: 'Portal' },
  'nav.catalogue': { en: 'Catalogue', es: 'Catálogo' },
  'nav.catalogue.hint': { en: 'Business applications and Refresquito services', es: 'Aplicaciones de negocio y servicios de Refresquito' },
  'nav.development': { en: 'Development', es: 'Desarrollo' },
  'nav.newPython': { en: 'New Python application', es: 'Nueva aplicación Python' },
  'nav.newPython.hint': { en: 'Monolith: FastAPI + Angular (Python Framework)', es: 'Monolito: FastAPI + Angular (Python Framework)' },
  'nav.newSpring': { en: 'New Spring application', es: 'Nueva aplicación Spring' },
  'nav.newSpring.hint': { en: 'Microservices: Spring Boot (Spring Framework)', es: 'Microservicios: Spring Boot (Spring Framework)' },
  'nav.support': { en: 'Support', es: 'Soporte' },
  'nav.resolutionGroups': { en: 'Resolution groups', es: 'Grupos de resolución' },
  'nav.resolutionGroups.hint': { en: 'The teams that own and answer for each element', es: 'Los equipos que poseen y responden de cada elemento' },
  'nav.assistants': { en: 'Assistants', es: 'Asistentes' },
  'nav.manage': { en: 'Manage', es: 'Gestionar' },
  'nav.administration': { en: 'Administration', es: 'Administración' },
  'nav.allServices': { en: 'All services', es: 'Todos los servicios' },
  // titles of the classic pages shown in the menus (App.tsx pages[].id)
  'page.create': { en: 'Create', es: 'Crear' },
  'page.apis': { en: 'APIs', es: 'APIs' },
  'page.dependencies': { en: 'Dependencies', es: 'Dependencias' },
  'page.docs': { en: 'Docs', es: 'Documentación' },
  'page.quality': { en: 'Quality', es: 'Calidad' },
  'page.costs': { en: 'Costs', es: 'Costes' },
  'page.cis-nodes': { en: 'CIS Kubernetes nodes', es: 'CIS de los nodos' },
  'page.images': { en: 'Images', es: 'Imágenes' },
  'page.continuity': { en: 'Digital continuity', es: 'Continuidad digital' },
  'page.assistants': { en: 'The team', es: 'El equipo' },
  'page.ops-assistant': { en: 'Operations', es: 'Operaciones' },
  'page.sec-assistant': { en: 'Security', es: 'Seguridad' },
  'page.functional-assistant': { en: 'Functional', es: 'Funcional' },
  'page.architect-assistant': { en: 'Architect', es: 'Arquitecto' },
  'page.developer-assistant': { en: 'Developer', es: 'Desarrollador' },
  'page.keycloak': { en: 'IAM', es: 'IAM' },
  'page.gravitee': { en: 'API management', es: 'Gestión de APIs' },
  'page.datahub': { en: 'Data management', es: 'Gestión de datos' },
  'page.superset': { en: 'Business intelligence', es: 'Inteligencia de negocio' },
  'page.grafana': { en: 'Monitoring', es: 'Monitorización' },
  'page.camunda': { en: 'Business process', es: 'Procesos de negocio' },
  'page.seaweedfs': { en: 'S3 buckets', es: 'Buckets S3' },
  'page.alfresco': { en: 'Document management system', es: 'Gestión documental' },
  'page.activepieces': { en: 'Workflow integration', es: 'Integración de flujos' },
};

export const MESSAGES: Messages = { ...SHELL, ...ZONE, ...CLUSTER, ...PORTAL, ...ENTITY, ...CONTINUITY, ...MONITORING, ...MANAGE, ...BUSINESS_MAP, ...BUSINESS_MAP_DASHBOARDS, ...DEVELOPMENT, ...INTERCONNECTION, ...ACCESS_ADMIN, ...PROGRAMMES };

const KEY = 'rq-console-lang';

function firstLang(): Lang {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === 'en' || kept === 'es') return kept;
  } catch {
    /* no storage: use the browser's language */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** The text of a key in a language, with {name} filled from vars; the key itself when it is unknown. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>, messages: Messages = MESSAGES): string {
  const m = messages[key];
  let text = m ? (lang === 'es' && m.es) || m.en : key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string; has: (key: string) => boolean };

const Ctx = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v), has: k => k in MESSAGES });

export const I18nProvider = ({ children }: PropsWithChildren) => {
  const [lang, set] = useState<Lang>(firstLang);
  const setLang = useCallback((l: Lang) => {
    set(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* kept for this visit only */
    }
    document.documentElement.setAttribute('lang', l);
  }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v), has: k => k in MESSAGES }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** const { t, lang } = useI18n(); t('nav.catalogue') */
export const useI18n = () => useContext(Ctx);
