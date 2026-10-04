import { describe, expect, it, vi } from 'vitest'

vi.mock('./billing', () => ({ polar: {} }))

const { summarize } = await import('./metrics')

const NOW = Date.parse('2026-10-04T15:00:00Z')
const at = (iso: string) => Date.parse(iso)

const sub = (status: string, amount: number | null, recurringInterval: string | null = 'month', cancelAtPeriodEnd = false) => ({
  status,
  amount,
  recurringInterval,
  cancelAtPeriodEnd,
})

describe('metrics:summarize', () => {
  it('buckets the range by UTC day, today included', () => {
    const m = summarize(7, NOW, [], [], [])
    expect(m.series.map((d) => d.day)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  })

  it('counts signups within the range and every account in the total', () => {
    const users = [
      { id: 'a', createdAt: at('2026-08-01T00:00:00Z'), emailVerified: true },
      { id: 'b', createdAt: at('2026-10-03T09:00:00Z'), emailVerified: true },
      { id: 'c', createdAt: at('2026-10-04T01:00:00Z'), emailVerified: false },
    ]
    const m = summarize(7, NOW, users, [], [])
    expect(m.users).toEqual({ total: 3, verified: 2, new: 2 })
    expect(m.series.at(-2)?.signups).toBe(1)
    expect(m.series.at(-1)?.signups).toBe(1)
  })

  it('adds up calls, cost and distinct active users per day and over the range', () => {
    const calls = [
      { userId: 'a', model: 'anthropic/claude-opus-5-5', costMicros: 120_000, at: at('2026-10-04T10:00:00Z') },
      { userId: 'a', model: 'anthropic/claude-opus-5-5', costMicros: 80_000, at: at('2026-10-04T11:00:00Z') },
      { userId: 'b', model: 'anthropic/claude-haiku-4-5', costMicros: 5_000, at: at('2026-10-03T11:00:00Z') },
      // Before the first day of the range
      { userId: 'c', model: 'anthropic/claude-haiku-4-5', costMicros: 9_000, at: at('2026-09-27T23:00:00Z') },
    ]
    const m = summarize(7, NOW, [], [], calls)
    expect(m.usage).toEqual({ calls: 3, costUsd: 0.205, activeUsers: 2 })
    expect(m.series.at(-1)).toMatchObject({ calls: 2, activeUsers: 1, costUsd: 0.2 })
    expect(m.models.map((x) => x.model)).toEqual(['anthropic/claude-opus-5-5', 'anthropic/claude-haiku-4-5'])
    expect(m.models[1]).toEqual({ model: 'anthropic/claude-haiku-4-5', calls: 1, costUsd: 0.005 })
  })

  it('counts paying plans and monthly revenue, with yearly plans a twelfth and trials free', () => {
    const subs = [sub('active', 2000), sub('active', 24000, 'year', true), sub('trialing', 2000), sub('past_due', 2000), sub('canceled', 2000)]
    const m = summarize(30, NOW, [], subs, [])
    expect(m.subscriptions).toEqual({ paying: 3, trialing: 1, pastDue: 1, canceling: 1, mrrUsd: 40 })
  })
})
