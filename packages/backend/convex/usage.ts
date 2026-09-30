import { v } from 'convex/values'
import { internal } from './_generated/api'
import { type QueryCtx, httpAction, internalMutation, internalQuery } from './_generated/server'
import { authComponent, fromWebsite } from './auth'
import { polar } from './billing'

const MICROS = 1_000_000

/**
 * Users see credits; the ledger keeps the gateway's real cost in millionths of a dollar. CREDITS_PER_USD says how
 * many credits a dollar of model cost uses, 100 unless set, so a credit is a cent.
 */
function creditsPerUsd() {
  const rate = Number(process.env.CREDITS_PER_USD?.trim())
  return Number.isFinite(rate) && rate > 0 ? rate : 100
}

/** Credits for a cost in millionths of a dollar. */
export const toCredits = (micros: number) => (micros / MICROS) * creditsPerUsd()

/** The credits each plan includes per billing period, from POLAR_<PLAN>_CREDITS on the deployment. Unset means none. */
export function planCredits(planKey: string | undefined) {
  const raw = planKey ? process.env[`POLAR_${planKey.toUpperCase()}_CREDITS`]?.trim() : undefined
  const credits = raw ? Number(raw) : NaN
  return Number.isFinite(credits) && credits > 0 ? credits : null
}

/** A plan's credits as the model cost they cover, in millionths of a dollar, which is what the ledger compares. */
function allowanceMicros(planKey: string | undefined) {
  const credits = planCredits(planKey)
  return credits == null ? null : Math.round((credits / creditsPerUsd()) * MICROS)
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long' })

async function spentMicros(ctx: QueryCtx, userId: string, periodStart: string) {
  const row = await ctx.db
    .query('spend')
    .withIndex('by_user_period', (q) => q.eq('userId', userId).eq('periodStart', periodStart))
    .unique()
  return row?.costMicros ?? 0
}

export type Verdict =
  | { ok: true; remainingMicros: number }
  | { ok: false; status: 402 | 503; message: string }

/**
 * Whether a user may make another model call: an active plan with credits left this period. One call can run
 * past the line, so a period can end slightly over; the next call is the one that's refused.
 */
export const allowance = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<Verdict> => {
    const sub = await polar.getCurrentSubscription(ctx, { userId })
    if (!sub) return { ok: false, status: 402, message: 'Subscribe to a Dalliance plan to run prompts. Settings > Plan.' }
    if (sub.status === 'past_due') return { ok: false, status: 402, message: 'The last payment for your plan failed. Update the card in Settings > Plan.' }
    if (sub.status !== 'active' && sub.status !== 'trialing') return { ok: false, status: 402, message: 'Your plan has ended. Subscribe again in Settings > Plan.' }
    const limit = allowanceMicros(sub.productKey)
    if (limit == null) return { ok: false, status: 503, message: "Credits aren't set up for this plan yet." }
    const spent = await spentMicros(ctx, userId, sub.currentPeriodStart)
    if (spent >= limit) {
      const renews = sub.currentPeriodEnd ? ` It renews on ${day(sub.currentPeriodEnd)}.` : ''
      // 402, not 429: a rate limit gets retried, and waiting won't help here
      return { ok: false, status: 402, message: `You've used this period's credits.${renews}` }
    }
    return { ok: true, remainingMicros: limit - spent }
  },
})

/** A user's credits used and included this period, for the Plan section. Null without a current plan. */
export async function periodUsage(ctx: QueryCtx, userId: string) {
  const sub = await polar.getCurrentSubscription(ctx, { userId })
  if (!sub) return null
  return { spentCredits: toCredits(await spentMicros(ctx, userId, sub.currentPeriodStart)), planCredits: planCredits(sub.productKey) }
}

/** Adds one call's cost to the ledger and the period's total. Idempotent on the generation id, so a retry can't bill twice. */
export const record = internalMutation({
  args: { userId: v.string(), generationId: v.string(), model: v.string(), costUsd: v.number() },
  handler: async (ctx, { userId, generationId, model, costUsd }) => {
    if (!(costUsd >= 0) || !Number.isFinite(costUsd)) throw new Error('Cost must be a non-negative number')
    const seen = await ctx.db
      .query('usage')
      .withIndex('by_generation', (q) => q.eq('generationId', generationId))
      .unique()
    if (seen) return
    const costMicros = Math.round(costUsd * MICROS)
    await ctx.db.insert('usage', { userId, generationId, model, costMicros, at: Date.now() })
    // Calls count toward the period they were made in, even when the webhook for a renewal lands later
    const sub = await polar.getCurrentSubscription(ctx, { userId })
    const periodStart = sub?.currentPeriodStart ?? 'none'
    const row = await ctx.db
      .query('spend')
      .withIndex('by_user_period', (q) => q.eq('userId', userId).eq('periodStart', periodStart))
      .unique()
    if (row) await ctx.db.patch(row._id, { costMicros: row.costMicros + costMicros })
    else await ctx.db.insert('spend', { userId, periodStart, costMicros })
  },
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * The cloud site's model proxy asks here before each call, with the caller's Convex JWT. `?check=account` only
 * checks the sign-in, for the model list. The answer says who to bill, so the proxy never trusts the app for it.
 */
export const authorize = httpAction(async (ctx, request) => {
  if (!fromWebsite(request)) return new Response('Not found', { status: 404 })
  // A token Convex can't validate throws. That's a signed-out caller, not a server error
  const user = await authComponent.safeGetAuthUser(ctx).catch(() => null)
  if (!user) return json(401, { ok: false, message: 'Sign in to Dalliance to run prompts.' })
  if (new URL(request.url).searchParams.get('check') === 'account') return json(200, { ok: true, userId: user._id })
  const verdict = await ctx.runQuery(internal.usage.allowance, { userId: user._id })
  return verdict.ok ? json(200, { ok: true, userId: user._id }) : json(verdict.status, verdict)
})

/** The proxy reports a finished call's cost here. Only the cloud site can, and it names the user it authorized. */
export const report = httpAction(async (ctx, request) => {
  if (!fromWebsite(request)) return new Response('Not found', { status: 404 })
  const body = (await request.json()) as { userId?: unknown; generationId?: unknown; model?: unknown; costUsd?: unknown }
  if (typeof body.userId !== 'string' || typeof body.generationId !== 'string' || typeof body.model !== 'string' || typeof body.costUsd !== 'number')
    return json(400, { ok: false })
  await ctx.runMutation(internal.usage.record, { userId: body.userId, generationId: body.generationId, model: body.model, costUsd: body.costUsd })
  return json(200, { ok: true })
})
