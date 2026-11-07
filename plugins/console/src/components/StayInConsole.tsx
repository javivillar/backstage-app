import { Progress } from '@backstage/core-components';
import { useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useConsoleAccess } from '../access';
import { useConsoleConfig } from '../config';
import { type ConsoleClassicPage, stayInConsole } from '../pages';

/**
 * Mounted once inside the app router: when a classic page shown in the console navigates to a classic path
 * (navigate('/create/templates/...') of the managers and the scaffolder), it goes to the same page inside the console.
 * Only a navigation from /console is moved: the classic portal, and "Open classic" (a full page load), stay as they are.
 */
export const StayInConsole = ({ pages }: { pages: ConsoleClassicPage[] }) => {
  const { enabled } = useConsoleConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const previous = useRef(location.pathname);
  useEffect(() => {
    const from = previous.current;
    previous.current = location.pathname;
    if (!enabled) return;
    const to = stayInConsole(from, location.pathname, pages);
    if (to) navigate(to + location.search + location.hash, { replace: true, state: location.state });
  }, [enabled, location, navigate, pages]);
  return null;
};

/** /: the console for whoever can open it, the classic home page for everyone else. */
export const ConsoleHomeRedirect = () => {
  const access = useConsoleAccess();
  if (access.loading) return <Progress />;
  return <Navigate to={access.enabled && access.allowed ? '/console' : '/home'} replace />;
};
