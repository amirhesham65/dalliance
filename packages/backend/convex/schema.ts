import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  /** One row per model call through the gateway, as the cloud site recorded it. Costs are in millionths of a dollar. */
  usage: defineTable({
    userId: v.string(),
    generationId: v.string(),
    model: v.string(),
    costMicros: v.number(),
    at: v.number(),
  })
    .index('by_generation', ['generationId'])
    .index('by_user_at', ['userId', 'at']),
  /** What a user spent in one billing period, kept as a running total so checking it reads one row. */
  spend: defineTable({
    userId: v.string(),
    periodStart: v.string(),
    costMicros: v.number(),
  }).index('by_user_period', ['userId', 'periodStart']),
})
