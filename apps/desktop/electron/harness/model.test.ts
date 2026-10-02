import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, agentProviderOptions, claudeReasoning } from './model'

describe('DEFAULT_MODEL', () => {
  it('is Sonnet 5.5', () => {
    expect(DEFAULT_MODEL).toBe('anthropic/claude-sonnet-5.5')
  })
})

describe('agentProviderOptions', () => {
  it('turns on summarized thinking, effort, automatic caching and one tool per step for Anthropic models', () => {
    expect(agentProviderOptions({ model: 'anthropic/claude-opus-5', effort: 'high' })).toEqual({
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true },
    })
  })

  it('gives Sonnet 5.5 adaptive thinking and every effort level, xhigh included', () => {
    // A live call through the gateway accepted xhigh on Sonnet 5.5, where Opus 4.6 turned it down
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(agentProviderOptions({ model: 'anthropic/claude-sonnet-5.5', effort })?.anthropic).toMatchObject({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort,
      })
    }
  })

  it('sends no Anthropic options to other makers, and asks OpenAI models for reasoning summaries', () => {
    expect(agentProviderOptions({ model: 'openai/gpt-6', effort: 'xhigh' })).toEqual({ openai: { reasoningEffort: 'high', reasoningSummary: 'auto' } })
    expect(agentProviderOptions({ model: 'google/gemini-3-pro', effort: 'high' })).toBeUndefined()
  })

  it.each(['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.1', 'anthropic/claude-sonnet-4', 'anthropic/claude-3.7-sonnet', 'anthropic/claude-3.5-haiku'])(
    'sends neither thinking nor effort to %s, but still caches',
    (model) => {
      expect(agentProviderOptions({ model, effort: 'xhigh' })).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true } })
    },
  )

  it('gives Opus 4.5 effort without adaptive thinking, capped at high', () => {
    expect(agentProviderOptions({ model: 'anthropic/claude-opus-4.5', effort: 'max' })).toEqual({
      anthropic: { effort: 'high', cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true },
    })

  })

  it('steps xhigh down to high on the 4.6 models, which take max but not xhigh', () => {
    for (const model of ['anthropic/claude-opus-4.6', 'anthropic/claude-sonnet-4.6']) {
      expect(agentProviderOptions({ model, effort: 'xhigh' })?.anthropic).toMatchObject({ thinking: { type: 'adaptive' }, effort: 'high' })
      expect(agentProviderOptions({ model, effort: 'max' })?.anthropic).toMatchObject({ effort: 'max' })
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
