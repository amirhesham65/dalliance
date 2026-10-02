import { electron } from '@better-auth/electron'
import { createClient, type GenericCtx } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import type { BetterAuthPlugin } from 'better-auth'
import { betterAuth } from 'better-auth/minimal'
import { magicLink } from 'better-auth/plugins'
import { CLIENT_IP_HEADER, DESKTOP_SCHEME, PROXY_HEADER } from '@dalliance/shared/cloud'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { query } from './_generated/server'
import authConfig from './auth.config'

export const authComponent = createClient<DataModel>(components.betterAuth)

const env = (name: string) => process.env[name]?.trim() || undefined

/** Compares every character whatever the first difference, so timing says nothing about the secret. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/**
 * Every auth request must come through the cloud site's /api/auth proxy. That keeps cookies on the cloud site's domain,
 * and it's the only place the caller's IP is known, so a direct call can't dodge the rate limits with a made-up
 * IP header. Fails closed: with AUTH_PROXY_SECRET unset, nothing gets through. The JWKS stays public because
 * Convex and the model gateway fetch it to check tokens.
 */
/** True when a request came through the cloud site, which alone holds AUTH_PROXY_SECRET. Fails closed without it. */
export function fromWebsite(request: Request) {
  const secret = env('AUTH_PROXY_SECRET')
  const sent = request.headers.get(PROXY_HEADER)
  return Boolean(secret && sent && sameSecret(sent, secret))
}

const proxyOnly = (): BetterAuthPlugin => ({
  id: 'dalliance-proxy-only',
  onRequest: async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname.endsWith('/convex/jwks') || pathname.endsWith('/convex/.well-known/openid-configuration')) return
    if (!fromWebsite(request)) return { response: new Response('Not found', { status: 404 }) }
  },
})

/** How long a sign-in link works, in seconds. The Electron plugin's own code lasts as long. */
export const LINK_EXPIRES_IN = 300

/** The desktop app's sign-in request, which the Electron plugin reads off the link to issue the app's code. */
const DESKTOP_PARAMS = ['client_id', 'state', 'code_challenge', 'code_challenge_method'] as const

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    // The cloud site, which proxies /api/auth here, so cookies belong to its domain
    baseURL: env('SITE_URL'),
    database: authComponent.adapter(ctx),
    // Only the cloud site and the desktop app may start or finish a sign-in
    trustedOrigins: [env('SITE_URL') ?? '', `${DESKTOP_SCHEME}:/`].filter(Boolean),
    // Isolates don't share memory, so limits are counted in the database
    rateLimit: { enabled: true, storage: 'database' },
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    plugins: [
      proxyOnly(),
      // Email only: a link to the address signs in, or signs up, and proves the address, which billing relies on
      magicLink({
        expiresIn: LINK_EXPIRES_IN,
        sendMagicLink: async ({ email, url }, request) => {
          // The sign-in page sends the app's request with the call. The link carries it too, so it works in any
          // browser, not only the one with the page's cookie
          const link = new URL(url)
          for (const name of DESKTOP_PARAMS) {
            const value = request?.query?.[name]
            if (typeof value === 'string') link.searchParams.set(name, value)
          }
          if (!('scheduler' in ctx)) throw new Error('Sign-in links can only be sent from an action or a mutation.')
          // Sent in the background, so the page answers at once. Rendering the email needs Node
          await ctx.scheduler.runAfter(0, internal.emails.sendSignInLink, { email, url: link.toString(), minutes: LINK_EXPIRES_IN / 60 })
        },
      }),
      electron(),
      convex({ authConfig }),
    ],
  })
}

/** The signed-in user, or null. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    return user ? { id: user._id, name: user.name, email: user.email, image: user.image ?? null } : null
  },
})
