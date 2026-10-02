// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { StepUsage } from '@dalliance/shared/ipc'
import { type ModelCall, costOf, generationIdOf, stepUsage } from './cost'

const tokens = (u: Partial<StepUsage>): StepUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, ...u })
const call = (model: string, usage: Partial<StepUsage>, generationId: string | null): ModelCall => ({ model, usage: tokens(usage), generationId })

describe('run costs', () => {
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

  it('names the calls for Dalliance Cloud to count, with their tokens', () => {
    const calls = [call('anthropic/claude-opus-5', { inputTokens: 900, outputTokens: 100 }, 'gen_1'), call('openai/gpt-6-luna', { inputTokens: 40, outputTokens: 10 }, null)]
    expect(costOf(calls)).toEqual({ generationIds: ['gen_1'], tokens: 1050 })
  })

  it('is nothing without calls', () => {
    expect(costOf([])).toBeUndefined()
  })
})
