# Costs

What each namespace of the cluster costs, shown in Backstage: the **Cost** card in the overview of every entity with
the annotation `refresquito.io/namespace`, and the page **Costs** (`/costs`, sidebar). The prices are ours, not a bill:
every figure is shown with them.

A namespace pays for two things:

| | Source | Price (app-config `opencost.pricing`) |
|---|---|---|
| **Resources**: CPU, memory and disk it reserves or uses | OpenCost (chart cnoe-oneke), read through the proxy `/opencost` | `cpuPerCoreHour`, `ramPerGiBHour`, `storagePerGiBHour` |
| **Deployments**: each new version of an image that runs in it | the backend plugin `costs` of this repo (below) | `perDeployment` |
| **Incidents**: each incident opened on one of its elements | the application support (`GET /api/costs/incidents`, below) | `perIncident.P1` … `P4` |

A **system** also pays for what the **assistants** of Backstage consumed answering questions about it (below):
`opencost.pricing.assistants`, per million tokens or per hour of a local model.

How OpenCost computes, how to set the real prices, how to install, upgrade and troubleshoot it on a cluster:
`charts/cnoe-oneke/OPENCOST.md` of refresquito-services. This file is about the code.

## Code

| File | What |
|---|---|
| `packages/app/src/components/cost/openCost.ts` | types, parsers and hooks: `useAllocations` (OpenCost, windows 7d and 24h), `useDeployments` (this month), `useIncidentCounts` (this month, from the support), `usePricing`, `deploymentsCost`, `incidentsCost`, `money` |
| `packages/app/src/components/cost/CostsPage.tsx` | page `/costs`: the cluster, by system (`spec.system` of the entity), by namespace |
| `packages/app/src/components/cost/EntityCostCard.tsx` | Cost card of an entity |
| `packages/backend/src/plugins/costs.ts` | backend plugin `costs`: the hourly sweep and `GET /api/costs/deployments` |
| `packages/backend/src/plugins/costDeployments.ts` | the logic of deployments: Prometheus query, parser, the store (tables), months |
| `packages/app/src/components/cost/assistantUsage.ts` | the assistants: `useAssistantUsage` (this month, plugin ops-assistant), `useSystemsIndex` (namespace/project → system), `systemsOf`, `usageCost`, `chargeBySystem`, `chargeByAssistant` |
| `packages/app/src/components/cost/EntityAssistantUsageCard.tsx` | card "Assistants this month" in the overview of a System |
| `plugins/ops-assistant-backend/src/usage.ts` | the record of each question (table `assistant_usage`) and `GET /api/ops-assistant/usage` |
| `packages/app/config.d.ts` | config schema: `opencost` (visible to the frontend), `costs.prometheusUrl` (backend only) |

## What the page and the card show

- **Last 7 days**: OpenCost, `window=7d`.
- **Per month**: the resources of the last 24 hours × 30.4, **plus** the deployments of the current month ×
  `perDeployment`, **plus** the incidents of the current month × the price of their priority. What has no price is
  left out.
- **Deployments this month**: how many, what they cost and (card) the last version; on the page, hovering the number
  of a namespace lists its versions. "not counted in this installation" when the plugin answers an error (no
  `costs.prometheusUrl`, no database): the rest of the page works the same.
- **Incidents this month**: how many were opened on the elements of the namespace, by priority, and what they cost;
  on the page the cluster figure also says how many are on elements without a namespace (the platform itself,
  `system:default/refresquito`): counted in the total, not in any namespace. "not available: …" when the support
  cannot be read (not deployed, no Keycloak session, the person has no role in it): the rest of the page works.
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

**What a version is.** The digest the node pulled (`image_id`, e.g. `ghcr.io/x/web@sha256:…`). A container that has
not started yet has no digest and is skipped until it runs (before 2026-10-31 it was kept by its tag, so each
deployment counted twice: see "Operating it" to clean those rows). So:

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

## Incidents (application support)

Each incident opened on an element of the catalog is charged to the namespace of that element, at the price of its
priority, **in the month it was opened** (UTC); what happens to it later (resolved, reopened, a new priority) does
not change the charge. User decisions of 2026-10-30.

- **Source**: the application support keeps the incidents; `GET /api/costs/incidents?month=YYYY-MM` (support 0.4.0
  or later) answers how many were opened on each element, by priority: `{month, elements: [{ref, priority, count}]}`.
  Only counts, no title or person, so any person with a role in the support reads it (the incidents themselves
  stay visible only to their requester and the support team). Only incidents, not changes.
- **Where the support is and how it is called**: as the tab Incidents (`components/catalog/EntitySupportContent.tsx`):
  the URL is the annotation `refresquito.io/url` of the deployment of the application `support` in the catalog (pro,
  then pre, then dev), and the call is made in the browser with the Keycloak token of the person
  (`keycloakOIDCAuthApiRef`; the support trusts the client `backstage`, python-app-oneke `sso.fromBackstage`).
- **Element → namespace**: the reference of the element is the reference of the entity in the catalog
  (`component:default/petstore-oneke`); its namespace is the annotation `refresquito.io/namespace` of that entity.
  On the card, the incidents of every entity of the catalog in the same namespace are added.
- Nothing is stored in Backstage: the support keeps the history, so any past month can be asked again.

## Assistants (plugin ops-assistant)

Every question answered by an assistant (ops, sec, functional, architect, developer chat) is charged to the
**system** it was about, in the month it was asked (UTC). User decisions of 2026-10-30.

- **Recorded by** the backend of the assistants (`plugins/ops-assistant-backend/src/usage.ts`, table
  `assistant_usage` in `backstage_plugin_ops-assistant`): one row per question answered with who asked it (the
  Backstage user, signed in with Keycloak), the assistant, runner and model, the tokens the model reported (input,
  output, cache read, cache write), the time it took, how many tools it called, and what it was about. Never the
  question or the answer. A question cancelled or failed is not recorded. Kept `assistantUsage.retentionDays` (400).
- **Which system**, in this order:
  1. the one chosen in the page of the assistant ("Charge its cost to"; preset from `?system=<name>`, or from the
     system of `?project=<name>`), kept with the conversation;
  2. else what its tools were asked about: the argument `system` (functional, architect, developer, sec), a
     `namespace` (ops, sec: its system through `refresquito.io/namespace` and `spec.system` of the catalog) or a
     `project` (sec: the `spec.system` of that Component). A question about several systems is split between them
     in equal parts;
  3. else the **platform** (shown as "(no system)").
- **Price**: the first entry of `opencost.pricing.assistants` whose `model` (part of the model name, `*` any) and
  `runner` (`api`, `claude-code`) match. Per million tokens for a model billed by use; `perHour` × the time it was
  answering for a **local model** (llama.cpp, Ollama, vLLM through the runner `api`, `provider: local`): there the
  tokens cost nothing and the server does. A model without a price is shown in tokens, not in money. With the runner
  `claude-code` (the operator's Claude subscription) the tokens are real, the money is notional (a flat fee): price
  it as you want to charge it, or at 0.
- **Local servers that do not report tokens**: the question is recorded with 0 tokens and counted as "without
  tokens reported"; `perHour` charges it all the same.
- **Who sees whom**: the totals by system and assistant are the same for everyone. Who asked is shown only for the
  person's own questions, and for everyone's to the members of `assistantUsage.viewAllGroups` (default
  `backstage-admin`).
- **Where**: page `/costs` (figure "Assistants this month", column "Assistants this month" and "Per month" of
  *By system*, card *Assistants this month* by assistant and person) and the card *Assistants this month* of each
  System. Not yet: the Developer Assistant's `develop` workflow (GitHub Actions) does not go through Backstage and
  is not recorded.

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
    perIncident:              # optional, by priority; a priority without a price costs 0
      P1: 50
      P2: 25
      P3: 10
      P4: 5
    assistants:               # optional, EXAMPLE prices: the first that matches; a model without a price is shown in tokens
      - model: claude-opus    # part of the model name
        inputPerMillion: 4.6
        outputPerMillion: 23
        cacheReadPerMillion: 0.46
        cacheWritePerMillion: 5.75
      - model: gpt-oss        # a local model: an hour of the server answering
        perHour: 0.4
costs:
  prometheusUrl: http://observability-oneke-prometheus.<prefix>observability-oneke.svc.cluster.local:9090
```

Without `costs.prometheusUrl` the plugin starts, logs `costs: no costs.prometheusUrl, deployments are not counted`
and answers 503.

## Tests

```bash
yarn --cwd packages/backend backstage-cli package test --watchAll=false src/plugins/costDeployments.test.ts
yarn --cwd packages/app backstage-cli package test --watchAll=false src/components/cost
yarn --cwd plugins/ops-assistant-backend backstage-cli package test --watchAll=false src/usage.test.ts
```

`usage.test.ts` also asks a question end to end to a fake local model (OpenAI-compatible, runner `api`, no Claude
Code) and a fake MCP server, and checks what is recorded.

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
- **Rows kept by tag** (before the fix of 2026-10-31, a deployment counted twice): `update cost_deployments set
  baseline = true where version not like '%@sha256:%';`
- **What the assistants consumed this month**:
  `kubectl -n $NS exec deploy/cnoe-oneke-backstage-postgres -- psql -U backstage -d backstage_plugin_ops-assistant -c
  "select assistant, user_ref, model, coalesce(system, systems) as about, count(*), sum(input+output+cache_read+cache_write) as tokens
  from assistant_usage where at >= date_trunc('month', now() at time zone 'utc') group by 1,2,3,4 order by 6 desc"`
- **Not charge one deployment** (a mistake): `update cost_deployments set baseline = true where namespace = '…' and
  image = '…';`
- A sweep that failed (Prometheus down) logs the error and the next one covers the gap: nothing is lost while the gap
  is under 14 days.
