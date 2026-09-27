import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModel, ToolLoopAgentSettings } from 'ai'
import type { Effort, Provider } from '../../src/shared/ipc'

export const DEFAULT_MODELS: Record<Provider, string> = {
  gateway: 'anthropic/claude-opus-5',
  anthropic: 'claude-opus-5',
}

export interface ModelConfig {
  provider: Provider
  model: string
  effort: Effort
  apiKey: string | null
}

export class MissingKeyError extends Error {
  constructor(provider: Provider) {
    super(
      provider === 'gateway'
        ? 'Add an AI Gateway key in Settings to run prompts.'
        : 'Add an Anthropic API key in Settings to run prompts.',
    )
  }
}

export function resolveModel(config: ModelConfig): {
  model: LanguageModel
  providerOptions: ToolLoopAgentSettings['providerOptions']
} {
  if (!config.apiKey) throw new MissingKeyError(config.provider)
  const model =
    config.provider === 'gateway'
      ? createGateway({ apiKey: config.apiKey })(config.model)
      : createAnthropic({ apiKey: config.apiKey })(config.model)
  // Anthropic options also pass through the gateway to Anthropic models
  const isAnthropic = config.provider === 'anthropic' || config.model.startsWith('anthropic/')
  return {
    model,
    providerOptions: isAnthropic ? { anthropic: { thinking: { type: 'adaptive' }, effort: config.effort } } : undefined,
  }
}
