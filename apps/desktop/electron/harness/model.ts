import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel, ToolLoopAgentSettings } from 'ai'
import { DEFAULT_MODELS, MODELS, normalizeModel, providerOf, PROVIDER_NAMES, type ProviderId } from '@dalliance/shared/models'
import { rememberSecret } from '../secrets'
import type { Effort, ModelList } from '@dalliance/shared/ipc'

export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic

export interface ModelConfig {
  model: string
  effort: Effort
  key: (provider: ProviderId) => string | null
}

export class ModelSetupError extends Error {}

/** Requests leave the main process directly for the selected provider. */
export function resolveModel(config: ModelConfig): {
  model: LanguageModel
  providerOptions: ToolLoopAgentSettings['providerOptions']
} {
  const id = normalizeModel(config.model)
  const provider = providerOf(id)
  const modelId = id.slice(id.indexOf('/') + 1)
  if (!provider || !modelId || /[\s/]/.test(modelId)) throw new ModelSetupError('Choose an Anthropic, Google, or OpenAI model in Settings > Models.')
  const apiKey = config.key(provider)
  if (!apiKey) throw new ModelSetupError(`Add your ${PROVIDER_NAMES[provider]} API key in Settings > Models to run prompts.`)
  rememberSecret(apiKey)
  const model = provider === 'anthropic' ? createAnthropic({ apiKey })(modelId)
    : provider === 'google' ? createGoogle({ apiKey })(modelId)
    : createOpenAI({ apiKey }).responses(modelId)
  return { model, providerOptions: agentProviderOptions({ ...config, model: id }) }
}

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * What a Claude model accepts for reasoning, from Anthropic's model docs. Adaptive thinking came with the 4.6
 * models, and xhigh with Opus 4.7. Opus 4.5 takes effort up to high but only budgeted thinking. Sonnet 4.5,
 * Haiku 4.5 and older reject effort, so they get neither. Takes provider-prefixed IDs like `anthropic/claude-haiku-4.5`.
 * Models outside the legacy cases use adaptive thinking and the current effort levels.
 */
export function claudeReasoning(model: string): { adaptive: boolean; efforts: readonly Effort[] } {
  const id = model.toLowerCase().replace(/^anthropic\//, '').replace(/\./g, '-')
  if (!id.startsWith('claude')) return { adaptive: false, efforts: [] }
  if (/^claude-opus-4-5\b/.test(id)) return { adaptive: false, efforts: ['low', 'medium', 'high'] }
  if (/^claude-(?:opus|sonnet)-4-6\b/.test(id)) return { adaptive: true, efforts: ['low', 'medium', 'high', 'max'] }
  if (/^claude-(?:instant|[123])\b|^claude-(?:sonnet|haiku)-4-5\b|^claude-opus-4-1\b|^claude-(?:opus|sonnet)-4(?:$|-0\b|[-@]\d{8})/.test(id)) {
    return { adaptive: false, efforts: [] }
  }
  return { adaptive: true, efforts: EFFORTS }
}

/** The chosen effort, or the nearest level below it that the model takes. */
function supportedEffort(effort: Effort, allowed: readonly Effort[]): Effort {
  for (let i = EFFORTS.indexOf(effort); i >= 0; i--) if (allowed.includes(EFFORTS[i])) return EFFORTS[i]
  return allowed[0]
}

/**
 * Options for the agent's requests. Anthropic models take adaptive thinking with an effort level where the model
 * supports them (see claudeReasoning), OpenAI reasoning models take a reasoning effort. Both are asked for
 * reasoning summaries, which the run keeps per step. Other makers get their defaults.
 *
 * Every Anthropic model also gets automatic caching: a top-level cacheControl puts a breakpoint on the last block
 * of every request, so each step of a cell reads the steps before it from the cache. It marks no message, so the
 * history the model sees stays append-only.
 */
export function agentProviderOptions(config: Pick<ModelConfig, 'model' | 'effort'>): ToolLoopAgentSettings['providerOptions'] {
  if (config.model.startsWith('anthropic/')) {
    const reasoning = claudeReasoning(config.model)
    return {
      anthropic: {
        // Summarized, so each step's reasoning can be kept with the run. See docs/agent-harness.md
        ...(reasoning.adaptive ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
        ...(reasoning.efforts.length ? { effort: supportedEffort(config.effort, reasoning.efforts) } : {}),
        cacheControl: { type: 'ephemeral' },
        // One tool call per step: finish must never race the run_cell it reports on
        disableParallelToolUse: true,
      },
    }
  }
  if (/^openai\/(gpt-[56]|o[134])/.test(config.model)) {
    return { openai: { reasoningEffort: config.effort === 'low' || config.effort === 'medium' ? config.effort : 'high', reasoningSummary: 'auto' } }
  }
  return undefined
}


/** The local catalog, limited to configured providers. Custom selections are kept separately. */
export function listModels(key: ModelConfig['key']): ModelList {
  return { models: MODELS.filter((model) => {
    const provider = providerOf(model.id)
    return provider != null && Boolean(key(provider))
  }), error: null }
}
