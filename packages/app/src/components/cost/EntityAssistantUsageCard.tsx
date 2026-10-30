import { useMemo } from 'react';
import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { money, usePricing } from './openCost';
import { systemsOf, tokens, tokensOf, usageCost, useAssistantUsage, userName, useSystemsIndex } from './assistantUsage';

/**
 * What the assistants consumed this month about a system (its page): the questions charged to it (chosen in the page
 * of the assistant, or worked out from what its tools looked at), by assistant and who asked. Our prices, not a bill.
 */
export const EntityAssistantUsageCard = () => {
  const { entity } = useEntity();
  const system = entity.metadata.name.toLocaleLowerCase('en-US');
  const pricing = usePricing();
  const usage = useAssistantUsage();
  const index = useSystemsIndex();

  const lines = useMemo(() => {
    const m = new Map<string, { assistant: string; user?: string; questions: number; tokens: number; cost?: number }>();
    for (const g of usage.value?.groups ?? []) {
      const systems = systemsOf(g, index);
      if (!systems.includes(system)) continue;
      const share = 1 / systems.length;
      const cost = usageCost(g, pricing.assistants);
      const key = `${g.assistant}\u0000${g.user ?? ''}`;
      const prev = m.get(key) ?? { assistant: g.assistant, user: g.user, questions: 0, tokens: 0 };
      m.set(key, {
        ...prev,
        questions: prev.questions + g.questions * share,
        tokens: prev.tokens + tokensOf(g) * share,
        cost: cost === undefined ? prev.cost : (prev.cost ?? 0) + cost * share,
      });
    }
    return [...m.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens);
  }, [usage.value, index, system, pricing.assistants]);

  let body;
  if (usage.loading) body = <Progress />;
  else if (usage.error) body = <WarningPanel severity="info" title="Not available" message={usage.error.message} />;
  else if (!lines.length) body = <div>No question to the assistants about this system this month.</div>;
  else {
    const total = lines.reduce((s, l) => s + (l.cost ?? 0), 0);
    const priced = lines.some(l => l.cost !== undefined);
    body = (
      <>
        <div style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1.25 }}>
          {priced ? money(total, pricing.currency) : `${tokens(lines.reduce((s, l) => s + l.tokens, 0))} tokens`}
        </div>
        <div style={{ fontSize: '0.85rem', opacity: 0.75, marginBottom: 8 }}>
          {Math.round(lines.reduce((s, l) => s + l.questions, 0))} questions this month
        </div>
        {lines.map(l => (
          <div key={`${l.assistant}/${l.user ?? ''}`} style={{ fontSize: '0.9rem' }}>
            {l.assistant} · {userName(l.user)}: {Math.round(l.questions)} q. · {tokens(l.tokens)} tokens
            {l.cost !== undefined ? ` · ${money(l.cost, pricing.currency)}` : ''}
          </div>
        ))}
      </>
    );
  }
  return (
    <InfoCard
      title="Assistants this month"
      subheader="What the assistants consumed about this system, at our prices (not a bill)"
      deepLink={{ title: 'All costs', link: '/costs' }}
    >
      {body}
      <div style={{ marginTop: 12, fontSize: '0.8rem', opacity: 0.7 }}>
        A question is charged to the system chosen in the page of the assistant, else to the systems its tools looked
        at, in equal parts. <Link to="/costs">Compare with the others</Link>.
      </div>
    </InfoCard>
  );
};
