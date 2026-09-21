import { Config } from '@backstage/config';
import { DatahubSettings } from './datahubClient';
import { createIssue, findOpenIssue, githubToken } from './githubIssues';
import { VocabularyResult, loadVocabulary } from './vocabulary';

// "Request vocabulary" (design §9): a developer who needs a domain / glossary term / tag / allowed value that does
// not exist asks the stewards; they NEVER get the privilege to create it (the service account cannot either).
// The request becomes a GitHub issue that a steward closes after creating the item in DataHub.

export type VocabularyKind = 'domain' | 'glossaryTerm' | 'tag' | 'structuredPropertyValue';
export const VOCABULARY_KINDS: VocabularyKind[] = ['domain', 'glossaryTerm', 'tag', 'structuredPropertyValue'];

export const DEFAULT_REPO = 'javivillar/refresquito-services';
export const DEFAULT_LABEL = 'datahub-vocabulary';

const KIND_LABEL: Record<VocabularyKind, string> = {
  domain: 'Domain',
  glossaryTerm: 'Glossary term',
  tag: 'Tag',
  structuredPropertyValue: 'Allowed value of a structured property',
};

export interface VocabularyRequest {
  kind: VocabularyKind;
  name: string;
  description: string;
  justification: string;
  /** For structuredPropertyValue: e.g. refresquito.lawful_basis. */
  property?: string;
  relatedProduct?: string;
}

export class VocabularyRequestError extends Error {}

export interface RequestSettings {
  repo: string;
  label: string;
}

export function requestSettings(config: Config): RequestSettings {
  const c = config.getOptionalConfig('datahub.vocabularyRequests');
  return { repo: c?.getOptionalString('repo') ?? DEFAULT_REPO, label: c?.getOptionalString('label') ?? DEFAULT_LABEL };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/** Where the requested thing already exists (so we tell the user instead of opening a duplicate request). */
export function existingMatch(req: VocabularyRequest, vocab: VocabularyResult): string | undefined {
  const name = norm(req.name);
  const pick = (list: Array<{ urn: string; name: string }>) => list.find(x => norm(x.name) === name || norm(x.urn.split(':').pop() ?? '') === name)?.urn;
  switch (req.kind) {
    case 'domain':
      return pick(vocab.domains);
    case 'glossaryTerm':
      return pick(vocab.glossaryTerms);
    case 'tag':
      return pick(vocab.tags);
    case 'structuredPropertyValue': {
      const p = vocab.structuredProperties.find(x => x.qualifiedName === req.property);
      return p?.allowedValues.some(v => v !== undefined && norm(String(v)) === name) ? `${req.property}=${req.name}` : undefined;
    }
    default:
      return undefined;
  }
}

export function validateRequest(req: VocabularyRequest, vocab: VocabularyResult): string[] {
  const errors: string[] = [];
  if (!VOCABULARY_KINDS.includes(req.kind)) errors.push(`kind must be one of ${VOCABULARY_KINDS.join(', ')}`);
  if (!req.name?.trim() || req.name.length > 120) errors.push('name is required (max 120 characters)');
  if (!req.description?.trim()) errors.push('description is required: say what it means, so a steward can define it');
  if (!req.justification?.trim()) errors.push('justification is required: why the existing vocabulary is not enough');
  if (req.kind === 'structuredPropertyValue') {
    if (!req.property) errors.push('property is required for a structured-property value');
    else if (!vocab.structuredProperties.some(p => p.qualifiedName === req.property)) errors.push(`unknown structured property ${req.property}`);
  }
  return errors;
}

export function buildIssue(req: VocabularyRequest, requester: { entityRef: string; email: string }, publicUrl: string): { title: string; body: string } {
  const title = `[DataHub vocabulary] ${KIND_LABEL[req.kind]}: ${req.name.trim()}`;
  const lines = [
    `**Requested by:** ${requester.entityRef} (${requester.email})`,
    `**Kind:** ${KIND_LABEL[req.kind]}`,
    `**Name:** ${req.name.trim()}`,
    ...(req.property ? [`**Property:** \`${req.property}\``] : []),
    ...(req.relatedProduct ? [`**Related data product:** ${req.relatedProduct}`] : []),
    '',
    '### Definition',
    req.description.trim(),
    '',
    '### Why the existing vocabulary is not enough',
    req.justification.trim(),
    '',
    '---',
    `Steward: create it in DataHub (${publicUrl}), then close this issue and tell the requester. `,
    'Developers cannot create vocabulary themselves and neither can the Backstage service account (by design).',
    '_Created from the Backstage template "Request DataHub vocabulary"._',
  ];
  return { title, body: lines.join('\n') };
}

export interface RequestResult {
  dryRun: boolean;
  title: string;
  body: string;
  issueUrl?: string;
  issueNumber?: number;
  alreadyRequested: boolean;
}

/** Validates, refuses what already exists, de-duplicates against open issues, then opens the issue (unless dryRun). */
export async function requestVocabulary(
  config: Config,
  settings: DatahubSettings,
  req: VocabularyRequest,
  requester: { entityRef: string; email: string },
  dryRun: boolean,
): Promise<RequestResult> {
  const vocab = await loadVocabulary(settings);
  const errors = validateRequest(req, vocab);
  if (errors.length) throw new VocabularyRequestError(`The request is not valid:\n - ${errors.join('\n - ')}`);
  const exists = existingMatch(req, vocab);
  if (exists) throw new VocabularyRequestError(`"${req.name}" already exists in DataHub (${exists}): use it instead of requesting it.`);

  const { title, body } = buildIssue(req, requester, settings.publicUrl);
  if (dryRun) return { dryRun: true, title, body, alreadyRequested: false };

  const token = githubToken(config);
  if (!token) throw new VocabularyRequestError('No GitHub token configured (integrations.github), so the request cannot be filed.');
  const { repo, label } = requestSettings(config);
  const dup = await findOpenIssue(token, repo, label, title);
  if (dup) return { dryRun: false, title, body, issueUrl: dup.url, issueNumber: dup.number, alreadyRequested: true };
  const issue = await createIssue(token, repo, title, body, [label]);
  return { dryRun: false, title, body, issueUrl: issue.url, issueNumber: issue.number, alreadyRequested: false };
}
