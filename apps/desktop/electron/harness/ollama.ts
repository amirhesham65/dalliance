import type { KeyCheck, ModelOption, OllamaProvider } from '@dalliance/shared/ipc'

const HOSTS: Record<OllamaProvider, string> = {
  'ollama-cloud': 'https://ollama.com',
  // 127.0.0.1 rather than localhost, which can resolve to ::1 while Ollama listens on IPv4 only
  'ollama-local': 'http://127.0.0.1:11434',
}

const CALL_MS = 10_000
const PROBE_MS = 20_000

/** Where the provider's OpenAI-compatible API lives, which is what the AI SDK talks to. */
export const ollamaBaseURL = (provider: OllamaProvider) => `${HOSTS[provider]}/v1`

const authHeaders = (apiKey: string | null): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {})

async function call(provider: OllamaProvider, apiKey: string | null, path: string, body?: unknown, timeout = CALL_MS): Promise<Response> {
  return fetch(`${HOSTS[provider]}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...authHeaders(apiKey), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
}

const NOT_RUNNING = "Ollama isn't running on this Mac. Open the Ollama app, or run `ollama serve`, then try again."

/** A fetch that failed before any answer came back means nothing is listening. */
function reach(provider: OllamaProvider, err: unknown): Error {
  if (provider === 'ollama-local') return new Error(NOT_RUNNING)
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * Whether a key works. Cloud has no balance call, but /api/me is the one route that reads the key, since the catalog
 * is public. Local takes no key, so the check is whether the server answers.
 */
export async function checkOllama(provider: OllamaProvider, apiKey: string): Promise<KeyCheck> {
  try {
    if (provider === 'ollama-local') {
      const res = await call(provider, null, '/api/version')
      if (!res.ok) return { status: 'unchecked', detail: `Ollama answered ${res.status}` }
      const { version } = (await res.json()) as { version?: string }
      return { status: 'ok', detail: version ? `Ollama ${version} is running` : null }
    }
    const res = await call(provider, apiKey, '/api/me', {})
    if (res.status === 401 || res.status === 403) return { status: 'rejected', detail: 'Ollama turned this key down. Check that you copied all of it.' }
    if (!res.ok) return { status: 'unchecked', detail: `Ollama answered ${res.status}` }
    const { name } = (await res.json().catch(() => ({}))) as { name?: string }
    return { status: 'ok', detail: name ? `Signed in as ${name}` : null }
  } catch (err) {
    if (provider === 'ollama-local') return { status: 'rejected', detail: NOT_RUNNING }
    return { status: 'unchecked', detail: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
}

/** Ollama ids name the model, not the maker, so the maker comes from the family the name starts with. */
const FAMILIES: [RegExp, string][] = [
  [/^gpt-oss/, 'OpenAI'],
  [/^gemma|^gemini/, 'Google'],
  [/^(llama|codellama)/, 'Meta'],
  [/^(mistral|ministral|mixtral|devstral|magistral|codestral)/, 'Mistral'],
  [/^(qwen|qwq)/, 'Alibaba'],
  [/^deepseek/, 'DeepSeek'],
  [/^(glm)/, 'Z.ai'],
  [/^kimi/, 'Moonshot AI'],
  [/^minimax/, 'MiniMax'],
  [/^nemotron/, 'NVIDIA'],
  [/^(phi)/, 'Microsoft'],
  [/^(granite)/, 'IBM'],
  [/^(command)/, 'Cohere'],
  [/^(cogito)/, 'Deep Cogito'],
  [/^(olmo)/, 'Ai2'],
]

const makerOf = (id: string) => FAMILIES.find(([pattern]) => pattern.test(id))?.[1] ?? 'Other'

interface Tag {
  name: string
  capabilities?: string[]
}

/** The agent works through tool calls, so a model that can't make them, like an embedding model, is no use here. */
const usable = (capabilities: string[] | undefined) => capabilities == null || (capabilities.includes('tools') && capabilities.includes('completion'))

/** Run `work` over `items`, a few at a time, keeping the order of the results. */
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await work(items[i])
      }
    }),
  )
  return out
}

/**
 * The models Ollama offers for tool use. The local server reports each model's capabilities in its listing. The
 * cloud catalog doesn't, so each model is asked, a few at a time. Whatever can't be asked stays in the list.
 */
export async function listOllamaModels(provider: OllamaProvider, apiKey: string | null): Promise<ModelOption[]> {
  let tags: Tag[]
  try {
    const res = await call(provider, apiKey, '/api/tags')
    if (res.status === 401 || res.status === 403) throw new Error('Ollama turned this key down. Check it in Settings.')
    if (!res.ok) throw new Error(`Ollama answered ${res.status}`)
    tags = ((await res.json()) as { models?: Tag[] }).models ?? []
  } catch (err) {
    throw reach(provider, err)
  }
  if (provider === 'ollama-cloud') {
    tags = await pool(tags, 8, async (tag) => {
      try {
        const res = await call(provider, apiKey, '/api/show', { model: tag.name })
        if (!res.ok) return tag
        const { capabilities } = (await res.json()) as { capabilities?: string[] }
        return { ...tag, capabilities }
      } catch {
        return tag
      }
    })
  }
  return tags
    .filter((tag) => usable(tag.capabilities))
    .map((tag) => ({ id: tag.name, name: tag.name, maker: makerOf(tag.name) }))
    .sort((a, b) => a.maker.localeCompare(b.maker) || a.name.localeCompare(b.name))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Whether the key's plan runs a model. Nothing lists that, so this asks for one token and reads the status: 402,
 * 403 and 404 mean the plan doesn't include it. Anything else, a timeout or a busy server included, leaves the
 * model available, since the run itself will say if it isn't. Free plans take one request at a time, so a 429 waits
 * and tries again once.
 */
async function isOpen(apiKey: string, model: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await call('ollama-cloud', apiKey, '/api/chat', { model, messages: [{ role: 'user', content: 'hi' }], stream: false, options: { num_predict: 1 } }, PROBE_MS)
      if (res.status === 402 || res.status === 403 || res.status === 404) return false
      if (res.status !== 429) return true
    } catch {
      return true
    }
    await sleep(1500)
  }
  return true
}

/** The same list with `locked` set on every model the key's plan doesn't include. */
export async function probeOllamaModels(apiKey: string, models: ModelOption[]): Promise<ModelOption[]> {
  const open = await pool(models, 2, (m) => isOpen(apiKey, m.id))
  return models.map((m, i) => (open[i] ? m : { ...m, locked: true }))
}
