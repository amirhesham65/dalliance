import { METRICS_RANGES, type Metrics, type MetricsDay, type MetricsRange, type ModelMetrics } from '@dalliance/shared/metrics'
import { v } from 'convex/values'
import { components } from './_generated/api'
import { internalQuery } from './_generated/server'
import { polar } from './billing'

const DAY_MS = 24 * 60 * 60 * 1000
const MICROS = 1_000_000

/** A UTC date like "2026-10-04". */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export type MetricsUser = { id: string; createdAt: number; emailVerified: boolean }
export type MetricsSubscription = { status: string; amount: number | null; recurringInterval: string | null; cancelAtPeriodEnd: boolean }
export type MetricsCall = { userId: string; model: string; costMicros: number; at: number }

/** Monthly revenue from one subscription, in cents. Yearly plans count a twelfth. */
function monthlyCents(sub: MetricsSubscription) {
  if (sub.amount == null) return 0
  if (sub.recurringInterval === 'year') return sub.amount / 12
  if (sub.recurringInterval === 'week') return (sub.amount * 52) / 12
  if (sub.recurringInterval === 'day') return (sub.amount * 365) / 12
  return sub.amount
}

/** The admin app's numbers from the raw rows. Pure, so it's tested without a database. */
export function summarize(days: MetricsRange, now: number, users: MetricsUser[], subs: MetricsSubscription[], calls: MetricsCall[]): Metrics {
  // Today counts as one of the days, so a 7-day range is today and the six before it
  const start = Date.parse(dayOf(now - (days - 1) * DAY_MS))
  const buckets = new Map<string, MetricsDay & { users: Set<string> }>()
  for (let i = 0; i < days; i++) {
    const day = dayOf(start + i * DAY_MS)
    buckets.set(day, { day, signups: 0, calls: 0, activeUsers: 0, costUsd: 0, users: new Set() })
  }

  let newUsers = 0
  for (const user of users) {
    const bucket = user.createdAt >= start ? buckets.get(dayOf(user.createdAt)) : undefined
    if (!bucket) continue
    bucket.signups += 1
    newUsers += 1
  }

  const active = new Set<string>()
  const models = new Map<string, { calls: number; costMicros: number }>()
  let costMicros = 0
  let callCount = 0
  for (const call of calls) {
    const bucket = call.at >= start ? buckets.get(dayOf(call.at)) : undefined
    if (!bucket) continue
    callCount += 1
    costMicros += call.costMicros
    bucket.calls += 1
    bucket.costUsd += call.costMicros / MICROS
    bucket.users.add(call.userId)
    active.add(call.userId)
    const model = models.get(call.model) ?? { calls: 0, costMicros: 0 }
    model.calls += 1
    model.costMicros += call.costMicros
    models.set(call.model, model)
  }

  let paying = 0
  let trialing = 0
  let pastDue = 0
  let canceling = 0
  let mrrCents = 0
  for (const sub of subs) {
    if (sub.status === 'past_due') pastDue += 1
    if (sub.status !== 'active' && sub.status !== 'trialing') continue
    paying += 1
    if (sub.status === 'trialing') trialing += 1
    if (sub.cancelAtPeriodEnd) canceling += 1
    // A trial hasn't paid anything yet
    if (sub.status === 'active') mrrCents += monthlyCents(sub)
  }

  return {
    at: now,
    days,
    users: { total: users.length, verified: users.filter((u) => u.emailVerified).length, new: newUsers },
    subscriptions: { paying, trialing, pastDue, canceling, mrrUsd: Math.round(mrrCents) / 100 },
    usage: { calls: callCount, costUsd: costMicros / MICROS, activeUsers: active.size },
    series: [...buckets.values()].map(({ users: seen, ...day }) => ({ ...day, activeUsers: seen.size })),
    models: [...models.entries()]
      .map(([model, m]): ModelMetrics => ({ model, calls: m.calls, costUsd: m.costMicros / MICROS }))
      .sort((a, b) => b.costUsd - a.costUsd),
  }
}

/** Accounts read per page from the Better Auth component. */
const USER_PAGE = 500

/**
 * Product metrics for the internal admin app in apps/admin, which calls this with the deployment's admin key. It
 * reads every account and the usage ledger for the range, which is fine while Dalliance is small. A query reads
 * at most 32,000 documents, so once the ledger nears that over 90 days, keep daily totals in their own table
 * instead. See docs/admin.md.
 */
export const overview = internalQuery({
  args: { days: v.union(...METRICS_RANGES.map((d) => v.literal(d))) },
  handler: async (ctx, { days }): Promise<Metrics> => {
    const now = Date.now()

    const users: MetricsUser[] = []
    let cursor: string | null = null
    for (;;) {
      const page: { page: { _id: string; createdAt: number; emailVerified: boolean }[]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(components.betterAuth.adapter.findMany, { model: 'user', paginationOpts: { cursor, numItems: USER_PAGE } })
      for (const user of page.page) users.push({ id: user._id, createdAt: user.createdAt, emailVerified: user.emailVerified })
      if (page.isDone) break
      cursor = page.continueCursor
    }

    const subs: MetricsSubscription[] = []
    for (const user of users) {
      const sub = await polar.getCurrentSubscription(ctx, { userId: user.id })
      if (sub) subs.push(sub)
    }

    // Rows land as calls finish, so creation time and `at` agree, and the built-in index covers the range
    const since = now - days * DAY_MS
    const calls = await ctx.db
      .query('usage')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', since))
      .collect()

    return summarize(days, now, users, subs, calls)
  },
})
