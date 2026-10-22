// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { StepUsage } from '@dalliance/shared/ipc'
import { type ModelCall, costOf, stepUsage } from './cost'

const tokens = (u: Partial<StepUsage>): StepUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, ...u })
const call = (model: string, usage: Partial<StepUsage>): ModelCall => ({ model, usage: tokens(usage) })

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

  it('totals input and output tokens without counting cached tokens twice', () => {
    const calls = [call('anthropic/claude-opus-5', { inputTokens: 900, outputTokens: 100 }), call('openai/gpt-6-luna', { inputTokens: 40, outputTokens: 10 })]
    expect(costOf(calls)).toEqual({ tokens: 1050 })
  })

  it('is nothing without calls', () => {
    expect(costOf([])).toBeUndefined()
  })
})
