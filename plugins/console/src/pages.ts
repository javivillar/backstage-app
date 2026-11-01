import { createContext, type ReactNode, useContext } from 'react';
import { catalogPathForConsole, consolePathForCatalog } from './paths';

/** A classic page shown inside the console (the app passes the same element it mounts in the classic routes). */
export type ConsoleClassicPage = {
  /** console path segment: /console/<id> */
  id: string;
  title: string;
  /** the product behind it (the menu shows it on hover), e.g. Keycloak for IAM */
  product?: string;
  /** menu group of the console */
  layer: 'portal' | 'cluster' | 'assistants' | 'managers';
  /** where the classic portal mounts it, e.g. /create */
  classicPath: string;
  /** the page has sub-routes of its own (e.g. the scaffolder): /create/x → /console/create/x */
  nested?: boolean;
  /** a page only the console has: its classicPath is the nearest classic page, never mapped back to it */
  consoleOnly?: boolean;
  element: ReactNode;
};

export const ConsolePagesContext = createContext<ConsoleClassicPage[]>([]);
export const useConsolePages = () => useContext(ConsolePagesContext);

const strip = (p: string) => p.replace(/\/+$/, '') || '/';

/** A path of the classic portal → the same thing inside the console, or undefined when the console does not show it. */
export function consolePathForClassic(path: string, pages: ConsoleClassicPage[]): string | undefined {
  const entity = consolePathForCatalog(path);
  if (entity) return entity;
  const p = strip(path);
  for (const pg of pages.filter(x => !x.consoleOnly)) {
    if (p === pg.classicPath) return `/console/${pg.id}`;
    if (pg.nested && p.startsWith(`${pg.classicPath}/`)) return `/console/${pg.id}${p.slice(pg.classicPath.length)}`;
  }
  return undefined;
}

/** A path of the console → the classic page that shows the same thing. */
export function classicPathForConsole(path: string, pages: ConsoleClassicPage[]): string | undefined {
  const entity = catalogPathForConsole(path);
  if (entity) return entity;
  const p = strip(path);
  for (const pg of pages) {
    const base = `/console/${pg.id}`;
    if (p === base) return pg.classicPath;
    if (p.startsWith(`${base}/`)) return pg.nested ? pg.classicPath + p.slice(base.length) : pg.classicPath;
  }
  return undefined;
}
