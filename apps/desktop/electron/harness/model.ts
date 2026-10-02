import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModel, ToolLoopAgentSettings } from 'ai'
import { REFUSAL_TYPE } from '@dalliance/shared/cloud'
import type { Effort, ModelList, ModelOption } from '@dalliance/shared/ipc'

/** A gateway id. Dalliance Cloud serves the gateway's models. */
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5'

/**
 * How to reach Dalliance Cloud's model proxy. It speaks AI Gateway's protocol, so the gateway provider talks to it,
 * with the account's Convex token in place of a key. See docs/cloud.md.
 */
export interface CloudAccess {
  /** The proxy, like `https://cloud.dalliance.io/api/ai`. */
  baseURL: string
  signedIn: () => boolean
  /** A token fetched per request, so a long run outlives any one token. Null when signed out. */
  token: () => Promise<string | null>
}

export interface ModelConfig {
  model: string
  effort: Effort
  cloud: CloudAccess
}

/** Models can't run until the user does something. The message says what. */
export class ModelSetupError extends Error {}

const SIGNED_OUT = 'Sign in to Dalliance to run prompts on your plan. Settings > Account.'

/** The access, or the reason it can't run. */
function signedIn(cloud: CloudAccess): CloudAccess {
  if (!cloud.signedIn()) throw new ModelSetupError(SIGNED_OUT)
  return cloud
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
      if (!token) return Response.json({ error: { message: SIGNED_OUT, type: REFUSAL_TYPE } }, { status: 401 })
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
  return { model: cloudGateway(signedIn(config.cloud))(config.model), providerOptions: agentProviderOptions(config) }
}

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * What a Claude model accepts for reasoning, from Anthropic's model docs. Adaptive thinking came with the 4.6
 * models, and xhigh with Opus 4.7. Opus 4.5 takes effort up to high but only budgeted thinking. Sonnet 4.5,
 * Haiku 4.5 and older reject effort, so they get neither. Takes gateway ids like `anthropic/claude-haiku-4.5`.
 * An unknown Claude id is taken to be newer than this list. Sonnet 5.5 is one: a live call showed it takes xhigh.
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
  if (config.model.startsWith('openai/')) {
    return { openai: { reasoningEffort: config.effort === 'low' || config.effort === 'medium' ? config.effort : 'high', reasoningSummary: 'auto' } }
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

let cache: { at: number; list: ModelList } | null = null
const CACHE_MS = 10 * 60_000

/** The language models Dalliance Cloud offers, for the model picker. Cached for ten minutes. */
export async function listModels(cloud: CloudAccess): Promise<ModelList> {
  let gateway: ReturnType<typeof createGateway>
  try {
    gateway = cloudGateway(signedIn(cloud))
  } catch (err) {
    return { models: [], error: (err as Error).message }
  }
  const hit = cache
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list
  let models: ModelOption[]
  try {
    const { models: entries } = await gateway.getAvailableModels()
    // No prices: the plan pays in credits, so dollar prices would only mislead
    models = entries
      .filter((m) => m.modelType == null || m.modelType === 'language')
      .map((m) => ({ id: m.id, name: m.name, maker: makerOf(m.id), description: m.description ?? undefined }))
  } catch (err) {
    return { models: [], error: `Couldn't load the model list: ${err instanceof Error ? err.message : String(err)}` }
  }
  const list = { models, error: null }
  cache = { at: Date.now(), list }
  return list
}
