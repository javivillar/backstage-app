# Business continuity (business map)

The business map of **Business continuity** links the **business processes** of each customer to the **business services** that support them
and, down the chain, to the **platform and development services** of Refresquito. Each process says how much it can
afford to lose (RPO) and to be down (RTO); the map checks that what runs underneath delivers it, shows where the
business risk is, and rehearses what stops when a service fails.

Console: menu group **Business management › Business continuity** (`/console/business-map`), with the views Map ·
Heat map · Glass · Matrix, the page of each process, and the tab **Impact on the business** on services, applications
and framework lines. The same group has **Data continuity** (`/console/data-continuity`, still empty) and **Digital continuity**
(`/console/continuity`, the continuity profiles of each service).

## The model

```
business domain        Domain, spec.type business-area            e.g. occar-a400m/service-after-sales
 → business process     BusinessProcess (refresquito.io/v1alpha1)   e.g. Manage repair and maintenance
  → business service     System, spec.type business-service         e.g. petstore (its specification in refresquito-specs)
   → business application Component, spec.type business-application  the application's repository
    → instances           Component, spec.type application-instance  <app>[-<stage>]-oneke, one per environment
     ├→ platform blocks    Resource (sso-client, s3-bucket, dms-site, database…)
     │   → platform services   Component, spec.type platform-service      *-oneke (seaweedfs, iam, alfrescodms…)
     └→ framework line     Component, spec.type framework-line         python-framework-3-2…
         → development services Component, spec.type development-service python-framework, spring-framework
           → infrastructure
```

Platform services (run time) and development services (build time) are the two families of Refresquito services, at
the same level. Network segments are Systems of type `network-segment`, the stack is the Domain of type `stack`.

### Two axes, never merged

| Axis | On | Values | Means |
|---|---|---|---|
| **Support tier** | each Component | gold / silver / bronze | support hours, incident resolution times, availability |
| **Continuity criticality** | each BusinessProcess, inherited down | critical / important / standard | RPO, RTO, retention, HA |

The continuity requirement of a process flows down its chain; the map compares it with what each element delivers
(`refresquito.io/sla-rpo` / `sla-rto`, from its support tier) and reports **meets**, **gap** (RPO or RTO) or
**unknown** (an element that declares nothing). **Only production counts**: the pro instance of each business
service; dev and pre are shown but never checked. Framework lines are not part of the RPO/RTO check: their risk is
losing the ability to patch, shown by the *Framework support* lens and the impact tab of each line.

Criticality defaults (app-config `businessMap.criticality`, rendered by the cnoe-oneke chart from
`backstage.businessMap.criticality`); a process may override `rpo`, `rto` and `retention`:

| Criticality | RPO | RTO | HA |
|---|---|---|---|
| critical | 15m | 4h | yes |
| important | 4h | 24h | yes |
| standard | 24h | 72h | no |

## The kinds

```yaml
apiVersion: refresquito.io/v1alpha1
kind: BusinessProcess
metadata:
  name: manage-repair-and-maintenance
  namespace: occar-a400m                 # the customer
  title: Manage repair and maintenance
  annotations:
    apqc.org/pcf-id: "6.3.2"             # origin in an APQC model (optional)
    refresquito.io/model-id: "MNT.01.03" # origin in the customer's own model (optional)
    refresquito.io/process-key: maintenance-event   # its BPMN in Operaton (optional)
spec:
  owner: group:default/a400m-maintenance
  domain: service-after-sales            # a Domain of type business-area
  criticality: critical
  rpo: 15m                               # optional overrides: <n>m|h|d|y
  rto: 4h
  retention: 30y
  classification: occar-restricted
  dependsOn: [system:default/maintenance, system:default/documents]
---
apiVersion: refresquito.io/v1alpha1
kind: ReferenceModel
metadata: { name: apqc-aerospace-defense-7-4, title: "APQC PCF · Aerospace & Defense" }
spec: { source: apqc, industry: aerospace-defense, version: "7.4", namespace: apqc-aerospace-defense }
```

The catalog module `business-map` validates them and emits `ownedBy`/`ownerOf`, `partOf`/`hasPart` (Domain) and
`dependsOn`/`dependencyOf`. The files live in refresquito-services `catalog/business-map/<namespace>/`, one entity per
file (`domain-<name>.yaml`, `process-<name>.yaml`, `reference-model.yaml`), read through the Location `business-map`
of the app-of-apps catalog; the catalog rules allow these kinds only there. An example customer with made-up data:
`catalog/business-map/example-customer/`.

## Changing it: always by pull request

| What | Where in the console | Template | Writes |
|---|---|---|---|
| Import a business model | Business continuity › Import business model | `business-model-import` | `catalog/business-map/<ns>/` |
| Adopt a reference model | Business continuity › Adopt reference model | `business-model-adopt` | `catalog/business-map/<ns>/` |
| New / edit a process | Business continuity › New business process; a process › Edit | `business-process-new` / `-edit` | `process-<name>.yaml` |
| Save a what-if exercise | Matrix › Save as exercise | — (route) | refresquito-specs `continuity/exercises/<ns>/<date>-<slug>.yaml` |

### Importing a model

Three sources: **APQC PCF** (the Excel the customer downloaded), the **Refresquito template** (fixed columns: ID,
parent, title, owner, criticality, RPO, RTO, retention, applications) or the customer's **own spreadsheet** with a
column mapping (which column is ID, title, parent or level…) and a value mapping (e.g. `Alta → critical`), saved with
the model and reused on the next import. Excel (`.xlsx`) and CSV are read without extra libraries.

APQC levels 1/2/3 become Domain / subdomain / BusinessProcess (levels 4-5 are the detail of a process: BPMN). In an own
model, a row without parent is a Domain; under a Domain, a subdomain if it has children, else a process.

The form shows a **preview** before anything is written (`POST /api/business-map/import/preview`): counts (new,
changed, no longer in the file, unchanged), **errors** that stop the import (a parent not in the file, a duplicated
ID…) and **warnings** (an application not in the catalog, an owner that is no group). Rows with errors can be skipped.

**Reimport**: entities are matched by their original ID. What a person changed in the portal after the last import
(owner, applications, overrides) wins over the file, and the pull request lists it; an entity no longer in the file is
kept and marked `refresquito.io/deprecated`, never deleted. Each entity keeps per-field hashes of what was imported
(`refresquito.io/imported-hash`) to tell portal edits from imported values.

**Licence**: Refresquito never ships APQC content (not in the repositories, not as test data). The importer reads the
PCF files each customer has downloaded under APQC's terms.

### Adopting a reference model

A loaded reference model (APQC of an industry) is copied into a customer's namespace: pick the level-1 categories that
apply, the namespace and the owner group; the copies keep `apqc.org/pcf-id`, so a later version of the model can be
compared. An own model needs no adoption: it is imported straight into the customer's namespace (with optionally the
support categories of a loaded APQC model).

## The views

- **Map**: the domains of a customer with their subdomains and processes as cards (criticality, RPO/RTO, result of the
  check, owner); a filter for gaps only; the selected process with its applications and where each value comes from.
- **Process page**: the requirement (default of its criticality or override), its chain down to the platform services,
  the check of each element, how to close each gap, its BPMN in Operaton (`refresquito.io/process-key`), its data
  products.
- **Impact on the business** (tab of services, business services, applications and framework lines): the processes
  that depend on it, strictest first, with the check; on a framework line, the business services that still run it in
  each stage and their processes, to plan upgrades.
- **Heat map**: every process coloured by one lens at a time, a domain showing its worst process:

  | Lens | Source |
  |---|---|
  | Continuity | the check of the map |
  | Health now | Argo CD and the cluster (as Dependencies) |
  | Incidents (this month) | the support application, `GET /api/costs/incidents` |
  | Critical vulnerabilities | the SBOM of the images of its pro instances (`/api/sbom/vulnerabilities`) |
  | Cost / month | OpenCost of the namespaces of its pro instances (shared services not split yet) |
  | Readiness | owner, applications, BPMN key ("DR tested" comes with recorded exercises) |
  | Framework support | lifecycle and `refresquito.io/supported-until` of the line of its pro instances |

  A lens whose source fails shows "no data" and the rest of the page works.
- **Glass**: the Dependencies glass with domains and processes on top; colour by criticality (inherited down),
  continuity (gaps flow up), framework support or health; the size of a service is its blast radius; picking a node
  lights its whole chain.
- **Matrix**: processes × platform and development services; **what if**: mark platform services as failed and see
  which processes stop, how critical they are, how long the restore takes (the RTO of the failed services) and the
  margin of each process (to spare, no margin, breach). *Save as exercise* records the rehearsal by pull request; it
  changes nothing in the cluster.

## Who may do what

- Everyone with access to Backstage sees the map, the pages and the dashboards (normal catalog permissions).
- Changing (import, adopt, new or edit process, save an exercise) is for the Keycloak groups **business-architect**
  and **backstage-admin**: the templates start with a step that fails for anyone else, and the routes answer 403.
  The forms are still visible to everyone: hiding them needs the Backstage permission framework (pending for all of
  Backstage).

### Test users

In the realm files of iam-oneke (RefresquitoTime, RefresquitoID), password `${TEST_USERS_PASSWORD}` (store key
`iam-realm-clients`, like the other test users); the bootstrap creates them on an installed cluster.

| User | Groups | Expected |
|---|---|---|
| `business-architect-test` | business-architect, backstage-viewer | sees everything; imports, adopts, creates and edits processes, saves exercises (each opens its pull request) |
| `business-reader-test` | backstage-viewer | sees the map, the pages and the dashboards; any business-map template or saved exercise is refused |

## Backend reference

Plugin `business-map` (`packages/backend/src/plugins/businessMap/`):

| Route | Answers |
|---|---|
| `GET /api/business-map/map?namespace=` | domains and processes of a customer with requirement, result, gaps and services |
| `GET /api/business-map/continuity?entity=` | the requirement inherited by an entity and its check |
| `GET /api/business-map/processes/:ns/:name/check` | the check of every element of a process's chain |
| `GET /api/business-map/impact?entity=` | the processes that depend on an entity (or run on a framework line) |
| `GET /api/business-map/engine?key=` | links into Operaton for a process key |
| `POST /api/business-map/import/preview` | the preview of an import (no write) |
| `POST /api/business-map/exercises` | opens the pull request of a what-if exercise |

Scaffolder actions: `refresquito:business-model:preview`, `:import`, `:adopt`. Config: `businessMap.criticality`,
`businessMap.repo` / `businessMap.branch` (where the model files are read, default refresquito-services main),
`businessMap.exercises.repo` / `.branch` (default refresquito-specs main), `camundaPublicUrl` and `camundaAdmin.*` (the
process engine, now Operaton).

## Still open

- Hide the templates and buttons from people who may not use them (permission framework, for all of Backstage).
- The processes in DataHub (a phase of their own).
- "DR tested" in the readiness lens, from recorded exercises; cost of shared services split by use.
