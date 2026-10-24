import { AssistantPage, type AssistantProfile } from './AssistantPage';

/**
 * The security assistant: questions about the security of one project or all of them — its vulnerabilities, its SBOM
 * and the licenses of its dependencies, its scorecard Quality & Security, its quality report and exceptions, its code
 * and its CI — answered by a model that looks with the READ-ONLY tools of the MCP server secassistant-oneke. A session
 * apart from the operations assistant. Opened from an entity with ?project=<name>.
 */
export const SEC: AssistantProfile = {
  path: '/sec',
  store: 'sec-assistant-conversation',
  title: 'Security assistant',
  subtitle: 'Vulnerabilities, SBOMs and licenses, quality and code of each project',
  intro:
    'It reads the catalog, the scorecard Quality & Security, the vulnerabilities, SBOMs and licenses of each project, ' +
    'its quality report and exceptions, and its code and CI, with read-only tools; it never changes anything.',
  examples: [
    'Which projects have a vulnerability in CISA KEV, and which of them are in use?',
    'Which dependencies carry a denied license, in which projects?',
    'Who uses openssl, and in which versions?',
    'Which checks of Quality & Security fail across the applications, and why?',
  ],
  placeholder: 'Ask about a project: its vulnerabilities, its SBOM and licenses, its scorecard, its code...',
  working: 'Looking at the project…',
  notConfigured: 'assistants.sec (model, MCP server secassistant-oneke, prompt) is not configured in this Backstage.',
  aboutProject: project => ({
    prefix: `About ${project}: `,
    examples: [
      `Which vulnerabilities of ${project} are out of the SLA, in KEV or in use? What should be fixed first?`,
      `Why does ${project} fail checks of Quality & Security, and how do I fix them?`,
      `Which licenses do the dependencies of ${project} carry? Is any of them denied or missing?`,
      `Summarize the security of ${project}: vulnerabilities, licenses, code findings, secrets and exceptions.`,
    ],
  }),
};

export const SecAssistantPage = () => <AssistantPage profile={SEC} />;
