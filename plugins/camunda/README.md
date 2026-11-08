# @internal/plugin-camunda

Frontend half of Backstage's business-process self-service resource
management, running against **Operaton** (`operaton-oneke`, the open-source
fork of Camunda 7; the package and route keep their historical `camunda`
names) — `CamundaManagerPage` (`/camunda-manager`, titled "Operaton
Manager"), a single-table page listing the process definitions the caller
has provisioned through the `camunda-provision-process` scaffolder template
(or every process definition, with an Owner column, for a `backstage-admin`
member). Each row links to the definition in Operaton Cockpit
(`/operaton/app/cockpit/default/#/process-definition/<id>`). Pairs with
`camunda-backend`.

Edit/Delete buttons per row navigate to the `camunda-update-process`/
`camunda:delete-process` flows (Edit → the `camunda-update-process`
scaffolder template with `processKey` pre-filled; Delete → a direct call to
the manager backend's own DELETE route) rather than duplicating mutation
logic here — same "ownership enforcement lives in exactly one place"
principle as `KeycloakManagerPage`/`SupersetManagerPage`.

See the **Backstage section of
[`AUTHZ.md`](https://github.com/javivillar/refresquito-services/blob/main/AUTHZ.md)**
in `refresquito-services` for the full security model.
