// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MissingKeyError, needsKey, resolveModel } from './model'

describe('choosing a model', () => {
  it('runs Ollama on this Mac with no key', () => {
    expect(needsKey('ollama-local')).toBe(false)
    const { model, providerOptions } = resolveModel({ provider: 'ollama-local', model: 'llama3.2:3b', effort: 'high', apiKey: null })
    expect((model as { modelId: string }).modelId).toBe('llama3.2:3b')
    // Effort is an Anthropic and OpenAI setting, so it is not sent to Ollama
    expect(providerOptions).toBeUndefined()
  })

  it('asks for a key on the providers that need one', () => {
    for (const provider of ['gateway', 'anthropic', 'ollama-cloud'] as const) {
      expect(() => resolveModel({ provider, model: 'x', effort: 'low', apiKey: null })).toThrow(MissingKeyError)
    }
    expect(() => resolveModel({ provider: 'ollama-cloud', model: 'x', effort: 'low', apiKey: null })).toThrow('Ollama API key')
  })

  it('builds an Ollama Cloud model from a key', () => {
    const { model } = resolveModel({ provider: 'ollama-cloud', model: 'gpt-oss:120b', effort: 'low', apiKey: 'k' })
    expect((model as { modelId: string }).modelId).toBe('gpt-oss:120b')
  })
})
