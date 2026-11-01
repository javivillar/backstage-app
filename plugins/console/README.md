# Console plugin

A cloud-provider style console for the Refresquito portal, at `/console`. It **coexists** with the classic pages of
Backstage: it adds routes and never changes the existing ones. Both read the same backends (catalog, scaffolder,
Tech Insights, OpenCost…); the console stores nothing of its own.

## Layers

| Layer | Shown in | Content |
|---|---|---|
| Infrastructure | zone clusters (e.g. `nato`) | OpenNebula of the zone, marketplace of programme clusters (phase 4) |
| Cluster | every cluster | overview: nodes, Argo CD applications, storage (backend plugin `cluster`); topology, CIS nodes, images |
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

## Cluster overview

`/console/cluster` reads `GET /api/cluster/overview` (backend plugin `cluster`, in `packages/backend`). The backend asks
the Prometheus of the cluster (`costs.prometheusUrl`, the same one the costs use), so it needs no Kubernetes
permissions: nodes (kube-state-metrics + node-exporter), Argo CD applications (`argocd_app_info`) and volumes per
namespace (kube-state-metrics + kubelet). Backups are not published as metrics yet.

## Classic pages in the console

The app also passes the classic pages the console shows in its menus (create, APIs, dependencies, docs, quality,
costs; topology, CIS nodes and images in the cluster layer). Each one is the same element as the classic route, shown
at `/console/<id>` under the console header:

```tsx
const consolePages: ConsoleClassicPage[] = [
  { id: 'create', title: 'Create', layer: 'portal', classicPath: '/create', nested: true, element: scaffolderPage },
  { id: 'costs', title: 'Costs', layer: 'portal', classicPath: '/costs', element: costsPage },
];
<Route path="/console/*" element={<ConsolePage entityContent={entityPage} pages={consolePages} />} />
```

`nested: true` for pages with routes of their own (the scaffolder). Links between these pages stay in the console.

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
