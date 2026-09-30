import type { BillingView, SubscriptionView } from '@dalliance/shared/ipc'

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/** "1,500 credits", "6 credits", "less than 1 credit". A call that used a sliver of one still shows it was used. */
export function credits(n: number) {
  if (n > 0 && n < 0.5) return 'less than 1 credit'
  const whole = Math.round(n)
  return `${whole.toLocaleString('en-US')} ${whole === 1 ? 'credit' : 'credits'}`
}

/** One line on where a subscription stands, from Polar's status. */
export function standing(sub: SubscriptionView) {
  const end = sub.currentPeriodEnd ? day(sub.currentPeriodEnd) : null
  if (sub.status === 'past_due') return 'The last payment failed. Update the card in billing to keep the plan.'
  if (sub.status === 'trialing') return end ? `Trial until ${end}.` : 'On a trial.'
  if (sub.cancelAtPeriodEnd) return end ? `Cancelled. Ends ${end}.` : 'Cancelled at the end of the period.'
  if (sub.status === 'active') return end ? `Renews ${end}.` : 'Active.'
  return `Status: ${sub.status.replace(/_/g, ' ')}.`
}

/** How much of the period's credits are gone, as a fraction from 0 to 1, or null when the plan has none set. */
export function usedShare(usage: BillingView['usage']) {
  if (!usage?.planCredits) return null
  return Math.min(1, usage.spentCredits / usage.planCredits)
}
