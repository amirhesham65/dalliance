import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import type { RunCost, StepUsage } from '@dalliance/shared/ipc'

/**
 * What a run cost, for the Show costs setting. Dalliance Cloud counts credits after each call, so a run only names
 * its calls by generation id and adds up their tokens.
 */

/** One model call. */
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

/** The calls to count credits for, and their tokens in case the credits never come. Undefined without calls. */
export function costOf(calls: ModelCall[]): RunCost | undefined {
  if (!calls.length) return undefined
  return {
    generationIds: calls.map((c) => c.generationId).filter((id): id is string => id != null),
    tokens: calls.reduce((sum, c) => sum + c.usage.inputTokens + c.usage.outputTokens, 0),
  }
}
