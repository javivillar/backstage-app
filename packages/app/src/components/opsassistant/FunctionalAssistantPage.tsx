import { AssistantPage, type AssistantProfile } from './AssistantPage';

/**
 * The functional assistant: what Refresquito is and what its services give a business, answered from the documentation
 * and code of every repository of the platform; and, when a user wants a new system, a specification (OpenSpec) written
 * with them step by step on a branch of refresquito-specs, closed as a pull request they approve by merging. Its tools
 * are the MCP server functionalassistant-oneke: it reads everything, and writes only specifications.
 */
export const FUNCTIONAL: AssistantProfile = {
  role: { does: 'Writes the specification of a system from the business need', reads: 'the need, the platform blocks', writes: 'OpenSpec: requirements and scenarios', never: 'designs or writes code' },
  path: '/functional',
  store: 'functional-assistant-conversation',
  title: 'Functional assistant',
  subtitle: 'What Refresquito gives a business, and the specification of a new system',
  intro:
    'It answers from the documentation and code of every repository of the platform. When you want a new system, it ' +
    'writes its specification with you, step by step, in refresquito-specs; you approve it by merging its pull request.',
  examples: [
    'What is Refresquito, and what does it give a business?',
    'Which services does the platform offer, and what is each one for?',
    'I need to keep documents of my customers and share them with my team: what does the platform offer?',
    'I want to build a new system to manage the orders of the shop',
  ],
  placeholder: 'Ask about the platform, or describe the system you need...',
  working: 'Reading the platform…',
  notConfigured:
    'assistants.functional (model, MCP server functionalassistant-oneke, prompt) is not configured in this Backstage.',
};

export const FunctionalAssistantPage = () => <AssistantPage profile={FUNCTIONAL} />;
