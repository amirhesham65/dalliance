import { PROXY_HEADER, REFUSAL_TYPE } from '@dalliance/shared/cloud'
import { after, type NextRequest } from 'next/server'
import { filterModelList, modelsOf, qualifyingModels, withZeroDataRetention } from '@/lib/zdr'

// The desktop app's models run through here, on Dalliance's AI Gateway key. Each call is checked against the
// caller's plan in Convex first, runs with zero data retention, and its cost is recorded there once the gateway
// reports it. See docs/billing.md
export const maxDuration = 300

const GATEWAY = 'https://ai-gateway.vercel.sh'
const convex = process.env.CONVEX_SITE_URL?.trim().replace(/\/$/, '') || null
const secret = process.env.AUTH_PROXY_SECRET?.trim() || null
const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim() || null
/**
 * Only `ZERO_DATA_RETENTION=off` turns the flag off, for a Vercel team not yet on a paid plan, which refuses it.
 * Never in production: the product promises zero data retention. See docs/billing.md
 */
const retentionOff = process.env.ZERO_DATA_RETENTION?.trim() === 'off'
if (retentionOff) console.warn('ZERO_DATA_RETENTION=off: model calls run without zero data retention')

/** The only gateway endpoints the app needs: writing with a model, and the model list. */
const ROUTES: Record<string, 'GET' | 'POST'> = { 'language-model': 'POST', config: 'GET' }

/**
 * An error in the gateway's own shape, so the app's AI SDK shows the message as written. The type is ours on
 * purpose: `authentication_error` would be replaced with text about API keys, and a 429 would be retried.
 */
function refuse(status: number, message: string) {
  return Response.json({ error: { message, type: REFUSAL_TYPE } }, { status })
}

/** The gateway's refusal of zero data retention on a Vercel team without a paid plan. */
const ZDR_PLAN = /ZdrUnauthorizedError|Zero Data Retention \(ZDR\) is only available/
const UNAVAILABLE = "Hosted models aren't available right now. We're on it. Try again later."

const NOT_OFFERED = "This model doesn't run with zero data retention, so Dalliance Cloud doesn't offer it. Choose another model in Settings."

type Authorized = { ok: true; userId: string } | { ok: false; status: number; message: string }

/** Asks Convex who the caller is and whether they may spend. `account` only checks the sign-in. */
async function authorize(token: string, check: 'account' | 'spend'): Promise<Authorized> {
  const res = await fetch(`${convex}/gateway/authorize${check === 'account' ? '?check=account' : ''}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, [PROXY_HEADER]: secret! },
  }).catch(() => null)
  const body = res ? ((await res.json().catch(() => null)) as { ok?: boolean; userId?: string; message?: string } | null) : null
  if (res?.ok && body?.ok && body.userId) return { ok: true, userId: body.userId }
  // Pass on Convex's own messages for sign-in and plan problems, never its raw errors
  if (res && [401, 402, 503].includes(res.status) && typeof body?.message === 'string') return { ok: false, status: res.status, message: body.message }
  return { ok: false, status: 502, message: "Couldn't check your plan. Try again in a moment." }
}

// Headers that describe the call to the gateway. Everything else, cookies and auth included, stays behind
const PASS = ['content-type', 'user-agent', 'ai-gateway-protocol-version']
const upstreamHeaders = (request: NextRequest) => {
  const headers = new Headers({ authorization: `Bearer ${gatewayKey}`, 'ai-gateway-auth-method': 'api-key', 'accept-encoding': 'identity' })
  for (const [name, value] of request.headers) if (PASS.includes(name) || name.startsWith('ai-language-model-')) headers.set(name, value)
  return headers
}
const DROP = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']
const clientHeaders = (upstream: Response) => {
  const headers = new Headers()
  for (const [name, value] of upstream.headers) if (!DROP.includes(name)) headers.set(name, value)
  return headers
}

/** The gateway's cost for a generation, in dollars. Its usage record lands a few seconds after the call ends. */
async function costOf(generationId: string): Promise<number | null> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(`${GATEWAY}/v1/generation?id=${encodeURIComponent(generationId)}`, { headers: { authorization: `Bearer ${gatewayKey}` } }).catch(() => null)
    if (res?.ok) {
      const cost = ((await res.json()) as { data?: { total_cost?: unknown } }).data?.total_cost
      return typeof cost === 'number' && Number.isFinite(cost) ? cost : null
    }
    if (res && res.status !== 404) return null
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

/** Reads the whole reply, finds the generation id the gateway put in it, and records what it cost. */
async function meter(reply: ReadableStream<Uint8Array>, userId: string, model: string) {
  const text = await new Response(reply).text().catch(() => '')
  const generationId = /"(?:generationId|id)"\s*:\s*"(gen_[A-Za-z0-9]+)"/.exec(text)?.[1]
  if (!generationId) return console.error('model call without a generation id, not billed', { userId, model })
  const costUsd = await costOf(generationId)
  if (costUsd == null) return console.error('no cost for generation, not billed', { userId, model, generationId })
  const res = await fetch(`${convex}/gateway/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PROXY_HEADER]: secret! },
    body: JSON.stringify({ userId, generationId, model, costUsd }),
  }).catch(() => null)
  if (!res?.ok) console.error('recording usage failed', { userId, generationId, status: res?.status })
}

async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/')
  if (ROUTES[path] !== request.method) return refuse(404, 'Not found.')
  if (!convex || !secret || !gatewayKey) return refuse(503, "Models aren't set up on this deployment.")
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return refuse(401, 'Sign in to Dalliance to run prompts.')

  const who = await authorize(token, path === 'config' ? 'account' : 'spend')
  if (!who.ok) return refuse(who.status, who.message)

  const allowed = await qualifyingModels()
  if (!allowed) return refuse(502, "Couldn't check which models are available. Try again in a moment.")

  let body: string | undefined
  if (path === 'language-model') {
    const call = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (typeof call !== 'object' || call === null || Array.isArray(call)) return refuse(400, "The model call wasn't valid.")
    // The model and any gateway fallbacks, so a fallback can't reach a model the list leaves out
    if (!modelsOf(request.headers.get('ai-language-model-id') ?? '', call).every((id) => allowed.has(id))) return refuse(403, NOT_OFFERED)
    body = JSON.stringify(retentionOff ? call : withZeroDataRetention(call))
  }

  // No abort signal from the caller: a call that's cut off still runs to the end at the gateway, which bills us
  // for it, so it runs to the end here too and gets recorded
  const upstream = await fetch(`${GATEWAY}/v4/ai/${path}`, { method: request.method, headers: upstreamHeaders(request), body }).catch(() => null)
  if (!upstream) return refuse(502, "Couldn't reach the model gateway. Try again in a moment.")
  if (path === 'config' && upstream.ok) {
    const list = await upstream.json().catch(() => null)
    return Response.json(filterModelList(list, allowed), { status: upstream.status, headers: clientHeaders(upstream) })
  }
  if (path === 'language-model' && !upstream.ok) {
    const text = await upstream.text().catch(() => '')
    // The gateway only allows zero data retention on a paid Vercel plan. That's Dalliance's setup to fix, not the
    // user's key, which the app would otherwise say was rejected
    if (upstream.status === 403 && ZDR_PLAN.test(text)) {
      console.error('gateway refused zero data retention: the Vercel team needs a Pro or Enterprise plan')
      return refuse(503, UNAVAILABLE)
    }
    return new Response(text, { status: upstream.status, headers: clientHeaders(upstream) })
  }
  if (path !== 'language-model' || !upstream.body) return new Response(upstream.body, { status: upstream.status, headers: clientHeaders(upstream) })

  const [toClient, toMeter] = upstream.body.tee()
  after(() => meter(toMeter, who.userId, request.headers.get('ai-language-model-id') ?? 'unknown'))
  return new Response(toClient, { status: upstream.status, headers: clientHeaders(upstream) })
}

export const GET = forward
export const POST = forward
