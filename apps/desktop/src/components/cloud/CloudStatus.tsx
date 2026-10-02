import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { credits } from '@/lib/billing'
import { cloudReady, useAccountAction } from '@/lib/cloud'
import { cn } from '@/lib/utils'
import type { DallianceApi } from '@dalliance/shared/ipc'
import { actions, useNotebook } from '@/store/notebook-store'

/**
 * Where Dalliance Cloud stands, in one line, with the next thing to do: sign in, pick a plan, or nothing. Model
 * settings and the first-run setup show it. Settings > Account has the rest.
 */
export function CloudStatus({ api }: { api: DallianceApi }) {
  const account = useNotebook((s) => s.account)
  const billing = useNotebook((s) => s.billing)
  const { busy, run } = useAccountAction()
  const ready = cloudReady(account, billing)
  const user = account?.user
  const sub = billing?.subscription
  const usage = billing?.usage

  let text: string
  let action: { label: string; onClick: () => void } | null = null
  if (!account || account.checking) text = 'Checking your account…'
  else if (!user) {
    text = account.waiting ? "Finish signing in in your browser. It sends you back here when it's done." : 'Sign in with GitHub or Google to run prompts on your Dalliance plan.'
    action = { label: account.waiting ? 'Open the page again' : 'Sign in', onClick: () => void run(() => api.signIn()) }
  } else if (billing?.loading) text = `Signed in as ${user.email}. Checking your plan…`
  else if (!sub) {
    text = `Signed in as ${user.email}. Choose a plan to run prompts.`
    action = { label: 'See plans', onClick: () => actions.openSettings('account') }
  } else {
    const left = usage?.planCredits != null ? `${credits(Math.max(0, usage.planCredits - usage.spentCredits))} left this period` : null
    text = [`${sub.name} plan`, left, user.email].filter(Boolean).join(' · ')
    action = { label: 'Manage', onClick: () => actions.openSettings('account') }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-raised px-3.5 py-3 text-[13px]" role="status">
      {ready ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-go text-background">
          <Check className="size-2.5" strokeWidth={3.5} />
        </span>
      ) : (
        <span className={cn('size-2 shrink-0 rounded-full', account?.checking || billing?.loading ? 'bg-faint pulse' : 'bg-warn')} />
      )}
      <span className="flex-1">
        {text}
        {account?.error && <span className="block text-xs text-destructive">{account.error}</span>}
      </span>
      {action && (
        <Button size="sm" variant={ready ? 'outline' : 'default'} disabled={busy} onClick={action.onClick}>
          {busy && <Loader2 className="animate-spin" />}
          {action.label}
        </Button>
      )}
    </div>
  )
}
