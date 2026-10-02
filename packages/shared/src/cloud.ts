/**
 * What the desktop app, the cloud site (apps/cloud) and the Convex backend (packages/backend) agree on. Each side
 * imports it from here, so changing one value changes all three. The function references are in cloud-api.ts.
 */

/** The app's URL scheme. Sign-in in the browser ends with a redirect to it. electron-builder registers it too. */
export const DESKTOP_SCHEME = 'io.dalliance.app'
/** The deep link that carries a one-time sign-in code, as `#token=<code>`. The plugin takes exactly this form. */
export const SIGN_IN_CALLBACK = `${DESKTOP_SCHEME}://auth/callback`
/** Opened after checkout and the billing portal. It only brings the app forward. */
export const BILLING_LINK = `${DESKTOP_SCHEME}://billing`

/** The `type` on every refusal from the cloud site, in AI Gateway's error shape. The app shows its message as written. */
export const REFUSAL_TYPE = 'dalliance_account'

/** Header the cloud site's proxy adds to its calls to Convex. Holds AUTH_PROXY_SECRET. */
export const PROXY_HEADER = 'x-dalliance-proxy'
/** Header the cloud site's proxy sets to the caller's IP, from Vercel. Rate limits count by it. */
export const CLIENT_IP_HEADER = 'x-dalliance-client-ip'

/** The plans on sale, by key. Each maps to a Polar product on the deployment. */
export type PlanKey = 'pro'

/** A plan on offer, from `billing:plans`. */
export interface PlanOption {
  key: PlanKey
  name: string
  description: string | null
  /** Like "$20 / month". */
  price: string | null
  /** The credits included each billing period. */
  credits: number | null
}

/** The signed-in user's subscription. */
export interface SubscriptionView {
  /** Which plan it is, when it's one on offer. */
  key: string | null
  name: string
  /** `active`, `trialing`, `past_due`, `canceled` and the like. */
  status: string
  price: string | null
  /** When the period ends: the renewal date, or the last day when it's cancelling. ISO. */
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** Credits used this billing period, against what the plan includes. */
export interface PlanUsage {
  spentCredits: number
  planCredits: number | null
}

/** `billing:status`: null when signed out, `subscription: null` without a plan. */
export interface BillingStatus {
  subscription: SubscriptionView | null
  usage: PlanUsage | null
}

/** One model call's cost in credits, from `usage:credits`. */
export interface CallCredits {
  generationId: string
  credits: number
}
