import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AccountView, DallianceApi } from '@dalliance/shared/ipc'
import { useNotebook } from '@/store/notebook-store'
import { Group, Note, Row, SectionHeading } from './parts'

/** Sign in and out of the Dalliance account. The session lives in the main process; this only shows who. */
export function AccountSettings({ api }: { api: DallianceApi }) {
  const account = useNotebook((s) => s.account)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (call: () => Promise<AccountView>) => {
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

  const redeem = () => {
    const value = code
    setCode('')
    void act(() => api.redeemSignInCode(value))
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
      <SectionHeading title="Account">An optional Dalliance account. The app works without one, on your own model key.</SectionHeading>
      <Group>
        <Row label="Dalliance account" description={status}>
          {account && !account.checking && (
            <Button
              size="sm"
              variant={account.user ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => void act(() => (account.user ? api.signOut() : api.signIn()))}
            >
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
      {account?.error && <Note error>{account.error}</Note>}
    </>
  )
}
