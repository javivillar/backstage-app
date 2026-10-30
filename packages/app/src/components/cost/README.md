# Costs

What each namespace of the cluster costs, shown in Backstage: the **Cost** card in the overview of every entity with
the annotation `refresquito.io/namespace`, and the page **Costs** (`/costs`, sidebar). The prices are ours, not a bill:
every figure is shown with them.

A namespace pays for two things:

| | Source | Price (app-config `opencost.pricing`) |
|---|---|---|
| **Resources**: CPU, memory and disk it reserves or uses | OpenCost (chart cnoe-oneke), read through the proxy `/opencost` | `cpuPerCoreHour`, `ramPerGiBHour`, `storagePerGiBHour` |
| **Deployments**: each new version of an image that runs in it | the backend plugin `costs` of this repo (below) | `perDeployment` |

How OpenCost computes, how to set the real prices, how to install, upgrade and troubleshoot it on a cluster:
`charts/cnoe-oneke/OPENCOST.md` of refresquito-services. This file is about the code.

## Code

| File | What |
|---|---|
| `packages/app/src/components/cost/openCost.ts` | types, parsers and hooks: `useAllocations` (OpenCost, windows 7d and 24h), `useDeployments` (this month), `usePricing`, `deploymentsCost`, `money` |
| `packages/app/src/components/cost/CostsPage.tsx` | page `/costs`: the cluster, by system (`spec.system` of the entity), by namespace |
| `packages/app/src/components/cost/EntityCostCard.tsx` | Cost card of an entity |
| `packages/backend/src/plugins/costs.ts` | backend plugin `costs`: the hourly sweep and `GET /api/costs/deployments` |
| `packages/backend/src/plugins/costDeployments.ts` | the logic of deployments: Prometheus query, parser, the store (tables), months |
| `packages/app/config.d.ts` | config schema: `opencost` (visible to the frontend), `costs.prometheusUrl` (backend only) |

## What the page and the card show

- **Last 7 days**: OpenCost, `window=7d`.
- **Per month**: the resources of the last 24 hours × 30.4, **plus** the deployments of the current month ×
  `perDeployment`. Without a price per deployment, only the resources.
- **Deployments this month**: how many, what they cost and (card) the last version; on the page, hovering the number
  of a namespace lists its versions. "not counted in this installation" when the plugin answers an error (no
  `costs.prometheusUrl`, no database): the rest of the page works the same.
- CPU / memory **used of reserved**: average used ÷ average requested (what is reserved and not used is paid too).

## Deployments (backend plugin `costs`)

OpenCost prices resources, not events. A deployment is counted by Backstage from Kubernetes, not from CI/CD: what
counts is what really ran in the namespace (a pipeline run may fail, or not deploy, and it belongs to a repository,
not a namespace).

**The sweep.** Every hour (`scheduler`, task `costs-sweep-deployments`, first run 2 minutes after start; one replica
runs it at a time) the plugin asks Prometheus:

```promql
min by (namespace, image, image_spec, image_id) (min_over_time(timestamp(kube_pod_container_info)[<window>s:<step>]))
```

that is, the first time in the window each image ran in each namespace (`kube_pod_container_info` of
kube-state-metrics, one series per container; init containers are not in it). The window is 65 minutes, or the time
since the last sweep plus 5 minutes after a gap, at most 14 days (Prometheus keeps 15); step 1m, or 5m for windows
over 3 hours. Measured on nato/sirtap: 1 hour 0.4 s, 14 days 15 s (the fetch gives up at 60 s).

**What a version is.** The digest the node pulled (`image_id`, e.g. `ghcr.io/x/web@sha256:…`); while a container has
not started yet, the image with its tag (`image_spec`). So:

| Event | Deployment? |
|---|---|
| a new tag of the image | yes |
| the same tag pushed again with other content | yes (other digest) |
| restart, scale up/down, pod moved to another node | no (same digest) |
| back to a version the namespace already ran (rollback) | no, counted the first time only |
| an upgrade of a service of the platform (e.g. Wazuh) | yes, in its namespace: every namespace counts |
| a CronJob that runs the same image every time | once, the first time |

**The baseline.** The first sweep ever takes everything that already runs as the starting point: it is stored with
`baseline = true` and never charged. The API gives the time of that sweep (`trackedSince`) and the page says since
when deployments are counted.

**Storage.** The database of the plugin (`coreServices.database`: `backstage_plugin_costs` in the Postgres of
Backstage, so it is in its backups). Tables, created at start if missing (a change of shape needs a migration):

| Table | Columns |
|---|---|
| `cost_deployments` | `namespace`, `version` (primary key together), `image` (to show), `first_seen` (UTC), `baseline` |
| `cost_deployments_meta` | `key` (`first`: the first sweep, `last`: the last one), `at` |

**The API** (signed-in users, like the rest of Backstage):

```
GET /api/costs/deployments?month=YYYY-MM          (default: the current month; months in UTC)

{ "month": "2026-10", "trackedSince": "2026-10-30T06:20:58.096Z",
  "namespaces": { "<namespace>": { "count": 2, "versions": [ { "image": "ghcr.io/x/web:1.2.0", "firstSeen": "…" } ] } } }
```

`400` for a bad month, `503` when deployments are not counted (no `costs.prometheusUrl` or no database), `401`
without a session. Baseline rows are never returned.

## Configuration

Rendered by cnoe-oneke (`templates/backstage-config.yaml`, values `opencost`), 0.2.62 or later:

```yaml
opencost:
  currency: EUR
  pricing:
    description: "Example prices (not yet the cost base of the platform)"
    cpuPerCoreHour: 0.0205
    ramPerGiBHour: 0.0027
    storagePerGiBHour: 0.0001
    perDeployment: 0.5        # optional: without it deployments are counted and shown, not priced
costs:
  prometheusUrl: http://observability-oneke-prometheus.<prefix>observability-oneke.svc.cluster.local:9090
```

Without `costs.prometheusUrl` the plugin starts, logs `costs: no costs.prometheusUrl, deployments are not counted`
and answers 503.

## Tests

```bash
yarn --cwd packages/backend backstage-cli package test --watchAll=false src/plugins/costDeployments.test.ts
yarn --cwd packages/app backstage-cli package test --watchAll=false src/components/cost
```

The store test runs on SQLite (`TestDatabases`, `better-sqlite3` must be built: `yarn install` does it): baseline, new
and repeated versions, months in UTC, the window after a gap.

## Operating it

```bash
NS=<zone>-<program>-cnoe-oneke
# the sweeps: one line an hour
kubectl -n $NS logs deploy/cnoe-oneke-backstage -c backstage | grep '"plugin":"costs"'
#   costs: swept 150 images over 65 min, 0 new deployments
# what is stored
kubectl -n $NS exec deploy/cnoe-oneke-backstage-postgres -- psql -U backstage -d backstage_plugin_costs \
  -c "select baseline, count(*) from cost_deployments group by 1" -c "select * from cost_deployments_meta"
# the deployments of a namespace this month
kubectl -n $NS exec deploy/cnoe-oneke-backstage-postgres -- psql -U backstage -d backstage_plugin_costs \
  -c "select image, first_seen from cost_deployments where not baseline and namespace = '<namespace>'
      and first_seen >= date_trunc('month', now() at time zone 'utc') order by first_seen"
```

- **Start counting again from now** (e.g. after test deployments): delete both tables' rows; the next sweep is a new
  baseline.
  `delete from cost_deployments; delete from cost_deployments_meta;`
- **Not charge one deployment** (a mistake): `update cost_deployments set baseline = true where namespace = '…' and
  image = '…';`
- A sweep that failed (Prometheus down) logs the error and the next one covers the gap: nothing is lost while the gap
  is under 14 days.
