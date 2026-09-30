import type { Metadata } from 'next'
import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { signInMethods } from '@/lib/auth/methods'
import { headline, labelMono, mastheadRuled, sheet, support } from '@/lib/ui'
import { SignIn, type DesktopRequest } from './SignIn'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } }

/** The desktop app opens this page with a PKCE challenge. Without one there's nothing to sign in to yet. */
function desktopRequest(params: Record<string, string | string[] | undefined>): DesktopRequest | null {
  const one = (key: string) => (typeof params[key] === 'string' ? params[key] : undefined)
  const clientId = one('client_id')
  const state = one('state')
  const challenge = one('code_challenge')
  if (!clientId || !state || !challenge) return null
  return { client_id: clientId, state, code_challenge: challenge, code_challenge_method: one('code_challenge_method') ?? 'S256' }
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const request = desktopRequest(params)
  const error = typeof params.error === 'string' ? params.error : null
  return (
    <>
      <SiteHeader />
      <div className={sheet}>
        <main id="main" className={mastheadRuled}>
          <p className={`${labelMono} mb-4`}>Dalliance account</p>
          <h1 className={headline}>Sign in to Dalliance</h1>
          {request ? (
            <>
              <p className={support}>Once you're signed in, this page sends you back to the app.</p>
              <SignIn request={request} methods={signInMethods()} error={error} />
            </>
          ) : (
            <p className={support}>Open Dalliance and choose Sign in in Settings. The app opens this page with what it needs to finish.</p>
          )}
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
