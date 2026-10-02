import { makeFunctionReference } from 'convex/server'
import type { BillingStatus, CallCredits, PlanKey, PlanOption } from './cloud'

type NoArgs = Record<string, never>

/**
 * The Convex functions the desktop app calls, typed. packages/backend/contract.ts checks each one against the
 * backend's own, so a renamed function or a changed shape fails the backend's typecheck.
 */
export const cloudApi = {
  plans: makeFunctionReference<'query', NoArgs, PlanOption[]>('billing:plans'),
  status: makeFunctionReference<'query', NoArgs, BillingStatus | null>('billing:status'),
  checkout: makeFunctionReference<'action', { plan: PlanKey }, { url: string }>('billing:checkout'),
  portal: makeFunctionReference<'action', NoArgs, { url: string }>('billing:portal'),
  credits: makeFunctionReference<'query', { generationIds: string[] }, CallCredits[] | null>('usage:credits'),
}
