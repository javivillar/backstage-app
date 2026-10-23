/**
 * Which model answers, from app-config (opsAssistant.model). The only place, with the adapter itself, that names a
 * provider: to add one (a model on the operator's machine, behind its own API), write src/model/<id>.ts implementing
 * ModelProvider and add a case here.
 *
 *   opsAssistant:
 *     model:
 *       provider: anthropic        # the adapter
 *       name: claude-opus-5-5
 *       effort: high
 *       apiKey: ${ANTHROPIC_API_KEY}
 *       baseUrl: ""                # optional: an endpoint of the zone
 */
import type { Config } from '@backstage/config';
import { AnthropicProvider } from './anthropic';
import type { ModelProvider } from './types';

export * from './types';

export function providerFromConfig(config: Config | undefined): ModelProvider | undefined {
  if (!config) return undefined;
  const provider = config.getOptionalString('provider') ?? 'anthropic';
  switch (provider) {
    case 'anthropic': {
      const apiKey = config.getOptionalString('apiKey') ?? '';
      if (!apiKey) return undefined;
      return new AnthropicProvider({
        apiKey,
        model: config.getOptionalString('name') ?? 'claude-opus-5-5',
        effort: config.getOptionalString('effort') as never,
        maxTokens: config.getOptionalNumber('maxTokens'),
        baseURL: config.getOptionalString('baseUrl') || undefined,
      });
    }
    default:
      throw new Error(`opsAssistant.model.provider ${provider}: no adapter for it (src/model/index.ts)`);
  }
}
