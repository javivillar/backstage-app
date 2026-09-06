# @internal/plugin-camunda

Frontend half of Backstage's Camunda self-service resource management —
`CamundaManagerPage` (`/camunda-manager`), a single-table page listing the
process definitions the caller has provisioned through the
`camunda-provision-process` scaffolder template (or every process
definition, with an Owner column, for a `backstage-admin` member). Pairs
with `camunda-backend`.

Edit/Delete buttons per row navigate to the `camunda-update-process`/
`camunda:delete-process` flows (Edit → the `camunda-update-process`
scaffolder template with `processKey` pre-filled; Delete → a direct call to
the manager backend's own DELETE route) rather than duplicating mutation
logic here — same "ownership enforcement lives in exactly one place"
principle as `KeycloakManagerPage`/`SupersetManagerPage`.

See the **Backstage↔Camunda section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` for the full security model.
