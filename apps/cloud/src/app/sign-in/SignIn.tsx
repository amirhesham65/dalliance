'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth/client'
import type { SignInMethod } from '@/lib/auth/methods'
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

export function SignIn({ request, methods, error }: { request: DesktopRequest; methods: SignInMethod[]; error: string | null }) {
  const router = useRouter()
  const session = authClient.useSession()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(error ? "Sign-in didn't finish. Try again." : null)

  // Every sign-in call carries the desktop request, so the server can issue a code only that app can redeem
  const fetchOptions = { query: request }

  const run = async (attempt: () => Promise<{ error: { message?: string } | null }>) => {
    setBusy(true)
    setProblem(null)
    try {
      const { error } = await attempt()
      if (error) return setProblem(error.message ?? "Sign-in didn't work. Try again.")
      router.push(DONE)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const social = (provider: 'github' | 'google') =>
    // The provider sends the browser to the callback, which issues the code, then on to the done page
    void run(() => authClient.signIn.social({ provider, callbackURL: DONE, errorCallbackURL: '/sign-in?error=oauth', fetchOptions }))

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
            void run(async () => {
              const { error } = await authClient.$fetch('/electron/transfer-user', { method: 'POST', body: {}, query: request })
              return { error: error ? { message: error.message } : null }
            })
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

  return (
    <div className="mt-8 grid max-w-sm gap-3">
      {methods.includes('github') && (
        <button type="button" className={buttonLarge} disabled={busy} onClick={() => social('github')}>
          Continue with GitHub
        </button>
      )}
      {methods.includes('google') && (
        <button type="button" className={methods.includes('github') ? `${buttonQuiet} h-10 text-[15px]` : buttonLarge} disabled={busy} onClick={() => social('google')}>
          Continue with Google
        </button>
      )}
      {methods.includes('password') && <PasswordForm busy={busy} run={run} fetchOptions={fetchOptions} />}
      {methods.length === 0 && <Problem text="No sign-in methods are set up on this deployment." />}
      {problem && <Problem text={problem} />}
    </div>
  )
}

/** Email and password, for local deployments only: there's no email verification behind it. */
function PasswordForm({
  busy,
  run,
  fetchOptions,
}: {
  busy: boolean
  run: (attempt: () => Promise<{ error: { message?: string } | null }>) => Promise<void>
  fetchOptions: { query: DesktopRequest }
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <form
      className="mt-2 grid gap-2 border-t pt-5"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => authClient.signIn.email({ email, password, fetchOptions }))
      }}
    >
      <p className={label}>Email and password (testing)</p>
      <input className={input} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input
        className={input}
        type="password"
        autoComplete="current-password"
        placeholder="Password, 8 characters or more"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <div className="flex gap-2">
        <button type="submit" className={buttonLarge} disabled={busy}>
          Sign in
        </button>
        <button
          type="button"
          className={`${buttonQuiet} h-10 text-[15px]`}
          disabled={busy || !email || password.length < 8}
          onClick={() => void run(() => authClient.signUp.email({ email, password, name: email.split('@')[0] ?? email, fetchOptions }))}
        >
          Create account
        </button>
      </div>
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
