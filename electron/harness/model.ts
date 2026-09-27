import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModel, ToolLoopAgentSettings } from 'ai'
import type { Effort, ModelList, ModelOption, Provider } from '../../src/shared/ipc'

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
  return { model, providerOptions: effortOptions(config) }
}

/**
 * How hard the model thinks. Anthropic models take adaptive thinking with an effort level, OpenAI reasoning
 * models take a reasoning effort, both also through the gateway. Other makers get their defaults.
 */
function effortOptions(config: ModelConfig): ToolLoopAgentSettings['providerOptions'] {
  if (config.provider === 'anthropic' || config.model.startsWith('anthropic/')) {
    return { anthropic: { thinking: { type: 'adaptive' }, effort: config.effort } }
  }
  if (config.model.startsWith('openai/')) {
    return { openai: { reasoningEffort: config.effort === 'low' || config.effort === 'medium' ? config.effort : 'high' } }
  }
  return undefined
}

const MAKERS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  // Grok models moved under SpaceX's prefix on the gateway
  spacexai: 'xAI',
  meta: 'Meta',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  alibaba: 'Alibaba',
  moonshotai: 'Moonshot AI',
  zai: 'Z.ai',
  amazon: 'Amazon',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  vercel: 'Vercel',
  minimax: 'MiniMax',
  nvidia: 'NVIDIA',
  tencent: 'Tencent',
  xiaomi: 'Xiaomi',
  sakana: 'Sakana',
  bytedance: 'ByteDance',
  inception: 'Inception',
  stepfun: 'StepFun',
  morph: 'Morph',
  poolside: 'Poolside',
  'arcee-ai': 'Arcee',
  fireworks: 'Fireworks',
  meituan: 'Meituan',
  'inference-net': 'Inference.net',
  inclusionai: 'inclusionAI',
  thinkingmachines: 'Thinking Machines',
  quiverai: 'Quiver AI',
  mixedbread: 'Mixedbread',
}

const makerOf = (id: string) => {
  const prefix = id.split('/')[0]
  return MAKERS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

/** "0.000003" per token reads as "$3" per million. */
function perMillion(perToken: string | undefined): string | null {
  const n = Number(perToken)
  if (!perToken || !Number.isFinite(n)) return null
  const m = n * 1_000_000
  return `$${m >= 10 || Number.isInteger(m) ? Math.round(m * 100) / 100 : m.toFixed(2)}`
}

const cache = new Map<string, { at: number; list: ModelList }>()
const CACHE_MS = 10 * 60_000

/** The language models the chosen provider offers, for the model picker. Cached for ten minutes. */
export async function listModels(config: ModelConfig): Promise<ModelList> {
  if (!config.apiKey) return { provider: config.provider, models: [], error: new MissingKeyError(config.provider).message }
  const key = `${config.provider}:${config.apiKey.slice(-6)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list
  let models: ModelOption[]
  try {
    if (config.provider === 'gateway') {
      const { models: entries } = await createGateway({ apiKey: config.apiKey }).getAvailableModels()
      models = entries
        .filter((m) => m.modelType == null || m.modelType === 'language')
        .map((m) => {
          const input = perMillion(m.pricing?.input)
          const output = perMillion(m.pricing?.output)
          return {
            id: m.id,
            name: m.name,
            maker: makerOf(m.id),
            description: m.description ?? undefined,
            price: input && output ? `${input} / ${output}` : undefined,
          }
        })
    } else {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (!res.ok) throw new Error(`Anthropic answered ${res.status}`)
      const body = (await res.json()) as { data: { id: string; display_name?: string }[] }
      models = body.data.map((m) => ({ id: m.id, name: m.display_name ?? m.id, maker: 'Anthropic' }))
    }
  } catch (err) {
    return { provider: config.provider, models: [], error: `Couldn't load the model list: ${err instanceof Error ? err.message : String(err)}` }
  }
  const list = { provider: config.provider, models, error: null }
  cache.set(key, { at: Date.now(), list })
  return list
}
