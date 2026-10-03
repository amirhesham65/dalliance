import { afterEach, describe, expect, it, vi } from 'vitest'

const sees = { modalities: { input: ['text', 'image'], output: ['text'] } }
const MODELS = [
  { id: 'anthropic/claude-sonnet-5.5', zdr: 'all', ...sees },
  { id: 'openai/gpt-6-luna', zdr: 'some', tags: ['tool-use', 'vision'] },
  { id: 'anthropic/claude-fable-5.1', zdr: 'none', ...sees },
  { id: 'zai/glm-5', zdr: 'all', modalities: { input: ['text'], output: ['text'] }, tags: ['tool-use'] },
  { id: 'someone/odd-modalities', zdr: 'all', modalities: { input: 'image' }, tags: 'vision' },
  { id: 'someone/without-a-field' },
]

/** A fresh copy of the module, so each test starts with no cached list. */
async function load(reply: () => Response | Promise<Response>) {
  vi.resetModules()
  const fetch = vi.fn(async () => reply())
  vi.stubGlobal('fetch', fetch)
  return { zdr: await import('./zdr'), fetch }
}

afterEach(() => vi.unstubAllGlobals())

describe('qualifying models', () => {
  it('keeps models with any zero-data-retention provider that read images, and drops the rest', async () => {
    const { zdr } = await load(() => Response.json({ data: MODELS }))
    expect([...(await zdr.qualifyingModels())!]).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna'])
  })

  it('asks the gateway once per ten minutes', async () => {
    const { zdr, fetch } = await load(() => Response.json({ data: MODELS }))
    await zdr.qualifyingModels(0)
    await zdr.qualifyingModels(9 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await zdr.qualifyingModels(11 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the last list when a refresh fails, and has none before the first loads', async () => {
    let up = false
    const { zdr } = await load(() => (up ? Response.json({ data: MODELS }) : new Response('down', { status: 503 })))
    expect(await zdr.qualifyingModels(0)).toBeNull()
    up = true
    expect((await zdr.qualifyingModels(1))!.size).toBe(2)
    up = false
    expect((await zdr.qualifyingModels(11 * 60_000))!.size).toBe(2)
  })
})

describe('a model call', () => {
  it('always carries the flag, whatever the caller sent', async () => {
    const { withZeroDataRetention } = await import('./zdr')
    const flag = (call: Record<string, unknown>) => (withZeroDataRetention(call).providerOptions as { gateway: { zeroDataRetention: unknown } }).gateway.zeroDataRetention
    expect(flag({})).toBe(true)
    expect(flag({ providerOptions: null })).toBe(true)
    expect(flag({ providerOptions: { gateway: { zeroDataRetention: false } } })).toBe(true)
    expect(flag({ providerOptions: { gateway: 'nonsense' } })).toBe(true)
  })

  it("keeps the caller's other options", async () => {
    const { withZeroDataRetention } = await import('./zdr')
    const call = { prompt: [], providerOptions: { anthropic: { effort: 'medium' }, gateway: { tags: ['cell'] } } }
    expect(withZeroDataRetention(call)).toEqual({
      prompt: [],
      providerOptions: { anthropic: { effort: 'medium' }, gateway: { tags: ['cell'], zeroDataRetention: true } },
    })
  })

  it('names its model and every gateway fallback', async () => {
    const { modelsOf } = await import('./zdr')
    expect(modelsOf('a/one', {})).toEqual(['a/one'])
    expect(modelsOf('a/one', { providerOptions: { gateway: { models: ['a/two', { model: 'a/three' }] } } })).toEqual(['a/one', 'a/two', 'a/three'])
  })
})

describe('the model list', () => {
  it('leaves only qualifying models', async () => {
    const { filterModelList } = await import('./zdr')
    const list = { models: [{ id: 'a/in', name: 'In' }, { id: 'a/out', name: 'Out' }, { name: 'No id' }] }
    expect(filterModelList(list, new Set(['a/in']))).toEqual({ models: [{ id: 'a/in', name: 'In' }] })
  })

  it("offers nothing when it can't read the list", async () => {
    const { filterModelList } = await import('./zdr')
    expect(filterModelList({ models: 'odd' }, new Set(['a/in']))).toEqual({ models: [] })
    expect(filterModelList(null, new Set(['a/in']))).toEqual({ models: [] })
  })
})
