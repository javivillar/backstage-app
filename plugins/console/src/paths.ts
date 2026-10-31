/** The routes of the console draw their own frame (top bar and layer menu) instead of the classic sidebar. */
export const isConsolePath = (pathname: string) => pathname === '/console' || pathname.startsWith('/console/');
