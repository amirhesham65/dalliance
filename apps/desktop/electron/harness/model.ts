import { createAnthropic } from '@ai-sdk/anthropic'
import { GatewayError, createGateway } from '@ai-sdk/gateway'
import type { LanguageModel, ToolLoopAgentSettings } from 'ai'
import type { Effort, KeyCheck, KeyProvider, ModelList, ModelOption, Provider } from '@dalliance/shared/ipc'

export const DEFAULT_MODELS: Record<Provider, string> = {
  gateway: 'anthropic/claude-opus-5',
  anthropic: 'claude-opus-5',
  cloud: 'anthropic/claude-opus-5',
}

/**
 * How to reach Dalliance Cloud's model proxy, in builds that have it. The proxy speaks AI Gateway's protocol, so
 * the gateway provider talks to it, with the account's Convex token in place of a key. See docs/cloud.md.
 */
export interface CloudAccess {
  /** The proxy, like `https://cloud.dalliance.io/api/ai`. */
  baseURL: string
  signedIn: () => boolean
  /** A token fetched per request, so a long run outlives any one token. Null when signed out. */
  token: () => Promise<string | null>
}

export interface ModelConfig {
  provider: Provider
  model: string
  effort: Effort
  apiKey: string | null
  /** Null in builds without Dalliance Cloud. */
  cloud?: CloudAccess | null
}

/** Models can't run until the user does something in Settings. The message says what. */
export class ModelSetupError extends Error {}

export class MissingKeyError extends ModelSetupError {
  constructor(provider: KeyProvider) {
    super(
      provider === 'gateway'
        ? 'Add an AI Gateway key in Settings to run prompts.'
        : 'Add an Anthropic API key in Settings to run prompts.',
    )
  }
}

const SIGNED_OUT = 'Sign in to Dalliance to run prompts on your plan. Settings > Account.'

/** The access for a config set to Dalliance Cloud, or the reason it can't run. */
function cloudAccess(config: ModelConfig): CloudAccess {
  if (!config.cloud) throw new ModelSetupError("This build of Dalliance doesn't include Dalliance Cloud. Choose another provider in Settings.")
  if (!config.cloud.signedIn()) throw new ModelSetupError(SIGNED_OUT)
  return config.cloud
}

/** The gateway provider pointed at Dalliance Cloud's proxy, with the account's token put on each request. */
export function cloudGateway(access: CloudAccess) {
  return createGateway({
    baseURL: access.baseURL,
    // The provider wants a key up front; each request replaces it with the current token
    apiKey: 'dalliance-cloud',
    fetch: async (input, init) => {
      const token = await access.token()
      // Answered in the proxy's own error shape, so the SDK shows the message as written
      if (!token) return Response.json({ error: { message: SIGNED_OUT, type: 'dalliance_account' } }, { status: 401 })
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers })
    },
  })
}

export function resolveModel(config: ModelConfig): {
  model: LanguageModel
  providerOptions: ToolLoopAgentSettings['providerOptions']
} {
  if (config.provider === 'cloud') return { model: cloudGateway(cloudAccess(config))(config.model), providerOptions: agentProviderOptions(config) }
  if (!config.apiKey) throw new MissingKeyError(config.provider)
  const model =
    config.provider === 'gateway'
      ? createGateway({ apiKey: config.apiKey })(config.model)
      : createAnthropic({ apiKey: config.apiKey })(config.model)
  return { model, providerOptions: agentProviderOptions(config) }
}

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * What a Claude model accepts for reasoning, from Anthropic's model docs. Adaptive thinking came with the 4.6
 * models, and xhigh with Opus 4.7. Opus 4.5 takes effort up to high but only budgeted thinking. Sonnet 4.5,
 * Haiku 4.5 and older reject effort, so they get neither. Gateway ids like `anthropic/claude-haiku-4.5` count too.
 * An unknown Claude id is taken to be newer than this list.
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
 * supports them (see claudeReasoning), OpenAI reasoning models take a reasoning effort, both also through the
 * gateway. Other makers get their defaults.
 *
 * Every Anthropic model also gets automatic caching: a top-level cacheControl puts a breakpoint on the last block
 * of every request, so each step of a cell reads the steps before it from the cache. It marks no message, so the
 * history the model sees stays append-only.
 */
export function agentProviderOptions(config: Pick<ModelConfig, 'provider' | 'model' | 'effort'>): ToolLoopAgentSettings['providerOptions'] {
  if (config.provider === 'anthropic' || config.model.startsWith('anthropic/')) {
    const reasoning = claudeReasoning(config.model)
    return {
      anthropic: {
        ...(reasoning.adaptive ? { thinking: { type: 'adaptive' } } : {}),
        ...(reasoning.efforts.length ? { effort: supportedEffort(config.effort, reasoning.efforts) } : {}),
        cacheControl: { type: 'ephemeral' },
        // One tool call per step: finish must never race the run_cell it reports on
        disableParallelToolUse: true,
      },
    }
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
export async function checkKey(provider: KeyProvider, apiKey: string): Promise<KeyCheck> {
  const key = apiKey.trim()
  if (!key) return { status: 'rejected', detail: 'Paste a key first.' }
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
  let gateway: ReturnType<typeof createGateway> | null = null
  let key: string
  if (config.provider === 'cloud') {
    try {
      gateway = cloudGateway(cloudAccess(config))
    } catch (err) {
      return { provider: config.provider, models: [], error: (err as Error).message }
    }
    key = 'cloud'
  } else {
    if (!config.apiKey) return { provider: config.provider, models: [], error: new MissingKeyError(config.provider).message }
    if (config.provider === 'gateway') gateway = createGateway({ apiKey: config.apiKey })
    key = `${config.provider}:${config.apiKey.slice(-6)}`
  }
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list
  let models: ModelOption[]
  try {
    if (gateway) {
      const { models: entries } = await gateway.getAvailableModels()
      // Cloud models are paid for in credits, so dollar prices would only mislead
      const priced = config.provider !== 'cloud'
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
            price: priced && input && output ? `${input} / ${output}` : undefined,
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
