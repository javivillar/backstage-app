/** The routes of the console draw their own frame (top bar and layer menu) instead of the classic sidebar. */
export const isConsolePath = (pathname: string) => pathname === '/console' || pathname.startsWith('/console/');

const CLASSIC_ENTITY = /^\/catalog\/([^/]+)\/([^/]+)\/([^/?#]+)(\/[^?#]*)?$/;
const CONSOLE_ENTITY = /^\/console\/entity\/([^/]+)\/([^/]+)\/([^/?#]+)(\/[^?#]*)?$/;

/** /catalog/<ns>/<kind>/<name>[/tab] → the same entity inside the console, or undefined for any other path. */
export function consolePathForCatalog(path: string): string | undefined {
  const m = CLASSIC_ENTITY.exec(path);
  return m ? `/console/entity/${m[1]}/${m[2]}/${m[3]}${m[4] ?? ''}` : undefined;
}

/** /console/entity/<ns>/<kind>/<name>[/tab] → the classic page of that entity, or undefined. */
export function catalogPathForConsole(path: string): string | undefined {
  const m = CONSOLE_ENTITY.exec(path);
  return m ? `/catalog/${m[1]}/${m[2]}/${m[3]}${m[4] ?? ''}` : undefined;
}
