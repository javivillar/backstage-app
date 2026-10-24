import { useState, type CSSProperties } from 'react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import { createCardExtension, homePlugin } from '@backstage/plugin-home';

const getBasePath = () => {
  if (typeof window !== 'undefined') {
    const baseTag = document.querySelector('base');
    if (baseTag?.href) {
      try {
        const base = new URL(baseTag.href);
        return base.pathname.replace(/\/$/, '');
      } catch {
        // fallback
      }
    }
  }
  return '';
};

const basePath = getBasePath();

const getDomainUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return 'http://localhost:3000';
};

const domainUrl = getDomainUrl();

const quickLinksGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: 14,
  padding: '8px 20px 20px',
  maxHeight: 400,
  overflowY: 'auto',
};

const toolCardBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '20px 8px',
  borderRadius: 12,
  background: 'rgba(25, 118, 210, 0.04)',
  cursor: 'pointer',
  textDecoration: 'none',
  color: 'var(--backstage-color-text-primary, #333)',
  transition: 'all 0.2s ease',
  border: '1px solid transparent',
};

const toolCardLabelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  textAlign: 'center',
  lineHeight: 1.3,
};

/* ------------------------------------------------------------------ */
/*  ToolCard component                                                */
/* ------------------------------------------------------------------ */

interface ToolCardProps {
  url: string;
  label: string;
  iconSrc?: string;
  iconAlt?: string;
  isCatalog?: boolean;
}

const ToolCard = ({ url, label, iconSrc, iconAlt, isCatalog }: ToolCardProps) => {
  const [hovered, setHovered] = useState(false);

  const style: CSSProperties = {
    ...toolCardBase,
    ...(hovered
      ? {
          transform: 'translateY(-3px) scale(1.03)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
          background: 'rgba(25, 118, 210, 0.08)',
          borderColor: 'rgba(25, 118, 210, 0.15)',
        }
      : {}),
  };

  const iconElement = isCatalog ? (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      style={{ color: '#1976d2' }}
    >
      <path
        d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"
        fill="currentColor"
      />
    </svg>
  ) : (
    <img
      src={iconSrc}
      alt={iconAlt || label}
      style={{ width: 40, height: 40, objectFit: 'contain' }}
    />
  );

  const isExternal =
    url.startsWith('http://') || url.startsWith('https://');

  return (
    <a
      href={url}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {iconElement}
      <span style={toolCardLabelStyle}>{label}</span>
    </a>
  );
};

/* ------------------------------------------------------------------ */
/*  The widget: the links of homepage.quickLinks (config), or defaults */
/* ------------------------------------------------------------------ */

export const QuickLinksContent = () => {
  const config = useApi(configApiRef);

  const tools: ToolCardProps[] = (() => {
    try {
      const links = config.getOptionalConfigArray('homepage.quickLinks');
      if (links && links.length > 0) {
        return links.map(link => ({
          url: link.getString('url'),
          label: link.getString('label'),
          iconSrc: link.getOptionalString('iconUrl'),
          iconAlt: link.getOptionalString('label'),
          isCatalog: link.getOptionalString('icon') === 'catalog',
        }));
      }
    } catch (e) {
      // fall through to defaults
    }

    const getGitLabUrl = () => {
      try {
        const gitlabIntegrations = config.getOptionalConfigArray('integrations.gitlab');
        if (gitlabIntegrations && gitlabIntegrations.length > 0) {
          const baseUrl = gitlabIntegrations[0].getOptionalString('baseUrl');
          if (baseUrl) return baseUrl;
        }
      } catch { /* fallback */ }
      return 'https://gitlab.com';
    };

    return [
      { url: '/catalog', label: 'Catalog', isCatalog: true },
      { url: getGitLabUrl(), label: 'GitLab', iconSrc: `${basePath}/img/gitlab.png`, iconAlt: 'GitLab' },
      { url: `${domainUrl}/argocd`, label: 'ArgoCD', iconSrc: `${basePath}/img/argocd.png`, iconAlt: 'ArgoCD' },
      { url: `${domainUrl}/argo-workflows`, label: 'Argo Workflows', iconSrc: `${basePath}/img/argo-workflows.png`, iconAlt: 'Argo Workflows' },
      { url: domainUrl, label: 'Kargo', iconSrc: `${basePath}/img/kargo.png`, iconAlt: 'Kargo' },
      { url: `${domainUrl}/keycloak`, label: 'Keycloak', iconSrc: `${basePath}/img/keycloak.png`, iconAlt: 'Keycloak' },
    ];
  })();

  return (
    <div style={quickLinksGridStyle}>
      {tools.map(tool => (
        <ToolCard key={tool.label} {...tool} />
      ))}
    </div>
  );
};

/** "Quick Links" as a widget of the editable home (CustomHomepageGrid). */
export const HomePageQuickLinks = homePlugin.provide(
  createCardExtension({
    name: 'HomePageQuickLinks',
    title: 'Quick Links',
    description: 'The tools of the platform: Argo CD, Keycloak, …',
    components: () => Promise.resolve({ Content: QuickLinksContent }),
  }),
);
