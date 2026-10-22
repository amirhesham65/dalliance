import type { CostView, Spend } from '@/store/notebook-store'

const tokenCount = new Intl.NumberFormat('en-US')
export const tokensText = (tokens: number) => `${tokenCount.format(tokens)} ${tokens === 1 ? 'token' : 'tokens'}`
export const costText = (cost: CostView) => tokensText(cost.tokens)
export const spendText = (spend: Spend): string | null => spend.tokens ? tokensText(spend.tokens) : null
