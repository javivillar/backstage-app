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

## Operate

- **Needs attention** (Portal home and Cluster overview): nodes not ready or cordoned, memory requested over 90%,
  Argo CD applications not healthy or out of sync, volumes at 80% or more, the cluster certificate under 21 days,
  namespaces open to the whole cluster. Computed in the browser from `/overview` and `/network`; each item links to
  the page that shows it.
- **Cluster › Applications**: every Argo CD application, problems first, search and a "only with problems" filter;
  linked to its entity page when a component has the same name.
- **Cluster › Storage**: every volume (requested size, real capacity and use from the kubelet), the fullest first.
- **Namespace page** `/console/namespaces/<ns>` (linked from Applications, Storage, Network, the overview and Needs
  attention): segment, isolation, Argo CD state, the catalog entities that run there, the cost of the last 7 days
  (OpenCost through the proxy `/opencost`), pods, Warning events of the last hour, workloads with their images, job
  runs, hosts, volumes and policies.
- **Live** tab of a component with `refresquito.io/namespace` (console only): the same sections for its namespace.
  Pods: `GET /api/cluster/namespaces/:ns/live` (only pods that exist now; pods of Jobs apart); workloads and events:
  `GET /api/cluster/namespaces/:ns/workloads` (Kubernetes API; events need cnoe-oneke 0.2.76). Read every 30 s.
- **Pods restarting** (more than twice in the last hour) in Needs attention, from `/overview`.
- **Portal home**: a text filter, Argo CD health on each row, "Owned by your groups" (ownership of the signed-in
  user) and "Your favourites" (the same stars as the classic pages).
- **Find** in the top bar: type a name, jump to its page in the console.
- **What costs most** (last 7 days) in the cluster overview.

## Network

`/console/network` (Cluster menu) and the **User journey** and **Network** tabs of a component that says its namespace
(`refresquito.io/namespace`) read `GET /api/cluster/network`: namespaces and their segment, Ingress hosts,
NetworkPolicies, Calico GlobalNetworkPolicies (the segments), the default certificate of Traefik (TLSStore +
cert-manager Certificate: which hosts it covers and when it expires) and running pods. The backend reads them with the service
account of Backstage (read-only ClusterRole of cnoe-oneke 0.2.74); what it cannot read is listed as a warning.
They are drawn as flows (`components/Flow.tsx`): nodes coloured by state, dashed when blocked or outside the cluster
(the host, zone router and VNF are seen from the zone console). The two tabs exist only in the console:
App passes `consoleEntityPage` (entityPage plus those tabs); the classic portal keeps `entityPage`.

## Trying a branch before merging

`build-and-push.yaml` also runs by hand on any branch (`gh workflow run build-and-push.yaml --ref <branch>`) and tags
that image `preview-<sha>`. Put it on the preview instance only (`backstage.consolePreview.image.tag`), with the chart
that is already deployed; the Backstage in use only takes main images (`<sha>`), so a preview image never reaches it.

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
