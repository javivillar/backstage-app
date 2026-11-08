import { ConfigReader } from '@backstage/config';
import { UserInfoService } from '@backstage/backend-plugin-api';
import { buildBpmn, createCamundaProvisionProcessAction } from './camunda-actions';

describe('buildBpmn', () => {
  const xml = buildBpmn('jdoe-onboarding', 'Onboarding & <co>');

  it('uses the Operaton Java classes in the start listener script', () => {
    expect(xml).toContain("Java.type('org.operaton.bpm.engine.authorization.Authorization')");
    expect(xml).toContain("Java.type('org.operaton.bpm.engine.authorization.Resources')");
    expect(xml).toContain("Java.type('org.operaton.bpm.engine.authorization.Permissions')");
    expect(xml).not.toContain('org.camunda.bpm');
  });

  it('keeps the camunda: extension namespace, which Operaton runs unchanged', () => {
    expect(xml).toContain('xmlns:camunda="http://camunda.org/schema/1.0/bpmn"');
    expect(xml).toContain('<bpmn:process id="jdoe-onboarding" name="Onboarding &amp; &lt;co&gt;"');
  });
});

describe('camunda:provision-process', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns an Operaton Cockpit link for the deployed definition', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deployedProcessDefinitions: { a: { id: 'jdoe-onboarding:1:abc', key: 'jdoe-onboarding' } },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const config = new ConfigReader({
      camundaAdmin: { baseUrl: 'http://operaton:8080', username: 'operaton-admin-sa', password: 'x' },
      camundaPublicUrl: 'https://operaton.example.org',
    });
    const userInfo = {
      getUserInfo: async () => ({ userEntityRef: 'user:default/jdoe', ownershipEntityRefs: [] }),
    } as unknown as UserInfoService;
    const action = createCamundaProvisionProcessAction({ config, userInfo });

    const outputs: Record<string, unknown> = {};
    const ctx = {
      input: { processName: 'Onboarding', processKey: 'Onboarding' },
      logger: { info: jest.fn() },
      output: (k: string, v: unknown) => {
        outputs[k] = v;
      },
      getInitiatorCredentials: async () => ({}),
    };
    await action.handler(ctx as any);

    expect(fetchMock.mock.calls[0][0]).toBe('http://operaton:8080/engine-rest/deployment/create');
    expect(fetchMock.mock.calls[1][0]).toBe('http://operaton:8080/engine-rest/authorization/create');
    expect(outputs.processKey).toBe('jdoe-onboarding');
    expect(outputs.cockpitUrl).toBe(
      'https://operaton.example.org/operaton/app/cockpit/default/#/process-definition/jdoe-onboarding:1:abc',
    );
  });
});
