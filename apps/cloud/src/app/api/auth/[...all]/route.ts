import { CLIENT_IP_HEADER, PROXY_HEADER } from '@dalliance/shared/cloud'
import type { NextRequest } from 'next/server'

// Better Auth runs on the Convex deployment. This forwards /api/auth/* to it, so sign-in cookies belong to this
// domain and the app, the browser and the OAuth providers all talk to one origin.
const target = process.env.CONVEX_SITE_URL?.trim().replace(/\/$/, '') || null
const secret = process.env.AUTH_PROXY_SECRET?.trim() || null

// Hop-by-hop headers, plus the two the proxy owns, which a caller must never set for itself
const DROP = ['connection', 'content-length', 'transfer-encoding', PROXY_HEADER, CLIENT_IP_HEADER]

async function forward(request: NextRequest) {
  if (!target || !secret) return new Response('Sign-in is not set up on this deployment.', { status: 503 })
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  for (const name of DROP) headers.delete(name)
  headers.set('host', new URL(target).host)
  // fetch decompresses but keeps content-encoding, which the browser would then decode a second time
  headers.set('accept-encoding', 'identity')
  headers.set('x-forwarded-host', url.host)
  headers.set('x-forwarded-proto', url.protocol.replace(/:$/, ''))
  headers.set(PROXY_HEADER, secret)
  // Vercel sets x-real-ip to the caller's address and overwrites any value the caller sent. Rate limits count by it
  const ip = request.headers.get('x-real-ip')
  if (ip) headers.set(CLIENT_IP_HEADER, ip)
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
  return fetch(`${target}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: 'manual',
  })
}

export const GET = forward
export const POST = forward
