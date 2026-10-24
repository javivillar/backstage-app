import { type CSSProperties } from 'react';
import { Content, Page } from '@backstage/core-components';
import { HomePageSearchBar } from '@backstage/plugin-search';
import { SearchContextProvider } from '@backstage/plugin-search-react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import {
  CustomHomepageGrid,
  HomePageRecentlyVisited,
  HomePageStarredEntities,
  HomePageTopVisited,
} from '@backstage/plugin-home';
import { HomePageQuickLinks } from './QuickLinks';

// what a user sees before editing their home: 12 columns, heights in rows of 60 px
const DEFAULT_LAYOUT = [
  { component: <HomePageStarredEntities />, x: 0, y: 0, width: 6, height: 7 },
  { component: <HomePageQuickLinks />, x: 6, y: 0, width: 6, height: 7 },
];
// 12 columns down to tablets (the default drops to 10 under 1200 px and the two widgets no longer fit side by side)
const GRID_COLS = { xl: 12, lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };


/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const waveSvg = `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='1368' height='400' fill='none'%3e%3cmask id='a' width='1368' height='401' x='0' y='0' maskUnits='userSpaceOnUse'%3e%3cpath fill='url(%23paint0_linear)' d='M437 116C223 116 112 0 112 0h1256v400c-82 0-225-21-282-109-112-175-436-175-649-175z'/%3e%3cpath fill='url(%23paint1_linear)' d='M1368 400V282C891-29 788 40 711 161 608 324 121 372 0 361v39h1368z'/%3e%3cpath fill='url(%23paint2_linear)' d='M1368 244v156H0V94c92-24 198-46 375 0l135 41c176 51 195 109 858 109z'/%3e%3cpath fill='url(%23paint3_linear)' d='M1252 400h116c-14-7-35-14-116-16-663-14-837-128-1013-258l-85-61C98 28 46 8 0 0v400h1252z'/%3e%3c/mask%3e%3cg mask='url(%23a)'%3e%3cpath fill='white' d='M-172-98h1671v601H-172z'/%3e%3c/g%3e%3cdefs%3e%3clinearGradient id='paint0_linear' x1='602' x2='1093.5' y1='-960.5' y2='272' gradientUnits='userSpaceOnUse'%3e%3cstop stop-color='white'/%3e%3cstop offset='1' stop-color='white' stop-opacity='0'/%3e%3c/linearGradient%3e%3clinearGradient id='paint1_linear' x1='482' x2='480' y1='1058.5' y2='70.5' gradientUnits='userSpaceOnUse'%3e%3cstop stop-color='white'/%3e%3cstop offset='1' stop-color='white' stop-opacity='0'/%3e%3c/linearGradient%3e%3clinearGradient id='paint2_linear' x1='424' x2='446.1' y1='-587.5' y2='274.6' gradientUnits='userSpaceOnUse'%3e%3cstop stop-color='white'/%3e%3cstop offset='1' stop-color='white' stop-opacity='0'/%3e%3c/linearGradient%3e%3clinearGradient id='paint3_linear' x1='587' x2='349' y1='-1120.5' y2='341' gradientUnits='userSpaceOnUse'%3e%3cstop stop-color='white'/%3e%3cstop offset='1' stop-color='white' stop-opacity='0'/%3e%3c/linearGradient%3e%3c/defs%3e%3c/svg%3e")`;

const heroStyle: CSSProperties = {
  width: 'calc(100% - 56px)',
  margin: '24px auto 0',
  padding: '40px 24px 32px',
  background: 'linear-gradient(135deg, #003D7A 0%, #00568C 50%, #1A8DFF 100%)',
  backgroundImage: `${waveSvg}, linear-gradient(135deg, #003D7A 0%, #00568C 50%, #1A8DFF 100%)`,
  backgroundSize: 'cover, cover',
  backgroundPosition: 'center',
  borderRadius: 16,
  textAlign: 'center',
  color: '#fff',
  boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1.5px 6px rgba(0,0,0,0.06)',
  overflow: 'hidden',
  minHeight: 135,
};

const heroTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '2.25rem',
  fontWeight: 700,
  letterSpacing: '-0.5px',
  lineHeight: 1.2,
};

const heroSubtitleStyle: CSSProperties = {
  margin: '12px 0 0',
  fontSize: '1.1rem',
  fontWeight: 400,
  opacity: 0.85,
};

const searchWrapperStyle: CSSProperties = {
  maxWidth: 700,
  width: '100%',
  margin: '-28px auto 0',
  padding: '0 24px',
  position: 'relative',
  zIndex: 1,
};

const gridWrapperStyle: CSSProperties = {
  width: '100%',
  maxWidth: 1200,
  margin: '36px auto 0',
  padding: '0 24px',
};

const searchCardStyle: CSSProperties = {
  background: 'var(--backstage-color-background-paper, #fff)',
  borderRadius: 16,
  boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1.5px 6px rgba(0,0,0,0.06)',
  padding: '10px 8px',
};

const searchBarInnerStyle: CSSProperties = {
  display: 'flex',
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  borderRadius: 12,
};

/* ------------------------------------------------------------------ */
/*  Homepage                                                          */
/* ------------------------------------------------------------------ */

export const Homepage = () => {
  const config = useApi(configApiRef);

  // Title and subtitle of the hero: from the configuration (homepage.title / homepage.subtitle),
  // so that each deployment can name itself (e.g. its zone and program) without a new image.
  const heroTitle =
    config.getOptionalString('homepage.title') ?? 'Internal Developer Platform';
  const heroSubtitle =
    config.getOptionalString('homepage.subtitle') ??
    'Discover, manage, and deploy your services';

  return (
    <SearchContextProvider>
      <Page themeId="home">
        <Content>
          {/* Hero */}
          <div className="cnoe-hero-header" style={heroStyle}>
            <h1 style={heroTitleStyle}>{heroTitle}</h1>
            <p style={heroSubtitleStyle}>{heroSubtitle}</p>
          </div>

          {/* Elevated search bar */}
          <div style={searchWrapperStyle}>
            <div className="cnoe-toolbar-card" style={searchCardStyle}>
              <HomePageSearchBar
                style={searchBarInnerStyle}
                placeholder="Search"
              />
            </div>
          </div>

          {/* The widgets: each user edits their own (Edit / Add widget / Save) and the layout is kept in the
              database of Backstage (user-settings backend), so it follows them to any browser.
              DEFAULT_LAYOUT is what a user sees before editing, and what "Restore defaults" brings back. */}
          <div style={gridWrapperStyle}>
            <CustomHomepageGrid config={DEFAULT_LAYOUT} cols={GRID_COLS}>
              <HomePageStarredEntities />
              <HomePageQuickLinks />
              <HomePageRecentlyVisited />
              <HomePageTopVisited />
            </CustomHomepageGrid>
          </div>
        </Content>
      </Page>
    </SearchContextProvider>
  );
};
