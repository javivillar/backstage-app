# Changes asked for: the pull requests of the console

Many pages of the console change something **by pull request**: nothing happens until someone accepts it. Each of
those pages shows the card **Changes asked for** with the pull requests it opened and where each one stands, so the
change is not lost from sight after the page that asked for it is closed.

## Where it shows

| Page | Pull requests shown | Read from |
|---|---|---|
| FinOps › Prices | price changes | `GET /api/costs/prices/pulls` |
| Business management › Data continuity › Protection plans | plan changes | `GET /api/protection/pulls` |
| Business continuity › Organisation | organisations and product owners | `GET /api/business-map/pulls?kind=organisation` |
| Business continuity › Organisation › Import organisation | the same (customer and provider loads), always drawn | `GET /api/business-map/pulls?kind=organisation` |
| A business process › Process model | the BPMN model of that process | `GET /api/business-map/pulls?kind=bpmn` |
| Business continuity › Ownership | organisations and product owners, always drawn | `GET /api/business-map/pulls?kind=organisation` |
| Business continuity › Import business model, Adopt reference model, New / Edit process (once the template runs) | imports, adoptions and processes of the model, always drawn | `GET /api/business-map/pulls?kind=model` |
| Business continuity › Matrix › Save as exercise | the exercises (refresquito-specs) | `GET /api/business-map/exercises/pulls` |

The card is not drawn when there is nothing to show, or when GitHub cannot be read: the page works the same without
it. The exception is **Import organisation**: there the card is always drawn, so the state of a load can be followed
right after asking for it.

**Refresh** reads GitHub again at once (the backend drops what it kept) and the card says at what time the state was
read. A page that has just opened a pull request refreshes the card by itself.

**Zone** (virtual machines, components, segregations, clusters, interconnection, Marketplace, the platform
overview) keeps its own list of requests, which also follows a change after it is merged (waiting for the host, done,
failed). That list now has **Refresh** and, on each open request, the same state of its checks
(`GET /api/cluster/pulls?repo=infra|vms`). **Manage** keeps "pending change #n" on each object and adds the card
under the list of objects (`GET /api/manage/pulls`; the pull requests in the repositories of the applications, their
dashboards, are not in it).

## What each row says

The title and number of the pull request, who asked for it, when, its state and the link to GitHub.

| State | Meaning | Link |
|---|---|---|
| Checks running | open; the checks of the repository have not finished | Review in GitHub |
| Checks failed | open; a check failed | Review in GitHub |
| Conflicts: it cannot be merged | open; another change touched the same file. Close it and ask again | Review in GitHub |
| Ready to accept | open; checks passed | **Review and accept in GitHub** |
| Open | open; the state of its checks could not be read | Review in GitHub |
| Accepted | merged, in the last 14 days | See in GitHub |
| Closed without accepting | closed, in the last 14 days | See in GitHub |

What still waits comes first. Under the table each page says what has to happen **after** accepting for the change
to take effect (a price: the next deployment of `cnoe-oneke`; a plan: the sync of `protection-oneke`; an
organisation or a model: the catalogue reading the repository again).

Accepting is done in GitHub, by whoever may merge in that repository: the console links to the pull request and
does not merge.

## Cancelling a change

A change that is still open has **Cancel** on its row, for who may cancel it: the person who asked for it, or anyone
who may make that kind of change (the groups of that page: prices, protection plans, business architects, the
console actions groups in Zone and Manage). It asks first; then the pull request is **closed**, a comment says who
cancelled it from the console, and its branch is deleted. The row turns to *Closed without accepting*. An accepted
change cannot be cancelled: ask for the opposite change.

`POST <the list>/<number>/cancel` (for example `/api/costs/prices/pulls/12/cancel`,
`/api/business-map/pulls/7/cancel?kind=organisation`, `/api/cluster/pulls/9/cancel?repo=infra`). The backend only
closes a pull request of that kind (its branch prefix) that is open, and answers 403 to anyone else. Who asked for a
change is read from its text, so a pull request that does not say it can only be cancelled by who may make the
change. The token of Backstage needs *Pull requests: write* (it has it, to open them) and *Contents: write* to
delete the branch.

## How it works

- A change of the console is a branch `console/<kind>-…`. The backend lists the pull requests of the repository and
  keeps those whose branch starts with the prefix of the kind: `console/prices-`, `console/protection-`,
  `console/org-`, `console/bpmn-`, `console/exercise-`; the templates of the business model use the branch names
  `business-map-import-`, `business-map-adopt-` and `business-process-` (`packages/backend/src/plugins/consolePulls.ts`).
- For each **open** one it asks GitHub twice more: its mergeable state and the check runs of its last commit. If
  either cannot be read (the token of Backstage lacks *Checks: read*), the pull request is still listed, as *Open*.
- "Asked by" is read from the text of the pull request (`by user:<namespace>/<name>`, as the console writes it).
- The answer is kept **one minute** per kind, and forgotten when the console opens a new pull request of that kind.
  The state is read when the page opens, not live: **Refresh** reads it again (`?fresh=1` skips what was kept). The GitHub limit is shared by
  the whole portal.
- Any signed-in user of the page may read the list; it shows nothing the page does not already allow.

Token of Backstage on the repository: *Pull requests: read* (it already has write, to open them) and, for the state
of the checks, *Checks: read* (or *Commit statuses*); without it every open pull request shows as *Open*.

## Adding it to another page

Backend: a `PullReader` of the repository and one route,
`router.get('/pulls', pullsHandler(reader, () => ['console/<kind>-'], signedIn, warn))`; call `reader.forget()`
after opening a pull request. Console: `<PendingChanges plugin="<plugin>" path="/pulls" refresh={…} applies={…} />`
(`plugins/console/src/components/PendingChanges.tsx`, texts `pc.*` in `messages/pulls.ts`); `match` narrows it to
the branches of one thing.

## Still open

- **Zone**: Refresh reads the state of the checks again, not the list itself; a request accepted meanwhile shows as
  *Accepted* on its row until the page is loaded again.
- **Manage**: the pull requests in the repositories of the applications (dashboards) are not in the card.
- A page does not yet mark **which row** has a change waiting (a price, the plan of an application); the card lists
  the pull requests, their titles say what changes.
- **Accepting from the console** is left out on purpose: it needs deciding who may, and merge permission for the
  token of Backstage.
