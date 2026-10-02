import type { CostView, Spend } from '@/store/notebook-store'

const tokenCount = new Intl.NumberFormat('en-US')

export const tokensText = (tokens: number) => `${tokenCount.format(tokens)} ${tokens === 1 ? 'token' : 'tokens'}`

/** Credits to one place under ten, since a credit is about a cent of model use. */
export function creditsText(credits: number): string {
  if (credits > 0 && credits < 0.1) return 'under 0.1 credits'
  const rounded = credits < 10 ? Math.round(credits * 10) / 10 : Math.round(credits)
  return `${rounded} ${rounded === 1 ? 'credit' : 'credits'}`
}

/** One run's cost, as the Activity pane words it. Credits that never came show as tokens rather than a guess. */
export function costText(cost: CostView): string {
  if (cost.counting) return 'Counting credits'
  return cost.credits == null ? tokensText(cost.tokens) : creditsText(cost.credits)
}

/** The notebook's total so far, to follow "This notebook:", or null before anything cost anything. */
export function spendText(spend: Spend): string | null {
  const parts: string[] = []
  if (spend.credits) parts.push(creditsText(spend.credits))
  if (spend.uncountedTokens) parts.push(`${tokensText(spend.uncountedTokens)} not counted`)
  if (spend.counting) parts.push('counting credits')
  return parts.length ? parts.join(', ') : null
}
