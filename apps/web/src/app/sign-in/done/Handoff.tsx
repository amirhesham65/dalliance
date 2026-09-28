'use client'

import { useEffect } from 'react'
import { authClient } from '@/lib/auth/client'
import { support } from '@/lib/ui'

/**
 * Hands the sign-in to the desktop app. The server left a short-lived code in a cookie. This opens the app's
 * scheme with it, and the app redeems it with the PKCE verifier only it holds. The code is also shown, for when
 * the browser won't open the app.
 */
export function Handoff({ code }: { code: string | null }) {
  useEffect(() => {
    if (!code) return
    const id = authClient.ensureElectronRedirect()
    return () => clearInterval(id)
  }, [code])

  if (!code) return <p className={support}>There's nothing to hand over. Start signing in from Settings in Dalliance.</p>
  return (
    <>
      <p className={support}>Your browser should ask to open Dalliance. Once it does, you can close this tab.</p>
      <div className="mt-8 max-w-xl">
        <p className="text-[14px] text-ink-subtle">If the app didn't open, copy this code into Settings in Dalliance. It works once, within five minutes. Never paste it anywhere else: it signs in as you.</p>
        <code className="mt-2 block rounded-lg border bg-cell p-3 font-mono text-[13px] break-all text-ink select-all">{code}</code>
      </div>
    </>
  )
}
