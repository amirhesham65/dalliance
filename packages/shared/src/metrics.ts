import { makeFunctionReference } from 'convex/server'

/**
 * The product metrics the internal admin app shows. The backend's `metrics:overview` builds them from the
 * accounts, Polar subscriptions and the usage ledger. It's an internal query, so only a caller with the
 * deployment's admin key can run it. Money is in US dollars, days are UTC dates like "2026-10-04".
 */

/** How far back the admin app can look, in days. */
export const METRICS_RANGES = [7, 30, 90] as const
export type MetricsRange = (typeof METRICS_RANGES)[number]

/** One UTC day of activity. */
export type MetricsDay = {
  day: string
  signups: number
  calls: number
  /** People who made at least one model call that day. */
  activeUsers: number
  costUsd: number
}

/** One model's share of the range's calls. */
export type ModelMetrics = {
  model: string
  calls: number
  costUsd: number
}

export type Metrics = {
  /** When the backend built the numbers, in milliseconds. */
  at: number
  days: MetricsRange
  users: {
    total: number
    verified: number
    /** Signed up within the range. */
    new: number
  }
  subscriptions: {
    /** Active or trialing: people the plan lets run prompts. */
    paying: number
    trialing: number
    pastDue: number
    /** Set to end when the current period does. */
    canceling: number
    /** Monthly recurring revenue from active subscriptions, with yearly plans divided by 12. */
    mrrUsd: number
  }
  usage: {
    calls: number
    costUsd: number
    /** People who made at least one model call within the range. */
    activeUsers: number
  }
  series: MetricsDay[]
  /** Models by cost within the range, highest first. */
  models: ModelMetrics[]
}

export const metricsApi = {
  overview: makeFunctionReference<'query', { days: MetricsRange }, Metrics>('metrics:overview'),
}
