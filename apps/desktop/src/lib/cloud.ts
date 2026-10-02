import { useState } from 'react'
import type { AccountView, BillingView } from '@dalliance/shared/ipc'
import { useNotebook } from '@/store/notebook-store'

/** Every model call runs through Dalliance Cloud's proxy, which enforces zero data retention. See docs/cloud.md. */
export const CLOUD_RETENTION = 'Every model call runs with zero data retention.'

/**
 * Whether prompts can run as far as the account goes: signed in. An account not answered yet counts, so nothing
 * flashes up. The plan is the service's to check, and its refusal says what to do.
 */
export function signedIn(account: AccountView | null) {
  return account == null || account.checking || account.user != null
}

/** True when Dalliance Cloud can run prompts: signed in, on a plan. */
export function cloudReady(account: AccountView | null, billing: BillingView | null) {
  return account?.user != null && billing?.subscription != null
}

/** Signs in or out, and puts the answer in the store. A failure shows as the account's error. */
export function useAccountAction() {
  const [busy, setBusy] = useState(false)
  const run = async (call: () => Promise<AccountView>) => {
    setBusy(true)
    try {
      useNotebook.setState({ account: await call() })
    } catch (err) {
      const current = useNotebook.getState().account
      if (current) useNotebook.setState({ account: { ...current, error: err instanceof Error ? err.message : String(err) } })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}
