import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL, agentProviderOptions, claudeReasoning, resolveModel, listModels } from './model'

describe('DEFAULT_MODEL', () => {
  it('is Sonnet 5.5', () => {
    expect(DEFAULT_MODEL).toBe('anthropic/claude-sonnet-5-5')
  })
})

describe('agentProviderOptions', () => {
  it('turns on summarized thinking, effort, automatic caching and one tool per step for Anthropic models', () => {
    expect(agentProviderOptions({ model: 'anthropic/claude-opus-5', effort: 'high' })).toEqual({
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', cacheControl: { type: 'ephemeral' }, disableParallelToolUse: true },
    })
  })

  it('gives Sonnet 5.5 adaptive thinking and every effort level, xhigh included', () => {
    // Sonnet 5.5 accepts xhigh; the 4.6 models use the next lower supported effort
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(agentProviderOptions({ model: 'anthropic/claude-sonnet-5-5', effort })?.anthropic).toMatchObject({
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

describe('direct providers', () => {
  it.each([
    ['anthropic/claude-sonnet-5.5', 'anthropic', 'claude-sonnet-5-5'],
    ['google/gemini-3.8-flash', 'google', 'gemini-3.8-flash'],
    ['openai/gpt-6.1-sol', 'openai', 'gpt-6.1-sol'],
  ])('resolves %s using only that provider key', (id, provider, nativeId) => {
    const requested: string[] = []
    const { model } = resolveModel({ model: id, effort: 'medium', key: (name) => { requested.push(name); return 'test-provider-key' } })
    expect(requested).toEqual([provider])
    expect(typeof model !== 'string' && model.modelId).toBe(nativeId)
    expect(typeof model !== 'string' && model.provider).toContain(provider)
  })

  it('explains the missing key without switching providers', () => {
    expect(() => resolveModel({ model: 'google/gemini-custom', effort: 'medium', key: () => null })).toThrow('Add your Google API key')
    expect(() => resolveModel({ model: 'other/model', effort: 'medium', key: () => 'test-key' })).toThrow('Choose an Anthropic, Google, or OpenAI model')
  })

  it('lists only configured providers', () => {
    const list = listModels((provider) => provider === 'google' ? 'test-key' : null)
    expect(list.models.length).toBeGreaterThan(0)
    expect(list.models.every((model) => model.id.startsWith('google/'))).toBe(true)
    expect(listModels(() => null)).toEqual({ models: [], error: null })
    const connected = listModels((provider) => provider === 'google' ? null : 'test-key')
    expect(new Set(connected.models.map((model) => model.id.split('/')[0]))).toEqual(new Set(['anthropic', 'openai']))
  })

  it.each([
    ['anthropic/claude-sonnet-5-5', 'https://api.anthropic.com/v1/messages', 'x-api-key'],
    ['google/gemini-3.8-flash', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', 'x-goog-api-key'],
    ['openai/gpt-6.1-sol', 'https://api.openai.com/v1/responses', 'authorization'],
  ])('sends %s directly to its provider endpoint', async (id, endpoint, header) => {
    const requests: { url: string; headers: Headers }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(init.headers) })
      return Response.json({ error: { message: 'Test refusal', type: 'authentication_error', code: 'invalid_api_key' } }, { status: 401 })
    })
    try {
      const { model } = resolveModel({ model: id, effort: 'low', key: () => 'test-provider-key' })
      await expect(generateText({ model, prompt: 'Test', maxRetries: 0 })).rejects.toThrow()
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(endpoint)
      expect(requests[0].headers.get(header)).toBe(header === 'authorization' ? 'Bearer test-provider-key' : 'test-provider-key')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
