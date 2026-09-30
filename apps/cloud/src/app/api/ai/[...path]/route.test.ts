import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Billing runs after the response; these tests only look at what goes to the gateway and back
vi.mock('next/server', () => ({ after: () => {} }))

const MODELS = [
  { id: 'anthropic/claude-sonnet-5.5', zdr: 'all' },
  { id: 'openai/gpt-6-luna', zdr: 'some' },
  { id: 'anthropic/claude-fable-5.1', zdr: 'none' },
]

/** What reached the gateway's language-model endpoint. */
let sent: unknown[] = []

function gateway(url: string, init?: RequestInit): Response {
  if (new URL(url).pathname === '/gateway/authorize') return Response.json({ ok: true, userId: 'user_1' })
  if (url.endsWith('/v1/models')) return Response.json({ data: MODELS })
  if (url.endsWith('/v4/ai/config')) return Response.json({ models: MODELS.map(({ id }) => ({ id, name: id })) })
  if (url.endsWith('/v4/ai/language-model')) {
    sent.push(JSON.parse(String(init?.body)))
    return new Response('data: {"type":"finish"}\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response('not found', { status: 404 })
}

async function route() {
  vi.resetModules()
  return import('./route')
}

function call(path: string, init: { model?: string; body?: unknown } = {}) {
  const request = new Request(`https://cloud.test/api/ai/${path}`, {
    method: path === 'config' ? 'GET' : 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json', ...(init.model ? { 'ai-language-model-id': init.model } : {}) },
    body: path === 'config' ? undefined : JSON.stringify(init.body ?? { prompt: [] }),
  })
  return { request: request as unknown as NextRequest, context: { params: Promise.resolve({ path: [path] }) } }
}

beforeEach(() => {
  sent = []
  vi.stubEnv('CONVEX_SITE_URL', 'https://convex.test')
  vi.stubEnv('AUTH_PROXY_SECRET', 'proxy-secret')
  vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-key')
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => gateway(String(input), init)))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('model calls through the proxy', () => {
  it('reach the gateway with zero data retention on, even when the app turned it off', async () => {
    const { POST } = await route()
    const body = { prompt: [], providerOptions: { gateway: { zeroDataRetention: false }, openai: { reasoningEffort: 'low' } } }
    const { request, context } = call('language-model', { model: 'openai/gpt-6-luna', body })
    const res = await POST(request, context)
    expect(res.status).toBe(200)
    expect(sent).toEqual([{ prompt: [], providerOptions: { gateway: { zeroDataRetention: true }, openai: { reasoningEffort: 'low' } } }])
  })

  it('carry the flag when the app sent no options at all', async () => {
    const { POST } = await route()
    const { request, context } = call('language-model', { model: 'anthropic/claude-sonnet-5.5' })
    await POST(request, context)
    expect(sent).toEqual([{ prompt: [], providerOptions: { gateway: { zeroDataRetention: true } } }])
  })

  it('refuse a model with no zero-data-retention provider, without calling the gateway', async () => {
    const { POST } = await route()
    const { request, context } = call('language-model', { model: 'anthropic/claude-fable-5.1' })
    const res = await POST(request, context)
    expect(res.status).toBe(403)
    expect((await res.json()).error.type).toBe('dalliance_account')
    expect(sent).toEqual([])
  })

  it('refuse a gateway fallback to such a model', async () => {
    const { POST } = await route()
    const body = { prompt: [], providerOptions: { gateway: { models: ['anthropic/claude-fable-5.1'] } } }
    const { request, context } = call('language-model', { model: 'anthropic/claude-sonnet-5.5', body })
    expect((await POST(request, context)).status).toBe(403)
    expect(sent).toEqual([])
  })

  it("refuse every call while the model list can't be read", async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => (String(input).endsWith('/v1/models') ? new Response('down', { status: 503 }) : gateway(String(input), init))))
    const { POST } = await route()
    const { request, context } = call('language-model', { model: 'anthropic/claude-sonnet-5.5' })
    expect((await POST(request, context)).status).toBe(502)
    expect(sent).toEqual([])
  })
})

describe('gateway refusals', () => {
  it('turn the paid-plan refusal of zero data retention into a message about the service, not the key', async () => {
    const body = { error: { message: 'Zero Data Retention (ZDR) is only available for Pro and Enterprise plans. Current plan: hobby.', type: 'permission_denied', param: { name: 'ZdrUnauthorizedError' } } }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => (String(input).endsWith('/v4/ai/language-model') ? Response.json(body, { status: 403 }) : gateway(String(input), init))))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await route()
    const { request, context } = call('language-model', { model: 'anthropic/claude-sonnet-5.5' })
    const res = await POST(request, context)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: { message: expect.stringMatching(/^Hosted models aren't available right now/), type: 'dalliance_account' } })
  })

  it('pass any other gateway error through as it came', async () => {
    const body = { error: { message: 'Rate limited', type: 'rate_limit_exceeded' } }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => (String(input).endsWith('/v4/ai/language-model') ? Response.json(body, { status: 429 }) : gateway(String(input), init))))
    const { POST } = await route()
    const { request, context } = call('language-model', { model: 'anthropic/claude-sonnet-5.5' })
    const res = await POST(request, context)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual(body)
  })
})

describe('the model list through the proxy', () => {
  it('only offers models with a zero-data-retention provider', async () => {
    const { GET } = await route()
    const { request, context } = call('config')
    const res = await GET(request, context)
    expect(res.status).toBe(200)
    expect((await res.json()).models.map((m: { id: string }) => m.id)).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna'])
  })
})
