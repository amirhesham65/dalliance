import { describe, expect, it } from 'vitest'
import { agentProviderOptions, claudeReasoning } from './model'

describe('agentProviderOptions', () => {
  it('turns on summarized thinking, effort, automatic caching and one tool per step for Anthropic models, direct or through the gateway', () => {
    const expected = { anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true } }
    expect(agentProviderOptions({ provider: 'anthropic', model: 'claude-opus-5', effort: 'high' })).toEqual(expected)
    expect(agentProviderOptions({ provider: 'gateway', model: 'anthropic/claude-opus-5', effort: 'high' })).toEqual(expected)
  })

  it('sends no Anthropic options to other makers, and asks OpenAI models for reasoning summaries', () => {
    expect(agentProviderOptions({ provider: 'gateway', model: 'openai/gpt-6', effort: 'xhigh' })).toEqual({ openai: { reasoningEffort: 'high', reasoningSummary: 'auto' } })
    expect(agentProviderOptions({ provider: 'gateway', model: 'google/gemini-3-pro', effort: 'high' })).toBeUndefined()
  })

  it.each(['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'anthropic/claude-haiku-4.5', 'claude-sonnet-4-5', 'anthropic/claude-sonnet-4.5', 'claude-opus-4-1', 'claude-sonnet-4-20250514', 'claude-sonnet-4-0', 'claude-3-7-sonnet-latest', 'anthropic/claude-3.5-haiku'])(
    'sends neither thinking nor effort to %s, but still caches',
    (model) => {
      const provider = model.startsWith('anthropic/') ? 'gateway' : 'anthropic'
      expect(agentProviderOptions({ provider, model, effort: 'xhigh' })).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true } })
    },
  )

  it('gives Opus 4.5 effort without adaptive thinking, capped at high', () => {
    expect(agentProviderOptions({ provider: 'anthropic', model: 'claude-opus-4-5', effort: 'max' })).toEqual({
      anthropic: { effort: 'high', cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true },
    })
    expect(agentProviderOptions({ provider: 'anthropic', model: 'claude-opus-4-5-20251101', effort: 'low' })?.anthropic).toMatchObject({ effort: 'low' })
  })

  it('steps xhigh down to high on the 4.6 models, which take max but not xhigh', () => {
    for (const model of ['claude-opus-4-6', 'anthropic/claude-sonnet-4.6']) {
      const provider = model.startsWith('anthropic/') ? 'gateway' : 'anthropic'
      expect(agentProviderOptions({ provider, model, effort: 'xhigh' })?.anthropic).toMatchObject({ thinking: { type: 'adaptive' }, effort: 'high' })
      expect(agentProviderOptions({ provider, model, effort: 'max' })?.anthropic).toMatchObject({ effort: 'max' })
    }
  })
})

describe('claudeReasoning', () => {
  it.each(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-fable-5-1', 'anthropic/claude-opus-4.7', 'claude-next-9'])(
    'gives %s adaptive thinking and every effort level',
    (model) => {
      expect(claudeReasoning(model)).toEqual({ adaptive: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] })
    },
  )
})
