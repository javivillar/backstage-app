import { AssistantPage, type AssistantProfile } from './AssistantPage';

/**
 * The architect assistant: from the approved specification (OpenSpec) of a system, its architecture with the services
 * of Refresquito — the manifest instantiation.yaml, validated with add-python-app.py --from exactly as the developer will
 * run it, and the Architecture Design with the template of the platform — written on a branch of refresquito-specs for
 * security to review and a person to approve by merging. Its tools are the MCP server architectassistant-oneke.
 */
export const ARCHITECT: AssistantProfile = {
  role: { does: 'Designs only with platform blocks; installation dossier and DR plan', reads: 'the approved specification', writes: 'architecture, manifest, DR plan', never: 'chooses a product outside the catalogue' },
  path: '/architect',
  store: 'architect-assistant-conversation',
  title: 'Architect assistant',
  subtitle: 'The architecture of a system, from its approved specification to the application to instantiate',
  intro:
    'It designs the solution of a system whose specification is approved, with the services of the platform only, ' +
    'validates its manifest with the same script that instantiates it, and writes the Architecture Design with the ' +
    'template in refresquito-specs; security reviews it and you approve it by merging its pull request.',
  examples: [
    'Which systems can I design?',
    'Design the architecture of <system>',
    'What does the platform offer for human approvals and for documents shared with a team?',
    'Which classification may the data of a system have in nato-sirtap?',
  ],
  placeholder: 'Name the system to design, or ask about the platform and its rules...',
  working: 'Designing…',
  notConfigured:
    'assistants.architect (model, MCP server architectassistant-oneke, prompt) is not configured in this Backstage.',
};

export const ArchitectAssistantPage = () => <AssistantPage profile={ARCHITECT} />;
