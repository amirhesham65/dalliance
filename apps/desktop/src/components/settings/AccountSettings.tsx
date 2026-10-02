import { ArrowUpRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useAccountAction } from '@/lib/cloud'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { credits, standing, usedShare } from '@/lib/billing'
import type { BillingView, DallianceApi } from '@dalliance/shared/ipc'
import { useNotebook } from '@/store/notebook-store'
import { Group, Note, Row, SectionHeading } from './parts'

/**
 * The Dalliance account and its plan. The session and the connection to Dalliance Cloud
 * live in the main process; this only shows who is signed in and what the plan has left.
 */
export function AccountSettings({ api }: { api: DallianceApi }) {
  const account = useNotebook((s) => s.account)
  const { busy, run } = useAccountAction()
  const [code, setCode] = useState('')

  const redeem = () => {
    const value = code
    setCode('')
    void run(() => api.redeemSignInCode(value))
  }

  const status =
    !account || account.checking ? (
      'Checking…'
    ) : account.user ? (
      <>
        Signed in as <span className="font-medium text-foreground">{account.user.name || account.user.email}</span>
        {account.user.name && ` (${account.user.email})`}.
      </>
    ) : account.waiting ? (
      "Finish signing in in your browser. It sends you back here when it's done."
    ) : (
      'Sign in with GitHub or Google, in your browser.'
    )

  return (
    <>
      <SectionHeading title="Account">
        Your Dalliance account runs models on your plan. Notebooks and data stay on this computer, and every model call runs with zero data retention.
      </SectionHeading>
      <Group label="Account">
        <Row label="Dalliance account" description={status}>
          {account && !account.checking && (
            <Button size="sm" variant={account.user ? 'outline' : 'default'} disabled={busy} onClick={() => void run(() => (account.user ? api.signOut() : api.signIn()))}>
              {busy && <Loader2 className="animate-spin" />}
              {account.user ? 'Sign out' : account.waiting ? 'Open the page again' : 'Sign in'}
            </Button>
          )}
        </Row>
        {account?.waiting && !account.user && (
          <Row label="Code from the sign-in page" htmlFor="sign-in-code" description="Only needed if the browser didn't open Dalliance." wide>
            <div className="flex gap-2">
              <Input
                id="sign-in-code"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.trim()) {
                    e.preventDefault()
                    redeem()
                  }
                }}
                placeholder="Paste the code"
                className="font-mono text-xs"
              />
              <Button size="sm" variant="secondary" disabled={busy || !code.trim()} onClick={redeem}>
                Use code
              </Button>
            </div>
          </Row>
        )}
      </Group>
      {account?.error && (
        <div className="-mt-4 mb-6">
          <Note error>{account.error}</Note>
        </div>
      )}
      {account?.user && <Plan api={api} />}
    </>
  )
}

/** What's on offer, or the subscription, its credits this period, and a way to manage it. */
function Plan({ api }: { api: DallianceApi }) {
  const billing = useNotebook((s) => s.billing)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (id: string, call: () => Promise<BillingView>) => {
    setBusy(id)
    try {
      useNotebook.setState({ billing: await call() })
    } finally {
      setBusy(null)
    }
  }

  if (!billing || billing.loading) return <Note>Checking your plan…</Note>
  const sub = billing.subscription
  return (
    <>
      {sub ? (
        <Group label="Plan">
          <Row label={sub.name} description={[sub.price, standing(sub)].filter(Boolean).join(' · ')}>
            <Button size="sm" variant="outline" disabled={busy != null} onClick={() => void act('portal', () => api.openBillingPortal())}>
              {busy === 'portal' ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}
              Manage billing
            </Button>
          </Row>
          {billing.usage && <UsageRow usage={billing.usage} />}
        </Group>
      ) : billing.plans.length === 0 ? (
        !billing.error && <Note>No plans are on sale yet.</Note>
      ) : (
        <Group label="Plans">
          {billing.plans.map((plan) => (
            <Row
              key={plan.key}
              label={
                <span className="flex items-baseline gap-2">
                  {plan.name}
                  {plan.price && <span className="text-[12.5px] font-normal text-muted-foreground">{plan.price}</span>}
                </span>
              }
              description={[plan.credits ? `Includes ${credits(plan.credits)} each month.` : null, plan.description].filter(Boolean).join(' ')}
            >
              <Button size="sm" disabled={busy != null} onClick={() => void act(plan.key, () => api.startCheckout(plan.key))}>
                {busy === plan.key && <Loader2 className="animate-spin" />}
                {billing.checkingOut ? 'Open checkout again' : 'Subscribe'}
              </Button>
            </Row>
          ))}
        </Group>
      )}
      {billing.checkingOut && !sub && <Note>Finish checkout in your browser. This page updates on its own once the payment goes through.</Note>}
      {billing.error && <Note error>{billing.error}</Note>}
    </>
  )
}

/** Credits used this period against what the plan includes, as a meter. */
function UsageRow({ usage }: { usage: NonNullable<BillingView['usage']> }) {
  const share = usedShare(usage)
  return (
    <Row
      label="Credits this period"
      description={
        usage.planCredits
          ? `${credits(usage.spentCredits).replace(/ credits?$/, '')} of ${credits(usage.planCredits)} used. They renew with the plan.`
          : `${credits(usage.spentCredits)} used.`
      }
      wide
    >
      {share != null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-hover"
          role="meter"
          aria-label="Credits used this period"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <div className={share >= 1 ? 'h-full bg-destructive' : 'h-full bg-ink'} style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }} />
        </div>
      )}
    </Row>
  )
}
