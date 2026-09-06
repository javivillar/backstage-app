import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { UserInfoService } from '@backstage/backend-plugin-api';
import { camundaFetch, camundaPublicUrl, deleteAllProcessDefinitionVersions } from './camundaClient';
import { callerInfo, grantOwnership, requireOwnerOrAdmin } from './ownership';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractProcessId(bpmnXml: string): string | undefined {
  return bpmnXml.match(/<bpmn:process[^>]*\sid="([^"]+)"/)?.[1];
}

/**
 * Same start-event executionListener + assignee pattern already designed,
 * implemented and verified live for `authz-test-process`
 * (`charts/bpm-oneke/files/examples/authz-test-process.bpmn` in
 * refresquito-services — see AUTHZ.md § bpm-oneke §6): grants the user who
 * STARTS an instance a per-instance READ, and assigns the task directly to
 * them rather than to the whole `camunda-editor` candidate group. Applying
 * this to every self-service-provisioned process means instance/task
 * isolation is automatic from day one, with no per-process authoring effort
 * — only the DEFINITION-level ownership grant (who may edit/delete this
 * process at all) is new, handled separately by grantOwnership below.
 */
function buildBpmn(processKey: string, processName: string): string {
  const name = escapeXml(processName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                   id="Definitions_${processKey}"
                   targetNamespace="http://refresquito.com/bpm">
  <bpmn:process id="${processKey}" name="${name}" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:extensionElements>
        <camunda:executionListener event="start">
          <camunda:script scriptFormat="javascript">
            <![CDATA[
              // Grants the STARTER of this instance READ on this specific
              // instance's resourceId -- per-instance isolation between
              // users who share the same Keycloak group (camunda-editor).
              var authorizationService = execution.getProcessEngineServices().getAuthorizationService();
              var identityService = execution.getProcessEngineServices().getIdentityService();
              var auth = identityService.getCurrentAuthentication();
              if (auth != null) {
                var Authorization = Java.type('org.camunda.bpm.engine.authorization.Authorization');
                var Resources = Java.type('org.camunda.bpm.engine.authorization.Resources');
                var Permissions = Java.type('org.camunda.bpm.engine.authorization.Permissions');
                var authorization = authorizationService.createNewAuthorization(Authorization.AUTH_TYPE_GRANT);
                authorization.setUserId(auth.getUserId());
                authorization.setResource(Resources.PROCESS_INSTANCE);
                authorization.setResourceId(execution.getProcessInstanceId());
                authorization.addPermission(Permissions.READ);
                authorizationService.saveAuthorization(authorization);
                // Also used to assign the Review task directly to the
                // starter below -- deliberately NOT a candidateGroups task,
                // otherwise every camunda-editor peer would see it.
                execution.setVariable('starterUserId', auth.getUserId());
              }
            ]]>
          </camunda:script>
        </camunda:executionListener>
      </bpmn:extensionElements>
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_review" name="Review" camunda:assignee="\${starterUserId}">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_review" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_review" targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;
}

interface DeployedProcessDefinition {
  id: string;
  key: string;
}

async function deploy(
  config: Config,
  processKey: string,
  bpmnXml: string,
): Promise<DeployedProcessDefinition> {
  const form = new FormData();
  form.append('deployment-name', processKey);
  form.append('deployment-source', 'backstage');
  form.append('enable-duplicate-filtering', 'false');
  form.append('data', new Blob([bpmnXml], { type: 'text/xml' }), `${processKey}.bpmn`);

  const res = await camundaFetch(config, '/deployment/create', { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`Failed to deploy Camunda process "${processKey}": ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    deployedProcessDefinitions?: Record<string, DeployedProcessDefinition>;
  };
  const defs = Object.values(body.deployedProcessDefinitions ?? {});
  if (defs.length === 0) {
    throw new Error(
      `Camunda deployment of "${processKey}" succeeded but returned no deployed process definitions ` +
        '(duplicate-filtering may have skipped it as unchanged).',
    );
  }
  return defs[0];
}

export function createCamundaProvisionProcessAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<{ processName: string; processKey: string; description?: string }>({
    id: 'camunda:provision-process',
    description:
      'Deploys a minimal Camunda process (start event -> one user task -> end event), pre-wired ' +
      'with per-developer isolation, and grants you exclusive rights to it -- no other developer ' +
      'can see or start it, even one who shares your Keycloak group.',
    schema: {
      input: {
        type: 'object',
        required: ['processName', 'processKey'],
        properties: {
          processName: { title: 'Process name', type: 'string' },
          processKey: {
            title: 'Process key (short slug)',
            description:
              'Gets prefixed with your username automatically (e.g. "jdoe-onboarding") so it ' +
              "can't collide with another developer's process.",
            type: 'string',
          },
          description: { title: 'Description', type: 'string' },
        },
      },
      output: {
        type: 'object',
        properties: {
          processKey: { type: 'string' },
          cockpitUrl: { type: 'string' },
          bpmnXml: { type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const processKey = `${caller.username}-${slugify(ctx.input.processKey)}`;
      const bpmnXml = buildBpmn(processKey, ctx.input.processName);

      const definition = await deploy(config, processKey, bpmnXml);
      await grantOwnership(config, processKey, caller.username);

      const cockpitUrl = `${camundaPublicUrl(config)}/camunda/app/cockpit/default/#/process-definition/${definition.id}`;
      ctx.logger.info(`Provisioned Camunda process ${processKey} (${definition.id}) for ${caller.entityRef}`);
      ctx.output('processKey', processKey);
      ctx.output('cockpitUrl', cockpitUrl);
      ctx.output('bpmnXml', bpmnXml);
    },
  });
}

export function createCamundaUpdateProcessAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<{ processKey: string; bpmnXml: string }>({
    id: 'camunda:update-process',
    description:
      'Redeploys a new BPMN version under an existing process key you own (or, if backstage-admin, ' +
      'any key). Model the process further in the desktop Camunda Modeler, then paste the updated ' +
      'XML here.',
    schema: {
      input: {
        type: 'object',
        required: ['processKey', 'bpmnXml'],
        properties: {
          processKey: {
            title: 'Process key',
            description: 'Identifies the process to update.',
            type: 'string',
          },
          bpmnXml: { title: 'BPMN XML', type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireOwnerOrAdmin(config, caller, ctx.input.processKey);

      // The ownership grant is scoped to the resourceId (= the <process id>
      // embedded in the BPMN, not the deployment-name param) -- reject a
      // mismatch up front rather than silently deploying an unowned
      // definition under a different key.
      const embeddedId = extractProcessId(ctx.input.bpmnXml);
      if (embeddedId !== ctx.input.processKey) {
        throw new Error(
          `The uploaded BPMN's <bpmn:process id="${embeddedId ?? '?'}"> must match "${ctx.input.processKey}" ` +
            '-- do not rename the process id when editing in the Modeler, or ownership will not carry over.',
        );
      }

      const definition = await deploy(config, ctx.input.processKey, ctx.input.bpmnXml);
      ctx.logger.info(`Redeployed Camunda process ${ctx.input.processKey} (${definition.id}) for ${caller.entityRef}`);
    },
  });
}

export function createCamundaDeleteProcessAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<{ processKey: string }>({
    id: 'camunda:delete-process',
    description:
      'Deletes a process definition (all versions, all instances) you own, or -- if backstage-admin ' +
      '-- any process key.',
    schema: {
      input: {
        type: 'object',
        required: ['processKey'],
        properties: { processKey: { title: 'Process key', type: 'string' } },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireOwnerOrAdmin(config, caller, ctx.input.processKey);

      await deleteAllProcessDefinitionVersions(config, ctx.input.processKey);
      ctx.logger.info(`Deleted Camunda process ${ctx.input.processKey} for ${caller.entityRef}`);
    },
  });
}
