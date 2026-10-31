import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';
import { useConsoleConfig } from './config';

export type ConsoleAccess = { loading: boolean; enabled: boolean; allowed: boolean };

/** Pure rule, kept apart for the tests: no groups configured = every signed-in user. */
export function isAllowed(allowedGroups: string[], ownershipEntityRefs: string[]): boolean {
  if (allowedGroups.length === 0) return true;
  const refs = new Set(ownershipEntityRefs.map(r => r.toLowerCase()));
  return allowedGroups.some(g => refs.has(`group:default/${g.toLowerCase()}`));
}

/**
 * Whether this user sees the console. This only hides the pages: the console reads the same APIs as the classic
 * pages, with the permissions of the user, so it never grants anything the classic pages do not.
 */
export function useConsoleAccess(): ConsoleAccess {
  const identity = useApi(identityApiRef);
  const { enabled, allowedGroups } = useConsoleConfig();
  const groupsKey = allowedGroups.join(',');
  const [state, setState] = useState<ConsoleAccess>({ loading: enabled, enabled, allowed: false });
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, enabled: false, allowed: false });
      return undefined;
    }
    let alive = true;
    identity.getBackstageIdentity().then(
      id => alive && setState({ loading: false, enabled, allowed: isAllowed(groupsKey ? groupsKey.split(',') : [], id.ownershipEntityRefs) }),
      () => alive && setState({ loading: false, enabled, allowed: false }),
    );
    return () => {
      alive = false;
    };
  }, [identity, enabled, groupsKey]);
  return state;
}
