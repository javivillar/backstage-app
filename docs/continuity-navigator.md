# Continuity navigator

One map of the continuity of a customer, **from the business domain down to the data**. It joins what the console
already knows in three places — the business model ([Business continuity](business-map.md)), the copies of the data of
each application (Data continuity) and the digital continuity — and lets you walk it in both directions: down from a
domain to the volumes that hold its data, or up from an application to every process and domain that stops without it.

Console: menu group **Business management › Continuity navigator** (`/console/continuity-navigator`, customer in
`?ns=` as in the business map). It is a read-only page: it changes nothing in the catalog or in the cluster.

- [What it draws](#what-it-draws)
- [The two lights](#the-two-lights)
- [Using it](#using-it)
- [Under the map](#under-the-map)
- [Where the data comes from](#where-the-data-comes-from)
- [Large models](#large-models)
- [Who may open it](#who-may-open-it)
- [Still open: digital continuity](#still-open-digital-continuity)
- [Code and tests](#code-and-tests)

## What it draws

Seven levels, each one a column, linked left to right:

| Column | What it is | Source |
|---|---|---|
| Domains | `Domain` without `subdomainOf` | business map |
| Subdomains | `Domain` with `subdomainOf` | business map |
| Processes | `BusinessProcess` without `parentProcess` | business map |
| Sub-processes | `BusinessProcess` with `parentProcess` (APQC levels 4-5) | business map |
| Applications | what a process depends on: its business services (and any other service it names) | business map (`services` of each process) |
| Data continuity | the Longhorn volumes of the application in this cluster, with how often they are copied | Data continuity (`/api/protection`) |
| Digital continuity | one box per application, **not declared yet** | [open](#still-open-digital-continuity) |

The links follow the model: domain → subdomain → process → sub-process, a process (and each sub-process) → the
applications it names, an application → its volumes → its digital continuity. An application without volumes in this
cluster goes straight to its digital continuity box.

A link takes the colour of what it leads to. The link from a process to an application is the exception: it is
coloured by how *that* application answers *that* process, so the same application can be reached by a green link from
a process that accepts losing a day and by a red one from a process that accepts losing fifteen minutes.

The map is dark in both themes of the console, on purpose: lights and threads read the same by day and by night.

## The two lights

Every box (except digital continuity) carries two lights. They are two different questions and are never merged into
one value; the **Colour by** control chooses which one colours the boxes' edges and the links (*Both* takes the worst).

| Light | Question | How it is worked out |
|---|---|---|
| **Continuity check** (round) | Does the chain under the process *declare* the RPO and RTO the business needs? | The check of the business map as it is: `result` of the process (`meets` → met, `gap` → gap, `unknown` → not checked) and of each service under it. Nothing is recomputed here. |
| **Data continuity** (square) | Do the copies that are *really* taken give what the business accepts losing? | The time between two copies of the application (below) against the RPO of the process, and the state of its protection. |

Data continuity, per application and process:

- **Time between copies** = the most frequent schedule of the protection plan of the application: its Longhorn
  snapshots, its Velero backups, its weekly backups (`cronMinutes` reads the cron lines the plans use: every *n*
  minutes or hours, daily at one or several hours, weekly; any other line is "unknown" and takes no part).
- **Gap** when that time is longer than the RPO of the process, or when the application has **no plan**.
- **At risk** when the copies are enough but the protection is not healthy: last backup late or failed, no backup
  yet, or the application holds the backup store itself (snapshots only).
- **Met** otherwise. **Not checked** when the application keeps no volumes in this cluster, or the cluster has no
  Data continuity (protection-oneke not installed, or it cannot be read).

A snapshot lives on the same disk as the volume, so "time between copies" is the best case (a deletion, a bad
upgrade). What survives the loss of the disk is the backup in the store; the **Data continuity** card shows both
dates so the difference is in sight.

How a light climbs:

- a **process** (or sub-process) takes the worst of the applications it names;
- an **application** and its **volumes** answer to the tightest RPO of every process above them;
- a **domain** or **subdomain** takes the worst of the processes under it (sub-processes included).

The header of each column counts its boxes and how many of them have a gap under the current **Colour by**.

## Using it

- **Hover** (or focus) a box: its thread lights up — everything above and below it — and the rest dims.
- **Select** a box: only its thread stays, the rest leaves and what stays grows to show more (the requirement of a
  process, the framework line or namespace of an application, the size and copies of a volume).
- **Select again inside the thread** to narrow it. The trail above the map (*Whole business › Domain … › Process …*)
  keeps every step; what is on screen is what is on the thread of **all** of them. So domain → process → application
  shows that application for that process only, while selecting the application on its own shows every process and
  domain that depends on it.
- **Go back**: a box of the trail goes back to it, the selected box again (or **Esc**) goes back one step, *Whole
  business* starts again. Selecting something outside the thread starts a new thread there.
- **Jump to**: type the name of a domain, process, application or volume.
- **What if it is lost?** (on an application or a volume, and *Lose it* in the data table): the loss climbs back up
  the map in red to every process and domain that depends on it. The banner says how many processes and domains
  stop, how many are critical, and whether the copies are within what the business accepts losing. It is a drawing:
  nothing is touched. *End the simulation* (or Esc) clears it. To rehearse the failure of platform services and
  keep the result, use **Business continuity › Matrix › what if**, which records exercises.
- **Play the guided tour**: walks one thread on its own, from the top domain of the first critical process with a gap
  down to its data, and ends with the loss of that data. Any click stops it.

Motion follows the reduced-motion setting of the system: with it, boxes and links jump to their place and nothing
flows or pulses.

## Under the map

With nothing selected: the totals of the customer (processes, critical ones, with a continuity check gap, with a data
continuity gap, applications, volumes) and **Where continuity breaks first**, the processes with a gap, the most
critical first; each one opens its thread.

With a selection, the same three cards at every level:

1. **What the business needs** — for a process: criticality, how much it can lose (RPO), when it must be back (RTO),
   retention and where it belongs. For anything else: the tightest need of the processes on the thread and those
   processes, worst first.
2. **Data continuity** — one row per application on the thread that keeps volumes here: plan, time between copies,
   last snapshot, last backup and the verdict against the tightest need of the processes on screen that use it
   (*Gap: 6h for 15m*, *Meets 4h*, or what is wrong with its protection).
3. **Digital continuity** — open; see below.

*Open its page* goes to the entity of a process or application, or to the application in Data continuity for a volume.

## Where the data comes from

The page composes three reads in the browser; there is no backend of its own.

| Read | What it gives | If it fails |
|---|---|---|
| `GET /api/business-map/map?namespace=` | domains, processes and sub-processes with their requirement and check, and the services of each process | the page says the model could not be read |
| `GET /api/protection` | the protected applications of the cluster: plan, state, volumes, last snapshot and backup; and the plans | the Data continuity column is empty and its light is "not checked"; the rest works |
| catalog: Components with `backstage.io/kubernetes-namespace` | where each application runs and its framework line (`refresquito.io/framework-line`) | applications are matched by name only |

An application of the map is matched to a protected application of the cluster by the **namespace of its pro
instance** (the `application-instance` Component of the business service without a `dev`/`pre` stage) and, failing
that, by name (`petstore` ↔ `petstore-oneke`). Data continuity is of **this cluster**: an application that runs in
another cluster, or a business service that is only a catalog entry, shows "No volumes in this cluster" and is not
checked.

## Large models

A column with more than 40 boxes on screen is **folded** into one dashed box that says how many it holds (for example
*352 processes*); the links pass through it and keep the worst colour of what they stand for. Selecting a domain or
subdomain on its left opens it. A model imported from APQC with thousands of sub-processes therefore opens folded and
unfolds as the thread narrows. Only what is on screen is drawn.

Below 1120 px of width the map keeps that width and scrolls sideways inside its frame.

## Who may open it

The page belongs to the **business** area of the portal permissions, with Business continuity and Data continuity:
who can open those can open the navigator. The reads are those of the pages it joins, with their own checks.

## Still open: digital continuity

Digital continuity today describes the **Refresquito services** (their continuity profiles: exit, escrow, evidence;
`/console/continuity`). Nothing is declared yet **per application**, so the seventh column is drawn but empty of
state: each application has a box that says *Not declared yet*, it carries no light and it does not colour the map.
The card under the map says so, lists the framework line of each application when the catalog knows it, and links to
the digital continuity of the services.

To be decided before it is filled in:

- **What is declared**: the candidate safeguards are retention against the longest retention of the processes,
  open export (format and dictionary), integrity (fixity checks, time stamps), a supported framework line, and
  escrow (source and images kept in the zone and rebuilt in a test).
- **Where it lives**: a continuity profile per application next to its specification, changed by pull request, as
  the profiles of the services are.
- **How it lights the map**: a third light, and whether a missing safeguard is a gap or a risk.

When that exists, `navigatorModel.ts` only needs the state on the `dig` boxes and a third lens; the layout, the
threads and the loss already treat the column as any other.

## Code and tests

| File (under `plugins/console/src`) | What it holds |
|---|---|
| `components/navigator/navigatorModel.ts` | Pure model: the graph (`navigator`), the lights (`copiesLight`, `lightOf`, `linkLight`), `cronMinutes`/`planMinutes`, the threads (`threadOf`, `visibleOf`, `pick`), the layout with folding (`layout`), the loss (`lossOf`), the tour (`tourOf`) and the instance lookup (`instancesOf`) |
| `components/navigator/navigatorModel.test.ts` | Tests of all of the above on a made-up customer |
| `components/navigator/ContinuityNavigatorPage.tsx` | The page: the reads, the map (boxes and links moved with CSS transitions), the trail, the tour and the cards |
| `messages/navigator.ts` | Its texts, English and Spanish (`nav.continuityNavigator`, `cn.*`) |
| `components/ConsoleRouter.tsx`, `components/ConsoleShell.tsx`, `navIcons.ts`, `portalPermissions.tsx` | The route, the menu entry, its icon and its permission area |

Links move with the CSS property `d`; a browser without it (Safari today) draws them in place without the movement.
