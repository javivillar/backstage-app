import { AssistantPage, type AssistantProfile } from './AssistantPage';

/**
 * The operations assistant: questions about operating the platform and troubleshooting the cluster, answered by a
 * model that looks with READ-ONLY tools (Kubernetes, Argo CD, events, logs, Prometheus, Loki, docs). It proposes;
 * the operator acts.
 */
export const OPS: AssistantProfile = {
  path: '',
  store: 'ops-assistant-conversation',
  title: 'Operations assistant',
  subtitle: 'Operate and troubleshoot the platform',
  intro: 'It looks at the cluster with read-only tools and proposes what to do; it never changes anything.',
  examples: [
    'How is the platform? Anything I should look at now?',
    'Why is Loki restarting and how do I fix it?',
    'Which Argo CD applications are not synced or healthy, and why?',
    'How do I add a new Python application to the platform?',
  ],
  placeholder: 'Ask about the cluster: a failing pod, an application out of sync, how to do something...',
  working: 'Looking at the cluster…',
  notConfigured: 'opsAssistant (model, MCP server, prompt) is not configured in this Backstage.',
};

export const OpsAssistantPage = () => <AssistantPage profile={OPS} />;
