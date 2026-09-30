import { describe, expect, it } from 'vitest'
import { agentProviderOptions } from './model'

describe('agentProviderOptions', () => {
  it('turns on thinking, effort and automatic caching for Anthropic models, direct or through the gateway', () => {
    const expected = { anthropic: { thinking: { type: 'adaptive' }, effort: 'high', cacheControl: { type: 'ephemeral' } } }
    expect(agentProviderOptions({ provider: 'anthropic', model: 'claude-opus-5', effort: 'high' })).toEqual(expected)
    expect(agentProviderOptions({ provider: 'gateway', model: 'anthropic/claude-opus-5', effort: 'high' })).toEqual(expected)
  })

  it('sends no Anthropic options to other makers', () => {
    expect(agentProviderOptions({ provider: 'gateway', model: 'openai/gpt-6', effort: 'xhigh' })).toEqual({ openai: { reasoningEffort: 'high' } })
    expect(agentProviderOptions({ provider: 'gateway', model: 'google/gemini-3-pro', effort: 'high' })).toBeUndefined()
  })
})
