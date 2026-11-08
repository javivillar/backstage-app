import { ConfigReader } from '@backstage/config';
import {
  OPERATON_WEBAPP_PATH,
  camundaFetch,
  camundaPublicUrl,
  cockpitProcessDefinitionUrl,
} from './camundaClient';

const config = (extra: Record<string, unknown> = {}) =>
  new ConfigReader({
    camundaAdmin: {
      baseUrl: 'http://operaton-oneke-operaton.z-p-operaton-oneke.svc.cluster.local:8080',
      username: 'operaton-admin-sa',
      password: 'secret',
    },
    ...extra,
  });

describe('Operaton links', () => {
  it('points Cockpit deep links at the Operaton webapps, not /camunda/app', () => {
    const url = cockpitProcessDefinitionUrl('https://operaton.example.org', 'jdoe-onboarding:1:abc');
    expect(url).toBe(
      'https://operaton.example.org/operaton/app/cockpit/default/#/process-definition/jdoe-onboarding:1:abc',
    );
    expect(url).not.toContain('/camunda/app');
    expect(OPERATON_WEBAPP_PATH).toBe('/operaton/app');
  });

  it('does not double the slash when the public URL ends with one', () => {
    expect(cockpitProcessDefinitionUrl('https://operaton.example.org/', 'p:1:x')).toBe(
      'https://operaton.example.org/operaton/app/cockpit/default/#/process-definition/p:1:x',
    );
  });

  it('takes the public URL from camundaPublicUrl, falling back to the in-cluster base', () => {
    expect(camundaPublicUrl(config({ camundaPublicUrl: 'https://operaton.example.org/' }))).toBe(
      'https://operaton.example.org',
    );
    expect(camundaPublicUrl(config())).toBe(
      'http://operaton-oneke-operaton.z-p-operaton-oneke.svc.cluster.local:8080',
    );
  });
});

describe('camundaFetch', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('calls /engine-rest with HTTP Basic of the service account', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await camundaFetch(config(), '/process-definition?latestVersion=true');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://operaton-oneke-operaton.z-p-operaton-oneke.svc.cluster.local:8080/engine-rest/process-definition?latestVersion=true',
    );
    const expected = `Basic ${Buffer.from('operaton-admin-sa:secret').toString('base64')}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expected);
  });
});
