# Business continuity (business map)

The business map of **Business continuity** links the **business processes** of each customer to the **business services** that support them
and, down the chain, to the **platform and development services** of Refresquito. Each process says how much it can
afford to lose (RPO) and to be down (RTO); the map checks that what runs underneath delivers it, shows where the
business risk is, and rehearses what stops when a service fails.

Console: menu group **Business management › Business continuity** (`/console/business-map`), with the views Map ·
Explorer · Heat map · Glass · Matrix, the page of each process, and the tab **Impact on the business** on services, applications
and framework lines. The same group has **Data continuity** (`/console/data-continuity`, still empty) and **Digital continuity**
(`/console/continuity`, the continuity profiles of each service).

## The model

```
business domain        Domain, spec.type business-area            e.g. occar-a400m/service-after-sales
 → business process     BusinessProcess (refresquito.io/v1alpha1)   e.g. Manage repair and maintenance
   ⤷ sub-processes      BusinessProcess with spec.parentProcess      APQC levels 4-5 (activities, tasks)
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
  mtpd: 72h                              # business impact analysis: maximum tolerable period of disruption
  workaround: { manual: true, maxDuration: 24h, note: paper work orders }   # can it go on by hand, and how long
  classification: occar-restricted
  dependsOn: [system:default/maintenance, system:default/documents]
---
# a sub-process: it inherits from its parent chain whatever it does not say (criticality, rpo, rto, mtpd, retention,
# workaround, dependsOn); spec.domain is the domain of its top process
apiVersion: refresquito.io/v1alpha1
kind: BusinessProcess
metadata:
  name: plan-a-repair
  namespace: occar-a400m
  title: Plan a repair
  description: Decide when and where the aircraft is repaired.
  annotations: { apqc.org/pcf-id: "6.3.2.1" }
spec:
  owner: group:default/a400m-maintenance
  domain: service-after-sales
  parentProcess: manage-repair-and-maintenance   # a BusinessProcess of the same namespace (or a full ref)
---
apiVersion: refresquito.io/v1alpha1
kind: ReferenceModel
metadata: { name: apqc-aerospace-defense-7-4, title: "APQC PCF · Aerospace & Defense" }
spec: { source: apqc, industry: aerospace-defense, version: "7.4", namespace: apqc-aerospace-defense }
```

The catalog module `business-map` validates them and emits `ownedBy`/`ownerOf`, `partOf`/`hasPart` (Domain, and the
parent process of a sub-process) and `dependsOn`/`dependencyOf`. A top process must say its criticality; a sub-process
may leave it out. `metadata.description` is the description of a domain or a process (imported, or written in the
process form). The files live in refresquito-services `catalog/business-map/<namespace>/`, one entity per
file (`domain-<name>.yaml`, `process-<name>.yaml`, `reference-model.yaml`), read through the Location `business-map`
of the app-of-apps catalog; the catalog rules allow these kinds only there. An example customer with made-up data:
`catalog/business-map/example-customer/`.

## Changing it: always by pull request

| What | Where in the console | Template | Writes |
|---|---|---|---|
| Import a business model | Business continuity › Import business model | `business-model-import` | `catalog/business-map/<ns>/` |
| Upload BIA results | Business continuity › Import business model › BIA results | `business-model-import` (source `bia`) | the processes it changes |
| Adopt a reference model | Business continuity › Adopt reference model | `business-model-adopt` | `catalog/business-map/<ns>/` |
| New / edit a process | Business continuity › New business process; a process › Edit | `business-process-new` / `-edit` | `process-<name>.yaml` |
| Save a what-if exercise | Matrix › Save as exercise | — (route) | refresquito-specs `continuity/exercises/<ns>/<date>-<slug>.yaml` |

### Importing a model

Three sources: **APQC PCF** (the Excel the customer downloaded), the **Refresquito template** (fixed columns: ID,
parent, title, description, owner, criticality, RPO, RTO, retention, applications) or the customer's **own spreadsheet**
with a column mapping (which column is ID, title, description, parent or level…) and a value mapping (e.g. `Alta → critical`), saved with
the model and reused on the next import. Excel (`.xlsx`) and CSV are read without extra libraries.

APQC levels 1/2/3 become Domain / subdomain / BusinessProcess, and levels 4 and 5 sub-processes (a BusinessProcess
under its parent, `spec.parentProcess`). The description of each element comes from the PCF's description column when
the sheet has one (`Description`, `Element Description` or `Definition`). In an own model, a row without parent is a
Domain; under a Domain, a subdomain if it has children, else a process; under a subdomain a process; anything under a
process a sub-process. A sub-process without a criticality of its own inherits it (none is written). A sub-process
named like another entity takes its ID in its name (`plan-a-repair-6-3-2-1`), so names do not depend on the order of
the rows; the rest keep `-2`, `-3`… as before. The page of a process can still link its BPMN in Operaton.

The form shows a **preview** before anything is written (`POST /api/business-map/import/preview`): counts (domains,
processes and sub-processes; new, changed, no longer in the file, unchanged), **errors** that stop the import (a parent
not in the file, a duplicated ID…) and **warnings** (an application not in the catalog, an owner that is no group).
Rows with errors can be skipped. The table of changes has pages (25, 50 or 100 rows) and filters: the kind of change,
the type (domain, subdomain, process, sub-process), the level-1 domain, and a search on ID, title or description; the
description shows under each title.

**Reimport**: entities are matched by their original ID. Only what the file says is compared: an empty cell, or a
column the file does not have (an APQC PCF has no RPO), never changes nor clears a value. What a person changed in the portal after the last import
(owner, applications, overrides, description) wins over the file, and the pull request lists it; an entity no longer in the file is
kept and marked `refresquito.io/deprecated`, never deleted. Each entity keeps per-field hashes of what was imported
(`refresquito.io/imported-hash`) to tell portal edits from imported values.

**Licence**: Refresquito never ships APQC content (not in the repositories, not as test data). The importer reads the
PCF files each customer has downloaded under APQC's terms.

## Business impact analysis

An APQC model brings the **structure** only: domains, processes and sub-processes, with their IDs and descriptions.
The continuity values of each process come from the **business impact analysis (BIA)** its business owners make,
usually once a year:

1. **Download the BIA sheet**: Business continuity › *Download BIA sheet* (`GET /api/business-map/bia?namespace=<ns>
   [&domain=<level-1 domain>][&level=3|all]`). An .xlsx with one row per process (level 3; *processes and
   sub-processes* adds the rest), its current values filled in, and a *Guide* sheet with the allowed values and the
   defaults of each criticality. Pick a level-1 domain so each business owner gets the processes of theirs.

   | Column | Means |
   |---|---|
   | ID, Domain, Subdomain, Process | which process (the ID matches the row; do not change it) |
   | Description, Owner | what it is and the group in charge |
   | Criticality | critical / important / standard |
   | RPO, RTO | how much data it can lose; how long it can be down |
   | MTPD | maximum tolerable period of disruption: after it the harm is unacceptable |
   | Retention | how long its records are kept |
   | Workaround, Workaround max | whether it can go on by hand (yes/no), and for how long |
   | Applications | the business services it needs (their names, comma separated) |
   | Notes | for the owners and the analysts: not imported |

2. **The owners fill** only the cells they mean to change. An empty cell changes nothing; a sub-process left empty
   inherits from its parent.
3. **Upload the results**: Import business model › *BIA results*. The preview lists every change field by field (`rto:
   72h → 4h`); rows whose ID is no process of the customer, or with a value that is not valid (a criticality, a
   duration, an owner that is no group, an application not in the catalog), are errors of their row. The analysis
   **only updates**: it never creates a process and never marks one gone because its row is not in the sheet. One pull
   request.
4. **The check**: each process checks its RTO against its MTPD; an RTO above the MTPD shows as a warning on the page
   of the process (the restore would end after the business can bear it).

What the analysis writes counts as a portal value: a later APQC reimport never overwrites it (the PCF has none of
these columns, and these values are not part of the imported hash). The page of a process shows the MTPD and the
manual workaround next to the RPO and RTO.

### Adopting a reference model

A loaded reference model (APQC of an industry) is copied into a customer's namespace: pick the level-1 categories that
apply, the namespace and the owner group; their subdomains, processes and sub-processes are copied (each sub-process
under its parent); the copies keep `apqc.org/pcf-id`, so a later version of the model can be
compared. An own model needs no adoption: it is imported straight into the customer's namespace (with optionally the
support categories of a loaded APQC model).

## The views

- **Map**: the domains of a customer with their subdomains and top processes as cards (criticality, RPO/RTO, result of
  the check, owner, how many sub-processes; the description as tooltip); a filter for gaps only; the selected process
  with its description, its applications and where each value comes from. The map, heat map, glass and matrix draw the
  top processes; the sub-processes are on the page of their parent.
- **Process page**: its description, the requirement (default of its criticality, override, or inherited from its
  parent process), its sub-processes as a tree (each with its criticality and check), its chain down to the platform
  services, the check of each element, how to close each gap, its BPMN in Operaton (`refresquito.io/process-key`), its
  data products. A sub-process shows its parents in the crumbs and links its parent.
- The answers that list the processes above a service (continuity, impact) take the top processes and the
  sub-processes that say something of their own (criticality, RPO, RTO or dependencies), so a service does not list
  every activity under a process.
- **Impact on the business** (tab of services, business services, applications and framework lines): the processes
  that depend on it, strictest first, with the check; on a framework line, the business services that still run it in
  each stage and their processes, to plan upgrades.
- **Explorer**: the whole model as one tree-table (level-1 domains → subdomains → processes → sub-processes): ID,
  title and description, level, criticality (and whether it is inherited), RPO · RTO, the check, applications and
  owner. A search over ID, title and description shows each match with its ancestors (the matches highlighted);
  filters by level, level-1 domain, criticality, check and owner; *Expand all* / *Collapse to level 3*; pages of 25,
  50 or 100 rows; *Export CSV* of the rows of the filters. It reads the same `GET /map`, sub-processes included.
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
| `GET /api/business-map/bia?namespace=[&domain=][&level=3\|all]` | the .xlsx of the business impact analysis |
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
