import { useEntity } from '@backstage/plugin-catalog-react';
import { type CostsExtra, ServiceCosts } from '@internal/plugin-console';
import { useMemo } from 'react';
import { assistantLabel, systemsOf, tokensOf, usageCost, useAssistantUsage, useSystemsIndex } from './assistantUsage';
import { deploymentsCost, useDeployments, usePricing } from './openCost';

/**
 * The Costs tab of the console with what only the app knows: the deployments of the month of its namespace and the
 * questions to the AI assistants charged to it (by assistant and who asked), at our prices.
 */
export const ConsoleCosts = () => {
  const { entity } = useEntity();
  const system = entity.metadata.name.toLocaleLowerCase('en-US');
  const ns = entity.metadata.annotations?.['refresquito.io/namespace'];
  const pricing = usePricing();
  const usage = useAssistantUsage();
  const index = useSystemsIndex();
  const deployments = useDeployments();
  const costs = useMemo<CostsExtra>(() => {
    const m = new Map<string, { assistant: string; user?: string; questions: number; tokens: number; cost?: number }>();
    for (const g of usage.value?.groups ?? []) {
      const systems = systemsOf(g, index);
      if (!systems.includes(system)) continue;
      const share = 1 / systems.length;
      const cost = usageCost(g, pricing.assistants);
      const assistant = assistantLabel(g);
      const key = `${assistant}\u0000${g.user ?? ''}`;
      const prev = m.get(key) ?? { assistant, user: g.user, questions: 0, tokens: 0 };
      m.set(key, {
        ...prev,
        questions: prev.questions + g.questions * share,
        tokens: prev.tokens + tokensOf(g) * share,
        cost: cost === undefined ? prev.cost : (prev.cost ?? 0) + cost * share,
      });
    }
    const rows = [...m.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens);
    const count = ns ? deployments.value?.byNamespace.get(ns)?.count : undefined;
    return {
      currency: pricing.currency,
      ai: rows.length ? { rows, tokens: rows.reduce((t, r) => t + r.tokens, 0), cost: rows.some(r => r.cost !== undefined) ? rows.reduce((t, r) => t + (r.cost ?? 0), 0) : undefined } : undefined,
      deployments: deployments.value ? { count: count ?? 0, cost: deploymentsCost(count, pricing) } : undefined,
    };
  }, [usage.value, index, system, pricing, deployments.value, ns]);
  return <ServiceCosts costs={costs} />;
};
