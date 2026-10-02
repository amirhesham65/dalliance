'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth/client'
import { buttonLarge, buttonQuiet, focusRing, label } from '@dalliance/brand/ui'

/** What the desktop app sent: the PKCE challenge and state its main process holds the other half of. */
export interface DesktopRequest {
  client_id: string
  state: string
  code_challenge: string
  code_challenge_method: string
}

const DONE = '/sign-in/done'

const input = `h-10 w-full rounded-lg border bg-paper px-3 text-[15px] text-ink placeholder:text-ink-faint ${focusRing}`

/**
 * Sign-in by email: the address gets a link, and opening it signs in, or signs up, and sends the browser on to the
 * done page, which hands off to the app. A browser that is already signed in can continue as that account instead.
 */
export function SignIn({ request, error }: { request: DesktopRequest; error: string | null }) {
  const router = useRouter()
  const session = authClient.useSession()
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(error ? "That link didn't work. It may have expired or been used already. Send a new one." : null)

  // Every sign-in call carries the desktop request, so the server can issue a code only that app can redeem
  const fetchOptions = { query: request }

  const run = async (attempt: () => Promise<{ error: { message?: string } | null }>, after: () => void) => {
    setBusy(true)
    setProblem(null)
    try {
      const { error } = await attempt()
      if (error) return setProblem(error.message ?? "Sign-in didn't work. Try again.")
      after()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const send = (address: string) =>
    run(
      () =>
        authClient.signIn.magicLink({
          email: address,
          callbackURL: DONE,
          // A failed link comes back here with the app's request, so a new one can be sent
          errorCallbackURL: `/sign-in?${new URLSearchParams({ ...request, error: 'link' })}`,
          fetchOptions,
        }),
      () => setSentTo(address),
    )

  const user = session.data?.user
  if (user) {
    return (
      <div className="mt-8 grid max-w-sm gap-3">
        <p className="text-[15px]">
          Signed in on this browser as <span className="font-semibold text-ink">{user.email}</span>.
        </p>
        <button
          type="button"
          className={buttonLarge}
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                const { error } = await authClient.$fetch('/electron/transfer-user', { method: 'POST', body: {}, query: request })
                return { error: error ? { message: error.message } : null }
              },
              () => router.push(DONE),
            )
          }
        >
          Continue as {user.name || user.email}
        </button>
        <button type="button" className={buttonQuiet} disabled={busy} onClick={() => void authClient.signOut()}>
          Use another account
        </button>
        {problem && <Problem text={problem} />}
      </div>
    )
  }

  if (sentTo) {
    return (
      <div className="mt-8 grid max-w-sm gap-3" role="status">
        <p className="text-[15px]">
          We sent a link to <span className="font-semibold text-ink">{sentTo}</span>. Open it on this computer to finish signing in. It works for 5
          minutes.
        </p>
        <div className="flex gap-2">
          <button type="button" className={`${buttonQuiet} h-10 text-[15px]`} disabled={busy} onClick={() => void send(sentTo)}>
            Send it again
          </button>
          <button type="button" className={`${buttonQuiet} h-10 text-[15px]`} disabled={busy} onClick={() => setSentTo(null)}>
            Use another email
          </button>
        </div>
        {problem && <Problem text={problem} />}
      </div>
    )
  }

  return (
    <form
      className="mt-8 grid max-w-sm gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void send(email.trim())
      }}
    >
      <label className={label} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        className={input}
        type="email"
        autoComplete="email"
        autoFocus
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit" className={buttonLarge} disabled={busy || !email.trim()}>
        Email me a sign-in link
      </button>
      {problem && <Problem text={problem} />}
    </form>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="text-[14px] text-ink">
      {text}
    </p>
  )
}
