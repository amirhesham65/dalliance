import type { CostView, Spend } from '@/store/notebook-store'

const tokenCount = new Intl.NumberFormat('en-US')

export const tokensText = (tokens: number) => `${tokenCount.format(tokens)} ${tokens === 1 ? 'token' : 'tokens'}`

/** Dollars to three places under a dollar, since one cell often costs a few cents or less. */
export function usdText(usd: number): string {
  if (usd > 0 && usd < 0.001) return 'under $0.001'
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}

/** Credits to one place under ten, since a credit is about a cent of model use. */
export function creditsText(credits: number): string {
  if (credits > 0 && credits < 0.1) return 'under 0.1 credits'
  const rounded = credits < 10 ? Math.round(credits * 10) / 10 : Math.round(credits)
  return `${rounded} ${rounded === 1 ? 'credit' : 'credits'}`
}

/**
 * One run's cost, as the Activity pane words it. Own keys get an estimate in dollars, Dalliance Cloud its credits.
 * Calls without a known price, or credits that never came, show as tokens rather than a guessed amount.
 */
export function costText(cost: CostView): string {
  if (cost.unit === 'credits') {
    if (cost.counting) return 'Counting credits'
    return cost.credits == null ? tokensText(cost.tokens) : creditsText(cost.credits)
  }
  const unpriced = cost.unpricedTokens ? tokensText(cost.unpricedTokens) : ''
  if (!cost.usd && unpriced) return `${unpriced}, no price known`
  const usd = `About ${usdText(cost.usd)}, estimated`
  return unpriced ? `${usd}, plus ${unpriced} with no price known` : usd
}

/** The notebook's total so far, to follow "This notebook:", or null before anything cost anything. */
export function spendText(spend: Spend): string | null {
  const parts: string[] = []
  if (spend.usd) parts.push(`about ${usdText(spend.usd)}, estimated`)
  if (spend.credits) parts.push(creditsText(spend.credits))
  if (spend.unpricedTokens) parts.push(`${tokensText(spend.unpricedTokens)} with no price known`)
  if (spend.counting) parts.push('counting credits')
  return parts.length ? parts.join(', ') : null
}
