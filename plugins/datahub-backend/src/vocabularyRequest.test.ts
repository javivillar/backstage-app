import { ConfigReader } from '@backstage/config';
import { DatahubSettings } from './datahubClient';
import { VocabularyRequest, VocabularyRequestError, buildIssue, existingMatch, requestVocabulary, validateRequest } from './vocabularyRequest';
import { VocabularyResult } from './vocabulary';

const settings = { baseUrl: 'http://gms', token: 't', publicUrl: 'http://dh' } as DatahubSettings;
const vocab: VocabularyResult = {
  domains: [{ urn: 'urn:li:domain:sales', name: 'Sales' }],
  glossaryTerms: [{ urn: 'urn:li:glossaryTerm:net-revenue', name: 'Net Revenue' }],
  tags: [{ urn: 'urn:li:tag:gold', name: 'Gold' }],
  structuredProperties: [{ urn: 'x', qualifiedName: 'refresquito.lawful_basis', allowedValues: ['Consent', 'Contract'] }],
};
const req = (over: Partial<VocabularyRequest> = {}): VocabularyRequest => ({
  kind: 'glossaryTerm',
  name: 'Churn risk',
  description: 'Probability a customer stops ordering in the next 90 days.',
  justification: 'Needed by the retention dashboard; "churn" only covers past behaviour.',
  ...over,
});
const requester = { entityRef: 'user:default/test-b', email: 'b@x.com' };
const config = (token?: string) => new ConfigReader({ integrations: { github: [{ host: 'github.com', ...(token ? { token } : {}) }] } });

describe('validateRequest / existingMatch', () => {
  it('requires name, description and justification', () => {
    expect(validateRequest(req({ name: '', description: '', justification: '' }), vocab)).toHaveLength(3);
    expect(validateRequest(req(), vocab)).toEqual([]);
  });
  it('a structured-property value needs a known property', () => {
    expect(validateRequest(req({ kind: 'structuredPropertyValue' }), vocab).join()).toMatch(/property is required/);
    expect(validateRequest(req({ kind: 'structuredPropertyValue', property: 'nope' }), vocab).join()).toMatch(/unknown structured property/);
  });
  it('spots what already exists, ignoring case, spaces, dashes and underscores', () => {
    expect(existingMatch(req({ kind: 'glossaryTerm', name: 'net-revenue' }), vocab)).toBe('urn:li:glossaryTerm:net-revenue');
    expect(existingMatch(req({ kind: 'domain', name: ' SALES ' }), vocab)).toBe('urn:li:domain:sales');
    expect(existingMatch(req({ kind: 'tag', name: 'silver' }), vocab)).toBeUndefined();
    expect(existingMatch(req({ kind: 'structuredPropertyValue', property: 'refresquito.lawful_basis', name: 'consent' }), vocab)).toBe('refresquito.lawful_basis=consent');
  });
});

describe('buildIssue', () => {
  it('names the requester and tells the steward what to do', () => {
    const { title, body } = buildIssue(req({ relatedProduct: 'pedidos-web' }), requester, 'http://dh');
    expect(title).toBe('[DataHub vocabulary] Glossary term: Churn risk');
    expect(body).toContain('user:default/test-b (b@x.com)');
    expect(body).toContain('pedidos-web');
    expect(body).toContain('Steward: create it in DataHub');
  });
});

function mockWorld(opts: { openIssues?: Array<{ number: number; html_url: string; title: string }> } = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, url: u, body: init?.body ? String(init.body) : undefined });
    const ok = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status }));
    if (u.endsWith('/api/graphql')) {
      const q = JSON.parse(String(init?.body)).query as string;
      const results = (list: unknown[]) => ok({ data: { searchAcrossEntities: { searchResults: list.map(entity => ({ entity })) } } });
      if (q.includes('[DOMAIN]')) return results([{ urn: 'urn:li:domain:sales', properties: { name: 'Sales' } }]);
      if (q.includes('[GLOSSARY_TERM]')) return results([{ urn: 'urn:li:glossaryTerm:net-revenue', name: 'net-revenue', properties: { name: 'Net Revenue' } }]);
      if (q.includes('[TAG]')) return results([]);
      return results([{ urn: 'x', definition: { qualifiedName: 'refresquito.lawful_basis', allowedValues: [{ value: { stringValue: 'Consent' } }] } }]);
    }
    if (u.includes('api.github.com') && method === 'GET') return ok(opts.openIssues ?? []);
    if (u.includes('api.github.com') && method === 'POST') return ok({ number: 42, html_url: 'https://github.com/o/r/issues/42' }, 201);
    return ok({}, 500);
  }) as unknown as typeof fetch;
  return calls;
}

describe('requestVocabulary', () => {
  it('dryRun renders the issue and touches neither GitHub nor DataHub writes', async () => {
    const calls = mockWorld();
    const r = await requestVocabulary(config('tok'), settings, req(), requester, true);
    expect(r.dryRun).toBe(true);
    expect(r.title).toContain('Churn risk');
    expect(calls.some(c => c.url.includes('api.github.com'))).toBe(false);
  });

  it('refuses to request something that already exists', async () => {
    mockWorld();
    await expect(requestVocabulary(config('tok'), settings, req({ name: 'Net Revenue' }), requester, false)).rejects.toBeInstanceOf(VocabularyRequestError);
  });

  it('opens one labelled issue', async () => {
    const calls = mockWorld();
    const r = await requestVocabulary(config('tok'), settings, req(), requester, false);
    expect(r.issueUrl).toBe('https://github.com/o/r/issues/42');
    expect(r.alreadyRequested).toBe(false);
    const post = calls.find(c => c.method === 'POST' && c.url.includes('/issues'))!;
    expect(post.url).toContain('/repos/javivillar/refresquito-services/issues');
    expect(JSON.parse(post.body!).labels).toEqual(['datahub-vocabulary']);
  });

  it('does not duplicate: an open issue with the same title is returned instead', async () => {
    const calls = mockWorld({ openIssues: [{ number: 7, html_url: 'https://github.com/o/r/issues/7', title: '[DataHub vocabulary] Glossary term: Churn risk' }] });
    const r = await requestVocabulary(config('tok'), settings, req(), requester, false);
    expect(r.alreadyRequested).toBe(true);
    expect(r.issueNumber).toBe(7);
    expect(calls.some(c => c.method === 'POST' && c.url.includes('api.github.com'))).toBe(false);
  });

  it('needs the GitHub token, and says so', async () => {
    mockWorld();
    await expect(requestVocabulary(config(), settings, req(), requester, false)).rejects.toThrow(/No GitHub token/);
  });
});
