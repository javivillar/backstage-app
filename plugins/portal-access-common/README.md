# portal-access-common

Who may do what in the Refresquito portal, in one place. Pure TypeScript with no dependency, used by the backends and
by the console, so that no module keeps its own list of groups.

- `permissions.ts`: the table of permissions of the portal (roles, areas, who sees and who manages each area).
- `products.ts`: who administers each product (a Refresquito service or a business application) and the groups only
  the administrators of the portal change.

```ts
import { administersProduct, managesArea } from '@internal/backstage-plugin-portal-access-common';

const info = await userInfo.getUserInfo(credentials);
const isAdmin = administersProduct('superset-oneke', info.ownershipEntityRefs); // backstage-admin or superset-admin
const mayEdit = managesArea('business', info.ownershipEntityRefs);              // business-architect or backstage-admin
```

A role is one or more Keycloak groups: people get it in Portal › Manage › Access administration. The page Portal ›
Manage › Roles and permissions shows the table.
