// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkOllama, listOllamaModels, probeOllamaModels } from './ollama'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** Answer each request by its path, and remember what was asked. */
function serve(routes: Record<string, (body: any, headers: Headers) => Response>) {
  const asked: { url: string; body: any; auth: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      const headers = new Headers(init?.headers)
      asked.push({ url, body, auth: headers.get('Authorization') })
      const path = new URL(url).pathname
      return routes[path]?.(body, headers) ?? json({ error: 'not found' }, 404)
    }),
  )
  return asked
}

afterEach(() => vi.unstubAllGlobals())

describe('Ollama models', () => {
  it('lists the local models that can call tools, and leaves out the rest', async () => {
    const asked = serve({
      '/api/tags': () =>
        json({
          models: [
            { name: 'llama3.2:3b', capabilities: ['completion', 'tools'] },
            { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
            { name: 'gemma3:4b', capabilities: ['completion', 'vision'] },
          ],
        }),
    })
    const models = await listOllamaModels('ollama-local', null)
    expect(models).toEqual([{ id: 'llama3.2:3b', name: 'llama3.2:3b', maker: 'Meta' }])
    expect(asked[0]).toMatchObject({ url: 'http://127.0.0.1:11434/api/tags', auth: null })
  })

  it('asks the cloud for each model in the catalog, and keeps the ones it could not ask about', async () => {
    const asked = serve({
      '/api/tags': () => json({ models: [{ name: 'gpt-oss:120b' }, { name: 'embeddinggemma' }, { name: 'kimi-k3' }] }),
      '/api/show': (body) =>
        body.model === 'gpt-oss:120b'
          ? json({ capabilities: ['completion', 'thinking', 'tools'] })
          : body.model === 'embeddinggemma'
            ? json({ capabilities: ['embedding'] })
            : json({ error: 'busy' }, 503),
    })
    const models = await listOllamaModels('ollama-cloud', 'key-1')
    expect(models.map((m) => [m.id, m.maker])).toEqual([
      ['kimi-k3', 'Moonshot AI'],
      ['gpt-oss:120b', 'OpenAI'],
    ])
    expect(asked.every((a) => a.auth === 'Bearer key-1')).toBe(true)
  })

  it('says Ollama is not running when the local server does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(listOllamaModels('ollama-local', null)).rejects.toThrow("Ollama isn't running")
  })

  it('marks the models a plan does not include, and keeps the ones it could not settle', async () => {
    serve({
      '/api/chat': (body) =>
        ({
          'gpt-oss:20b': json({ message: { content: 'h' } }),
          'kimi-k3': json({ error: 'this model requires a subscription' }, 403),
          'glm-5.3': json({ error: 'gone' }, 404),
          'gemma4:31b': json({ error: 'oops' }, 500),
        })[body.model as string] ?? json({}, 500),
    })
    const models = ['gpt-oss:20b', 'kimi-k3', 'glm-5.3', 'gemma4:31b'].map((id) => ({ id, name: id, maker: 'x' }))
    const probed = await probeOllamaModels('key-1', models)
    expect(probed.map((m) => [m.id, m.locked ?? false])).toEqual([
      ['gpt-oss:20b', false],
      ['kimi-k3', true],
      ['glm-5.3', true],
      ['gemma4:31b', false],
    ])
  })

  it('asks for one token, not a reply', async () => {
    const asked = serve({ '/api/chat': () => json({}) })
    await probeOllamaModels('key-1', [{ id: 'gpt-oss:20b', name: 'gpt-oss:20b', maker: 'OpenAI' }])
    expect(asked[0].body).toMatchObject({ model: 'gpt-oss:20b', stream: false, options: { num_predict: 1 } })
  })
})

describe('Ollama key check', () => {
  it('reads the key through /api/me, since the catalog is public', async () => {
    serve({ '/api/me': (_body, headers) => (headers.get('Authorization') === 'Bearer good' ? json({ name: 'ada' }) : json({ error: 'invalid credentials' }, 401)) })
    expect(await checkOllama('ollama-cloud', 'good')).toEqual({ status: 'ok', detail: 'Signed in as ada' })
    expect(await checkOllama('ollama-cloud', 'bad')).toMatchObject({ status: 'rejected' })
  })

  it('does not reject a cloud key when Ollama cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await checkOllama('ollama-cloud', 'good')).toEqual({ status: 'unchecked', detail: 'offline' })
  })

  it('checks that the local server is up, with no key', async () => {
    serve({ '/api/version': () => json({ version: '0.34.4' }) })
    expect(await checkOllama('ollama-local', '')).toEqual({ status: 'ok', detail: 'Ollama 0.34.4 is running' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await checkOllama('ollama-local', '')).toMatchObject({ status: 'rejected' })
  })
})
