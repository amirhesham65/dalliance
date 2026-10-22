// @vitest-environment node
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { cleanTitle, generateTitle, titleModel } from './title'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

function replying(text: string) {
  const calls: unknown[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options)
      return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }
    },
  })
  return { model, calls }
}

describe('cell titles', () => {
  it('tidies what the model sends back', () => {
    expect(cleanTitle('"Return rate by category."')).toBe('Return rate by category')
    expect(cleanTitle('Title: Monthly revenue by plan\nBecause the prompt asks…')).toBe('Monthly revenue by plan')
    expect(cleanTitle('Churn for @subs')).toBe('Churn for subs')
    expect(cleanTitle('   ')).toBeNull()
  })

  it('names a cell with the small model', async () => {
    const { model, calls } = replying('Return rate by category')
    const title = await generateTitle('Plot the return rate for each product category over time, by month', { model })
    expect(title).toBe('Return rate by category')
    expect(JSON.stringify(calls[0])).toContain('Plot the return rate')
  })

  it('gives up quietly when the model fails', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => Promise.reject(new Error('rate limited')) })
    expect(await generateTitle('Anything at all, long enough to be named by the model', { model })).toBeNull()
  })

  it('uses the selected provider and key, and skips titles without a key', () => {
    const config = { model: 'anthropic/claude-sonnet-5-5', effort: 'medium' as const, key: () => 'test-key' }
    const title = titleModel(config)
    expect(title && (title.model as { modelId: string }).modelId).toBe('claude-sonnet-5-5')
    expect(title?.providerOptions?.anthropic).toBeDefined()
    expect(titleModel({ ...config, key: () => null })).toBeNull()
  })
})
