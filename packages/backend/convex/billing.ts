import type { GenericCtx } from '@convex-dev/better-auth'
import { Polar } from '@convex-dev/polar'
import { ConvexError, v } from 'convex/values'
import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { action, internalAction, query } from './_generated/server'
import { authComponent } from './auth'
import { periodUsage, planCredits } from './usage'

const env = (name: string) => process.env[name]?.trim() || undefined

/** The plans the app offers, by key. Each maps to a Polar product id set on the deployment. */
const PLANS = { pro: env('POLAR_PRODUCT_PRO') ?? '' }
type PlanKey = keyof typeof PLANS

const production = env('POLAR_SERVER') === 'production'

/** The signed-in user, for billing. Throws when there's none. */
async function billingUser(ctx: GenericCtx<DataModel>) {
  const user = await authComponent.safeGetAuthUser(ctx)
  if (!user) throw new ConvexError('Sign in to manage a plan.')
  // Polar links a new customer to an existing one with the same email, and so to its billing portal.
  // Only a verified email may claim that. Sandbox allows the local password sign-in, which has no verification
  if (production && !user.emailVerified) throw new ConvexError('Verify your email before subscribing.')
  return { userId: user._id, email: user.email }
}

// Reads POLAR_ORGANIZATION_TOKEN, POLAR_WEBHOOK_SECRET and POLAR_SERVER from the deployment
export const polar = new Polar<DataModel, typeof PLANS>(components.polar, {
  products: PLANS,
  // The component types its context loosely. It's the same object Better Auth reads
  getUserInfo: (ctx) => billingUser(ctx as GenericCtx<DataModel>),
})

const site = () => {
  const url = env('SITE_URL')
  if (!url) throw new ConvexError('SITE_URL is not set on this deployment.')
  return url.replace(/\/$/, '')
}

/** "$20 / month" from a Polar price in cents. */
function priceLabel(amount: number | null | undefined, currency: string | null | undefined, interval: string | null | undefined) {
  if (amount == null) return null
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency ?? 'usd').toUpperCase(), minimumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100)
  return interval ? `${money} / ${interval}` : money
}

/** What the app can offer: each configured plan whose product has synced from Polar and isn't archived. */
export const plans = query({
  args: {},
  handler: async (ctx) => {
    const offers = []
    for (const [key, productId] of Object.entries(PLANS) as [PlanKey, string][]) {
      if (!productId) continue
      const product = await polar.getProduct(ctx, { productId })
      if (!product || product.isArchived) continue
      const price = product.prices.find((p) => !p.isArchived)
      offers.push({
        key,
        name: product.name,
        description: product.description,
        price: priceLabel(price?.priceAmount, price?.priceCurrency, product.recurringInterval),
        credits: planCredits(key),
      })
    }
    return offers
  },
})

/** The signed-in user's plan. Null when signed out, `subscription: null` when they have none. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return null
    const sub = await polar.getCurrentSubscription(ctx, { userId: user._id })
    if (!sub) return { subscription: null, usage: null }
    return {
      usage: await periodUsage(ctx, user._id),
      subscription: {
        key: sub.productKey ?? null,
        name: sub.product.name,
        status: sub.status,
        price: priceLabel(sub.amount, sub.currency, sub.recurringInterval),
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      },
    }
  },
})

/**
 * A Polar checkout for one of the configured plans. The plan is a key, never a product id from the caller, and
 * the page after payment is fixed here, so a caller can't send the browser anywhere else.
 */
export const checkout = action({
  args: { plan: v.literal('pro') },
  handler: async (ctx, { plan }): Promise<{ url: string }> => {
    const { userId, email } = await billingUser(ctx)
    const productId = PLANS[plan]
    if (!productId) throw new ConvexError('That plan is not set up on this deployment.')
    const current = await polar.getCurrentSubscription(ctx, { userId })
    if (current && current.productId === productId && current.status !== 'canceled') throw new ConvexError('You already have this plan.')
    const origin = site()
    const session = await polar.createCheckoutSession(ctx, {
      productIds: [productId],
      userId,
      email,
      origin,
      successUrl: `${origin}/billing/done?checkout_id={CHECKOUT_ID}`,
    })
    return { url: session.url }
  },
})

/** Polar's customer portal for the signed-in user: invoices, payment method, cancelling. */
export const portal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const { userId } = await billingUser(ctx)
    const customer = await polar.getCustomerByUserId(ctx, userId)
    if (!customer) throw new ConvexError('There is no billing account yet. Subscribe first.')
    return polar.createCustomerPortalSession(ctx, { userId, returnUrl: `${site()}/billing/done` })
  },
})

/** Copies products from Polar. Run once after setting the token: `npx convex run billing:syncProducts`. */
export const syncProducts = internalAction({
  args: {},
  handler: async (ctx) => {
    await polar.syncProducts(ctx)
  },
})
