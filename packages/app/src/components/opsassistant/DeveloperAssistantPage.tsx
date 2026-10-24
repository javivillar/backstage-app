import { AssistantPage, type AssistantProfile } from './AssistantPage';

/**
 * The chat of the developer assistant (read only): which changes of the approved specifications can be developed and
 * how, how a run of the workflow develop goes, what its pull requests contain. It never starts a run: launching is the
 * Backstage template "Implement a change (Developer Assistant)", whose link it gives with the form filled in. Its tools
 * are the MCP server developerassistant-oneke.
 */
export const DEVELOPER: AssistantProfile = {
  path: '/developer',
  store: 'developer-assistant-conversation',
  title: 'Developer assistant',
  subtitle: 'From an approved change to draft pull requests: what to develop, how, and how it goes',
  intro:
    'It reads the changes that can be developed, their architecture and the code of their application, follows the ' +
    'runs of the developer assistant on GitHub Actions and explains their pull requests. It never starts a run: to ' +
    'launch one it gives you the link of the template Implement a change (Create), with the form filled in.',
  examples: [
    'Which changes can I develop?',
    'How would you implement group 1 of change <change> of <system>?',
    'Give me the link to launch it',
    'How is the last run going, and what did it do?',
  ],
  placeholder: 'Ask what to develop, how, or how a run goes...',
  working: 'Looking…',
  notConfigured:
    'assistants.developer (model, MCP server developerassistant-oneke, prompt) is not configured in this Backstage.',
};

export const DeveloperAssistantPage = () => <AssistantPage profile={DEVELOPER} />;
