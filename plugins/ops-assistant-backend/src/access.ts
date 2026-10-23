/** Who may use the assistant: members of opsAssistant.allowedGroups (Keycloak groups synced to the catalog). */

/** "ops-admin" or "group:default/ops-admin" -> "group:default/ops-admin" */
export function groupRef(group: string): string {
  return group.includes(':') ? group.toLowerCase() : `group:default/${group.toLowerCase()}`;
}

/** Pure decision, unit-tested. DENY BY DEFAULT: no groups configured, nobody. */
export function mayUse(ownershipEntityRefs: string[], allowedGroups: string[]): boolean {
  const mine = new Set(ownershipEntityRefs.map(r => r.toLowerCase()));
  return allowedGroups.some(g => mine.has(groupRef(g)));
}
