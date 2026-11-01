# Console plugin

User guide: TechDocs of cnoe-oneke, page **Console (beta)** (`charts/cnoe-oneke/CONSOLE.md` of refresquito-services).

A cloud-provider style console for the Refresquito portal, at `/console`. It **coexists** with the classic pages of
Backstage: it adds routes and never changes the existing ones. Both read the same backends (catalog, scaffolder,
Tech Insights, OpenCost…); the console stores nothing of its own.

## Layers

| Layer | Shown in | Content |
|---|---|---|
| Infrastructure | every cluster (acts only from an admin programme) | Platform (zone catalog, segregations, capacity), Marketplace (OneKE profiles, new clusters), the zone: VMs, networks, security groups |
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

## 1.0: service page, zone, actions

- **Service page**: the console header (identity, vital signs that open their tab, Actions, Ask the ops assistant) and,
  for a component with `refresquito.io/namespace`, the console's own Overview (`ServiceOverview`) and the tabs Live,
  Network, User journey, Changes, Security, Costs (`ServiceViews.tsx`). Data read once per page (`ServiceData.tsx`):
  `/api/cluster` (live, workloads, network, overview), OpenCost (week by day), costs `/deployments` (changes), SBOM
  `/vulnerabilities` (findings per image). The classic tabs keep working, restyled (`ClassicFrame entity`).
- **Zone layer** (read-only): `/console/infrastructure` (+ vms, networks, security-groups) from `GET /api/cluster/zone`:
  `topology.json` that the OpenNebula host publishes every 5 min in the ConfigMap `refresquito-topology`.
- **Actions**: `POST /api/cluster/actions/{sync,restart}` through Argo CD (the credentials of the Argo CD plugin),
  only `console.actions.groups` (default backstage-admin); logged, shown in Changes.
- **Assistants** and **Manage** menus: the classic pages inside the console.

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

## 1.2: changing the infrastructure through git

Only `console.actions.groups` (backstage-admin). Every change goes to git with the GitHub token of the `integrations.github`
config (it needs **Contents** and **Pull requests** write); the backend checks it first (`clusterVms.ts`, `clusterInfra.ts`).

| Page | Route | Backend | Git |
|---|---|---|---|
| Zone › Virtual machines | `/console/infrastructure/vms` | `POST /api/cluster/zone/vms[/delete]` | PR in `console.vms.repo` (refresquito-services), `charts/console-vms-oneke/vms/*.json` → Argo CD + Crossplane |
| Infrastructure › Platform | `/console/infrastructure/platform` | `POST /api/cluster/infra/segregations` | PR in `console.infra.repo` (opennebula), `[[program]]` appended to `configuration/network.toml` |
| Infrastructure › Marketplace | `/console/infrastructure/marketplace` | `POST /api/cluster/infra/clusters` | PR adding `configuration/clusters/<zone>-<program>.json` |
| Cluster › Scale | `/console/cluster/scale` | `POST /api/cluster/infra/clusters/scale` | commit to `main` of the same file |

The PRs live on branches `console/<kind>-…` (`GitHubFiles.pullRequest`); `GET /zone/vms` and `GET /infra` list the open
ones. The OpenNebula host applies opennebula `main` with `configuration.py reconcile` and publishes its status, the
catalog, the profiles and the free memory in `topology.json` (`summariseZone`: `catalog`, `kubernetes`, `capacity`,
`reconcile`). Host side and a step-by-step test: opennebula `installation-standalone.md` 11.28.

## 1.3: removing, deleting, following a request, detail pages

| Page | Route | Backend | Git |
|---|---|---|---|
| Platform › a programme (networks, security groups, router, cluster, VMs) | `/console/infrastructure/platform/:zone/:program` | `POST /api/cluster/infra/segregations/delete` | PR removing its `[[program]]` (host: `destroy`) |
| Clusters of the platform › Delete | Marketplace | `POST /api/cluster/infra/clusters/delete` | PR with `"delete": true` (host: `cluster-destroy`) |
| Scale any cluster, masters only added | `/console/infrastructure/clusters/:zone/:program` | `POST /api/cluster/infra/clusters/scale` (`masters`) | commit to `main` |
| A VM (OpenNebula data, request, Crossplane) | `/console/infrastructure/vm/:name` | `GET /api/cluster/zone` + `/zone/vms` | — |
| CIS Kubernetes cluster (kube-bench) | `/console/cis-cluster` | `GET /api/sbom/kubebench` (wazuh-oneke >= 0.25.10) | — |

**Requests** (Platform, Marketplace, a programme): the open PRs and the ones merged in the last 7 days
(`GitHubFiles.mergedPulls`), each with its state from what the host reported (`lifecycle` in `zone.ts`: waiting for
review → merged, waiting for the host → applied/done or failed). The programme and the cluster of this console
(`console.cluster.zone/program`) are never removed or deleted from the console.

**Menus**: one icon per entry in `navIcons.ts` (by path); the managers have functional names (IAM, API management…) and
show the product on hover (`product` of each page in `App.tsx`); Portal › Home is called **Catalogue**.

## Configuration

```yaml
console:
  enabled: true                    # default false: nothing changes for anybody
  allowedGroups: [console-beta]    # Keycloak groups; empty = every signed-in user
  classicBaseUrl: ""               # the classic pages on another host (the preview instance)
  cluster: { id: nato-sirtap, kind: program, zone: nato, program: sirtap }
  clusters:
    - { id: nato, kind: zone, url: "https://backstage.platform.nato.iaas.refresquito.io" }
  actions: { groups: [backstage-admin] }   # who may act and change the infrastructure
  vms: { repo: javivillar/refresquito-services, branch: main, chart: charts/console-vms-oneke }    # defaults
  infra: { repo: javivillar/opennebula, branch: main, dir: configuration }                         # defaults
```

Business applications are the components with the annotation `refresquito.io/application` (the files `apps/*.yaml`
of the app-of-apps); every other component with the label `refresquito.io/segment` is a Refresquito service.
