# Console plugin

A cloud-provider style console for the Refresquito portal, at `/console`. It **coexists** with the classic pages of
Backstage: it adds routes and never changes the existing ones. Both read the same backends (catalog, scaffolder,
Tech Insights, OpenCost…); the console stores nothing of its own.

## Layers

| Layer | Shown in | Content |
|---|---|---|
| Infrastructure | zone clusters (e.g. `nato`) | OpenNebula of the zone, marketplace of programme clusters (phase 4) |
| Cluster | every cluster | nodes, Refresquito services, scale, storage, backups (phase 3) |
| Portal | every cluster | software catalog: business applications and Refresquito services, and the page of each entity |

Switching to another cluster opens **that cluster's console** in a frame (`/console/clusters/<id>`): there is no
regional console of its own. The frame needs the other cluster to allow this one in `backend.csp.frame-ancestors`.

## Entity pages

`/console/entity/<namespace>/<kind>/<name>` shows the **same tabs and cards** as the classic entity page under the
console header. The app passes its entity page in, so a card added to the classic page appears in both:

```tsx
<Route path="/console/*" element={<ConsolePage entityContent={entityPage} />} />
```

Links to other entities (`/catalog/...`) inside those cards stay in the console; "Open in the classic portal" leaves it.

Labels in the console use its own `Badge`, not the MUI Chip: the classic portal's global CSS restyles every Chip.

## Configuration

```yaml
console:
  enabled: true                    # default false: nothing changes for anybody
  allowedGroups: [console-beta]    # Keycloak groups; empty = every signed-in user
  classicBaseUrl: ""               # the classic pages on another host (the preview instance)
  cluster: { id: nato-sirtap, kind: program, zone: nato, program: sirtap }
  clusters:
    - { id: nato, kind: zone, url: "https://backstage.platform.nato.iaas.refresquito.io" }
```

Business applications are the components with the annotation `refresquito.io/application` (the files `apps/*.yaml`
of the app-of-apps); every other component with the label `refresquito.io/segment` is a Refresquito service.
