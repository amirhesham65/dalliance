import { createAnthropic } from '@ai-sdk/anthropic'
import { GatewayError, createGateway } from '@ai-sdk/gateway'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, ToolLoopAgentSettings } from 'ai'
import { type Effort, type KeyCheck, type ModelList, type ModelOption, type Provider, isOllama } from '@dalliance/shared/ipc'
import { checkOllama, listOllamaModels, ollamaBaseURL, probeOllamaModels } from './ollama'

export const DEFAULT_MODELS: Record<Provider, string> = {
  gateway: 'anthropic/claude-opus-5',
  anthropic: 'claude-opus-5',
  'ollama-cloud': 'gpt-oss:120b',
  'ollama-local': 'llama3.2:3b',
}

/** Ollama on this machine is the one provider that takes no key. */
export const needsKey = (provider: Provider) => provider !== 'ollama-local'

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
        : provider === 'anthropic'
          ? 'Add an Anthropic API key in Settings to run prompts.'
          : 'Add an Ollama API key in Settings to run prompts.',
    )
  }
}

export function resolveModel(config: ModelConfig): {
  model: LanguageModel
  providerOptions: ToolLoopAgentSettings['providerOptions']
} {
  if (!config.apiKey && needsKey(config.provider)) throw new MissingKeyError(config.provider)
  return { model: createModel(config), providerOptions: effortOptions(config) }
}

function createModel(config: ModelConfig): LanguageModel {
  if (isOllama(config.provider)) {
    // Ollama serves the OpenAI chat API next to its own, which carries tool calls the same way
    return createOpenAICompatible({ name: 'ollama', baseURL: ollamaBaseURL(config.provider), apiKey: config.apiKey ?? undefined })(config.model)
  }
  if (config.provider === 'gateway') return createGateway({ apiKey: config.apiKey! })(config.model)
  return createAnthropic({ apiKey: config.apiKey! })(config.model)
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

const REJECTED = 'The provider turned this key down. Check that you copied all of it.'
const CHECK_MS = 10_000

/** The gateway's balance call takes no abort signal, so the deadline races it instead. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer in ${ms / 1000} seconds`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/**
 * Whether a key works, before it is saved. The gateway reports its credit balance, which also proves the key.
 * Anthropic has no balance endpoint, so listing one model does. A network failure is `unchecked`, not a rejection.
 */
export async function checkKey(provider: Provider, apiKey: string): Promise<KeyCheck> {
  const key = apiKey.trim()
  if (provider === 'ollama-local') return checkOllama(provider, key)
  if (!key) return { status: 'rejected', detail: 'Paste a key first.' }
  if (provider === 'ollama-cloud') return checkOllama(provider, key)
  try {
    if (provider === 'gateway') {
      const { balance } = await within(createGateway({ apiKey: key }).getCredits(), CHECK_MS)
      const amount = Number(balance)
      return { status: 'ok', detail: Number.isFinite(amount) ? `$${amount.toFixed(2)} in credits` : null }
    }
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(CHECK_MS),
    })
    if (res.status === 401 || res.status === 403) return { status: 'rejected', detail: REJECTED }
    if (!res.ok) return { status: 'unchecked', detail: `Anthropic answered ${res.status}` }
    return { status: 'ok', detail: null }
  } catch (err) {
    if (GatewayError.isInstance(err) && (err.statusCode === 401 || err.statusCode === 403)) return { status: 'rejected', detail: REJECTED }
    return { status: 'unchecked', detail: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
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
  if (!config.apiKey && needsKey(config.provider)) return { provider: config.provider, models: [], error: new MissingKeyError(config.provider).message }
  const key = `${config.provider}:${config.apiKey?.slice(-6) ?? ''}`
  const hit = cache.get(key)
  // What's pulled onto this machine changes whenever the user runs `ollama pull`, so that list is never cached
  if (hit && config.provider !== 'ollama-local' && Date.now() - hit.at < CACHE_MS) return hit.list
  let models: ModelOption[]
  try {
    if (isOllama(config.provider)) {
      models = await listOllamaModels(config.provider, config.apiKey)
    } else if (config.provider === 'gateway') {
      const { models: entries } = await createGateway({ apiKey: config.apiKey! }).getAvailableModels()
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
        headers: { 'x-api-key': config.apiKey!, 'anthropic-version': '2023-06-01' },
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

const probed = new Map<string, { at: number; list: ModelList }>()

/**
 * The model list with the models the key's plan doesn't run marked `locked`. Only Ollama Cloud plans differ this way,
 * so every other provider gets its list back as it is. Trying every model takes a while, so the answer is cached.
 */
export async function probeModels(config: ModelConfig): Promise<ModelList> {
  const list = await listModels(config)
  if (config.provider !== 'ollama-cloud' || !config.apiKey || list.error) return list
  const key = config.apiKey.slice(-6)
  const hit = probed.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list
  const result = { ...list, models: await probeOllamaModels(config.apiKey, list.models) }
  probed.set(key, { at: Date.now(), list: result })
  return result
}
