import { cronJobs } from 'convex/server'
import { components, internal } from './_generated/api'
import { internalMutation } from './_generated/server'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The Resend component keeps every email it sent, sign-in links included. A link is dead after five minutes, so a
 * day is plenty for looking into a delivery problem.
 */
export const cleanupEmails = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, { olderThan: DAY_MS })
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupAbandonedEmails, { olderThan: 7 * DAY_MS })
  },
})

const crons = cronJobs()
crons.interval('Remove sent emails', { hours: 1 }, internal.crons.cleanupEmails)

export default crons
