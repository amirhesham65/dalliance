import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import type { RunCost, StepUsage } from '@dalliance/shared/ipc'
import type { ModelConfig } from './model'

/**
 * What a run cost, for the Show costs setting. Own keys get dollars, estimated from the tokens each call used and
 * the model's list prices. Dalliance Cloud gets credits, which the service counts after each call, so the run only
 * names its calls. A model without a known price counts as tokens, never as a guessed amount.
 */

/** Dollars per token. A cache rate left out means the price list doesn't say. */
export interface TokenPrices {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** One model call, with the model it asked for: the id the price list knows, not the one the provider answered with. */
export interface ModelCall {
  model: string
  usage: StepUsage
  generationId: string | null
}

/** The AI SDK's usage as a StepUsage. Its inputTokens already counts the cache, and outputTokens the reasoning. */
export function stepUsage(usage: LanguageModelUsage | undefined): StepUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
  }
}

/** The gateway's id for a call, from its provider metadata. Dalliance Cloud's proxy passes it through. */
export function generationIdOf(metadata: ProviderMetadata | undefined): string | null {
  const id = metadata?.gateway?.generationId
  return typeof id === 'string' && id ? id : null
}

const tokensOf = (usage: StepUsage) => usage.inputTokens + usage.outputTokens

/**
 * What one call cost in dollars, or null when a rate it needs is unknown. Reasoning tokens are already part of
 * outputTokens, so they aren't counted again. Checked against the gateway's own reported cost for a cache write
 * and a cache read call.
 */
export function callCost(usage: StepUsage, prices: TokenPrices): number | null {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage
  if (cacheReadTokens && prices.cacheRead == null) return null
  if (cacheWriteTokens && prices.cacheWrite == null) return null
  const fresh = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
  return fresh * prices.input + cacheReadTokens * (prices.cacheRead ?? 0) + cacheWriteTokens * (prices.cacheWrite ?? 0) + outputTokens * prices.output
}

/** Dollars for the calls with a price, and the tokens of the ones without. */
export function dollarCost(calls: ModelCall[], priceOf: (model: string) => TokenPrices | null): RunCost {
  let usd = 0
  let unpricedTokens = 0
  for (const call of calls) {
    const prices = priceOf(call.model)
    const cost = prices ? callCost(call.usage, prices) : null
    if (cost == null) unpricedTokens += tokensOf(call.usage)
    else usd += cost
  }
  return { unit: 'usd', usd, unpricedTokens }
}

/** On Dalliance Cloud: the calls to count credits for, and their tokens in case the credits never come. */
export function creditCost(calls: ModelCall[]): RunCost {
  return {
    unit: 'credits',
    generationIds: calls.map((c) => c.generationId).filter((id): id is string => id != null),
    tokens: calls.reduce((sum, c) => sum + tokensOf(c.usage), 0),
  }
}

/**
 * Anthropic's list prices in dollars per million tokens: input, output, 5-minute cache writes and cache reads.
 * From Anthropic's pricing page as of 30 September 2026, which the gateway's list matched that day. Update this when prices change or a model is added; a model
 * missing here shows its tokens instead of a cost.
 */
const ANTHROPIC_PRICES: [id: string, input: number, output: number, cacheWrite: number, cacheRead: number][] = [
  ['claude-fable-5-1', 10, 50, 12.5, 0.25],
  ['claude-fable-5', 10, 50, 12.5, 1],
  ['claude-opus-5-5', 4, 20, 5, 0.2],
  ['claude-opus-5', 5, 25, 6.25, 0.5],
  ['claude-opus-4-8', 5, 25, 6.25, 0.5],
  ['claude-opus-4-7', 5, 25, 6.25, 0.5],
  ['claude-opus-4-6', 5, 25, 6.25, 0.5],
  ['claude-sonnet-5-5', 2, 10, 2.5, 0.2],
  ['claude-sonnet-5', 2, 10, 2.5, 0.2],
  ['claude-sonnet-4-6', 3, 15, 3.75, 0.3],
  ['claude-haiku-4-5', 1, 5, 1.25, 0.1],
]

/** The price of a Claude model on the Anthropic API. Takes aliases, dated ids like `claude-haiku-4-5-20251001`, and gateway ids. */
export function anthropicPrices(model: string): TokenPrices | null {
  const id = model.toLowerCase().replace(/^anthropic\//, '').replace(/\./g, '-')
  // An alias or a dated snapshot of it, never another model that shares the prefix: claude-opus-5 isn't claude-opus-5-5
  const row = ANTHROPIC_PRICES.find(([key]) => id === key || new RegExp(`^${key}-\\d{8}$`).test(id))
  if (!row) return null
  const [, input, output, cacheWrite, cacheRead] = row
  const perToken = (perMillion: number) => perMillion / 1_000_000
  return { input: perToken(input), output: perToken(output), cacheWrite: perToken(cacheWrite), cacheRead: perToken(cacheRead) }
}

/** A per-token price from the gateway's list, which sends them as strings like "0.000003". */
function rate(value: string | undefined): number | undefined {
  const n = Number(value)
  return value && Number.isFinite(n) && n >= 0 ? n : undefined
}

type GatewayPricing = { input?: string; output?: string; cachedInputTokens?: string; cacheCreationInputTokens?: string }

/** A gateway model's list pricing as TokenPrices, or null without input and output rates. */
export function gatewayPrices(pricing: GatewayPricing | null | undefined): TokenPrices | null {
  const input = rate(pricing?.input)
  const output = rate(pricing?.output)
  if (input == null || output == null) return null
  return { input, output, cacheRead: rate(pricing?.cachedInputTokens), cacheWrite: rate(pricing?.cacheCreationInputTokens) }
}

const priceLists = new Map<string, { at: number; prices: Promise<Map<string, TokenPrices>> }>()
const PRICES_MS = 10 * 60_000
const PRICES_WAIT_MS = 5_000

/** The gateway's prices by model id, for a key. Cached for ten minutes, like the model list. Empty when it can't be read. */
function gatewayPriceList(apiKey: string): Promise<Map<string, TokenPrices>> {
  const key = apiKey.slice(-6)
  const hit = priceLists.get(key)
  if (hit && Date.now() - hit.at < PRICES_MS) return hit.prices
  // The call takes no abort signal, so a deadline races it: a run never waits long on its price
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('No price list in time')), PRICES_WAIT_MS)
  })
  const prices = Promise.race([createGateway({ apiKey }).getAvailableModels(), deadline])
    .finally(() => clearTimeout(timer))
    .then(({ models }) => {
      const list = new Map<string, TokenPrices>()
      for (const m of models) {
        const p = gatewayPrices(m.pricing)
        if (p) list.set(m.id, p)
      }
      return list
    })
    .catch(() => {
      // Try again on the next run rather than caching the failure
      priceLists.delete(key)
      return new Map<string, TokenPrices>()
    })
  priceLists.set(key, { at: Date.now(), prices })
  return prices
}

/** What these calls cost on the chosen provider. */
export async function costOf(calls: ModelCall[], config: ModelConfig): Promise<RunCost> {
  if (config.provider === 'cloud') return creditCost(calls)
  if (config.provider === 'anthropic') return dollarCost(calls, anthropicPrices)
  const list = config.apiKey ? await gatewayPriceList(config.apiKey) : new Map<string, TokenPrices>()
  return dollarCost(calls, (model) => list.get(model) ?? null)
}
