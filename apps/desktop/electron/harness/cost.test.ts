// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { StepUsage } from '@dalliance/shared/ipc'
import { anthropicPrices, callCost, costOf, creditCost, dollarCost, gatewayPrices, generationIdOf, stepUsage } from './cost'

const tokens = (u: Partial<StepUsage>): StepUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, ...u })

// Claude Haiku 4.5 as the gateway lists it
const HAIKU = gatewayPrices({ input: '0.000001', output: '0.000005', cachedInputTokens: '0.0000001', cacheCreationInputTokens: '0.00000125' })!

describe('what a call costs', () => {
  it('matches what the gateway charged for a cache write and a cache read', () => {
    // Two real calls with the same 12,600-token cached system prompt. The gateway reported $0.01579 and $0.0013
    const write = tokens({ inputTokens: 12_615, cacheWriteTokens: 12_600, outputTokens: 5 })
    const read = tokens({ inputTokens: 12_615, cacheReadTokens: 12_600, outputTokens: 5 })
    expect(callCost(write, HAIKU)).toBeCloseTo(0.01579, 8)
    expect(callCost(read, HAIKU)).toBeCloseTo(0.0013, 8)
  })

  it('counts reasoning once, as part of the output', () => {
    const withReasoning = tokens({ inputTokens: 21, outputTokens: 31, reasoningTokens: 24 })
    expect(callCost(withReasoning, HAIKU)).toBeCloseTo(21 * 0.000001 + 31 * 0.000005, 12)
  })

  it("has no price when the list doesn't give a cache rate the call needs", () => {
    const plain = { input: 0.000001, output: 0.000005 }
    expect(callCost(tokens({ inputTokens: 100, outputTokens: 10 }), plain)).toBeCloseTo(0.00015, 12)
    expect(callCost(tokens({ inputTokens: 100, cacheReadTokens: 80, outputTokens: 10 }), plain)).toBeNull()
    expect(callCost(tokens({ inputTokens: 100, cacheWriteTokens: 80, outputTokens: 10 }), plain)).toBeNull()
  })

  it('reads the AI SDK usage, with missing counts as zero', () => {
    expect(
      stepUsage({
        inputTokens: 12_615,
        inputTokenDetails: { noCacheTokens: 15, cacheReadTokens: 12_600, cacheWriteTokens: 0 },
        outputTokens: 31,
        outputTokenDetails: { textTokens: 7, reasoningTokens: 24 },
        totalTokens: 12_646,
      }),
    ).toEqual({ inputTokens: 12_615, outputTokens: 31, cacheReadTokens: 12_600, cacheWriteTokens: 0, reasoningTokens: 24 })
    expect(stepUsage(undefined)).toEqual(tokens({}))
  })

  it("finds the gateway's generation id in the provider metadata", () => {
    expect(generationIdOf({ gateway: { generationId: 'gen_01M3S7' }, anthropic: {} })).toBe('gen_01M3S7')
    expect(generationIdOf({ anthropic: { usage: {} } })).toBeNull()
    expect(generationIdOf(undefined)).toBeNull()
  })
})

describe("a run's cost", () => {
  const call = (model: string, usage: Partial<StepUsage>, generationId: string | null = null) => ({ model, usage: tokens(usage), generationId })

  it('adds up the dollars on an own key', () => {
    const calls = [call('anthropic/claude-haiku-4.5', { inputTokens: 1000, outputTokens: 100 }), call('anthropic/claude-haiku-4.5', { inputTokens: 2000, outputTokens: 200 })]
    const cost = dollarCost(calls, () => HAIKU)
    expect(cost.unit).toBe('usd')
    expect(cost).toMatchObject({ unpricedTokens: 0 })
    expect(cost.unit === 'usd' && cost.usd).toBeCloseTo(3000 * 0.000001 + 300 * 0.000005, 12)
  })

  it('shows tokens for a model with no known price, never a made-up amount', () => {
    const calls = [call('someone/new-model', { inputTokens: 1000, outputTokens: 100 }), call('anthropic/claude-haiku-4.5', { inputTokens: 1000, outputTokens: 100 })]
    const cost = dollarCost(calls, (model) => (model === 'anthropic/claude-haiku-4.5' ? HAIKU : null))
    expect(cost).toMatchObject({ unit: 'usd', unpricedTokens: 1100 })
    expect(cost.unit === 'usd' && cost.usd).toBeCloseTo(0.0015, 12)
    expect(dollarCost([calls[0]], () => null)).toEqual({ unit: 'usd', usd: 0, unpricedTokens: 1100 })
  })

  it('names the calls for Dalliance Cloud to count, with no dollars at all', async () => {
    const calls = [call('anthropic/claude-opus-5', { inputTokens: 900, outputTokens: 100 }, 'gen_1'), call('openai/gpt-6-luna', { inputTokens: 40, outputTokens: 10 }, 'gen_2')]
    expect(creditCost(calls)).toEqual({ unit: 'credits', generationIds: ['gen_1', 'gen_2'], tokens: 1050 })
    const cost = await costOf(calls, { provider: 'cloud', model: 'anthropic/claude-opus-5', effort: 'medium', apiKey: null })
    expect(cost).toEqual({ unit: 'credits', generationIds: ['gen_1', 'gen_2'], tokens: 1050 })
    expect(cost).not.toHaveProperty('usd')
  })

  it("prices the Anthropic API from the app's table", async () => {
    const cost = await costOf([call('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 100_000 })], {
      provider: 'anthropic',
      model: 'claude-opus-5',
      effort: 'medium',
      apiKey: 'k',
    })
    expect(cost.unit === 'usd' && cost.usd).toBeCloseTo(5 + 2.5, 9)
  })
})

describe('the Anthropic price table', () => {
  it('knows current models by alias, dated id and gateway id', () => {
    const haiku = anthropicPrices('claude-haiku-4-5')!
    for (const [rate, perMillion] of [['input', 1], ['output', 5], ['cacheWrite', 1.25], ['cacheRead', 0.1]] as const) {
      expect(haiku[rate]! * 1_000_000).toBeCloseTo(perMillion, 9)
    }
    expect(anthropicPrices('claude-haiku-4-5-20251001')).toEqual(anthropicPrices('claude-haiku-4-5'))
    expect(anthropicPrices('anthropic/claude-sonnet-4.6')?.input).toBeCloseTo(0.000003, 12)
    expect(anthropicPrices('claude-opus-5')?.output).toBeCloseTo(0.000025, 12)
  })

  it('tells apart models that share a prefix', () => {
    expect(anthropicPrices('claude-opus-5-5')?.input).toBeCloseTo(0.000004, 12)
    expect(anthropicPrices('claude-opus-5-20260401')?.input).toBeCloseTo(0.000005, 12)
    expect(anthropicPrices('anthropic/claude-sonnet-5.5')?.output).toBeCloseTo(0.00001, 12)
  })

  it("has no price for a model it doesn't list", () => {
    expect(anthropicPrices('claude-opus-6')).toBeNull()
    expect(anthropicPrices('claude-3-opus-20240229')).toBeNull()
    expect(anthropicPrices('gpt-6-luna')).toBeNull()
  })
})

describe('gateway prices', () => {
  it('reads the per-token strings, and needs both input and output', () => {
    expect(gatewayPrices({ input: '0.000003', output: '0.000015' })).toEqual({ input: 0.000003, output: 0.000015, cacheRead: undefined, cacheWrite: undefined })
    expect(gatewayPrices({ input: '0.000003' })).toBeNull()
    expect(gatewayPrices({ input: 'n/a', output: '0.000015' })).toBeNull()
    expect(gatewayPrices(null)).toBeNull()
  })
})
