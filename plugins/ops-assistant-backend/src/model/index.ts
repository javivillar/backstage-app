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
import { OpenAICompatibleProvider } from './openaiCompatible';
import type { ModelProvider } from './types';

export * from './types';

/** a string that may be empty (an env var with no value): undefined then, never a config error */
function optional(config: Config, key: string): string | undefined {
  try {
    return config.getOptionalString(key) || undefined;
  } catch {
    return undefined;
  }
}

export function providerFromConfig(config: Config | undefined): ModelProvider | undefined {
  if (!config) return undefined;
  const provider = config.getOptionalString('provider') ?? 'anthropic';
  switch (provider) {
    case 'anthropic': {
      const apiKey = optional(config, 'apiKey') ?? '';
      if (!apiKey) return undefined;
      return new AnthropicProvider({
        apiKey,
        model: config.getOptionalString('name') ?? 'claude-opus-5-5',
        effort: config.getOptionalString('effort') as never,
        maxTokens: config.getOptionalNumber('maxTokens'),
        baseURL: optional(config, 'baseUrl'),
      });
    }
    // a model outside Claude with a chat-completions API (Ollama, vLLM, llama.cpp server, LM Studio): ARCHITECTURE.md §5
    case 'openai-compatible':
    case 'local': {
      const baseUrl = config.getOptionalString('baseUrl') ?? '';
      if (!baseUrl) throw new Error(`opsAssistant.model.provider ${provider} needs model.baseUrl`);
      return new OpenAICompatibleProvider({
        baseUrl,
        model: config.getOptionalString('name') ?? '',
        apiKey: optional(config, 'apiKey'),
        maxTokens: config.getOptionalNumber('maxTokens'),
        timeoutMs: config.getOptionalNumber('timeoutSeconds') !== undefined ? config.getNumber('timeoutSeconds') * 1000 : undefined,
        maxToolResultChars: config.getOptionalNumber('maxToolResultChars'),
      });
    }
    default:
      throw new Error(`opsAssistant.model.provider ${provider}: no adapter for it (src/model/index.ts)`);
  }
}
