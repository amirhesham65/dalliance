import type { LanguageModelUsage } from 'ai'
import type { RunCost, StepUsage } from '@dalliance/shared/ipc'

/** One model call. */
export interface ModelCall {
  model: string
  usage: StepUsage
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

/** Total tokens for model calls. Undefined when no model ran. */
export function costOf(calls: ModelCall[]): RunCost | undefined {
  if (!calls.length) return undefined
  return {
    tokens: calls.reduce((sum, c) => sum + c.usage.inputTokens + c.usage.outputTokens, 0),
  }
}
