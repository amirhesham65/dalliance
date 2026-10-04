const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const count = new Intl.NumberFormat('en-US')

/** Dollars with cents below $1,000 and without above, where cents are noise. */
export const money = (value: number) => (Math.abs(value) >= 1000 ? usdWhole.format(value) : usd.format(value))

/** Model costs are often fractions of a cent, so small ones keep four places. */
export const cost = (value: number) => (value > 0 && value < 1 ? `$${value.toFixed(4)}` : money(value))

export const number = (value: number) => count.format(value)

export const percent = (value: number) => `${Math.round(value * 100)}%`

/** "Oct 4" from "2026-10-04", read as UTC so the day doesn't shift with the time zone. */
export const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
