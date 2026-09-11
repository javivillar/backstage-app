# @internal/plugin-seaweedfs

Frontend half of Backstage's SeaweedFS self-service resource management —
`SeaweedfsManagerPage` (`/seaweedfs-manager`), a 4-tab page (Buckets / Table
Buckets / Groups / Policies) listing the objects the caller has provisioned
through the `seaweedfs-create-*` scaffolder templates (or every object, with
an Owner column, for a `backstage-admin` member). Pairs with
`seaweedfs-backend`.

Delete buttons per row call the manager backend's own DELETE route directly
(same "ownership enforcement lives in exactly one place" principle as
`SupersetManagerPage`/`CamundaManagerPage`). Groups additionally get a
"Manage policies" button opening a small dialog: attached policies as
removable chips, plus a dropdown to attach another — that dropdown is
populated from the same ownership-scoped `GET /policies` the Policies tab
uses, so a non-admin only ever sees policies *they* created there, never
another user's or (unless they're an owner too) a pre-existing one.

See the **Backstage↔SeaweedFS section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` for the full security model.
