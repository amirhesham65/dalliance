import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { headline, labelMono, mastheadRuled, sheet } from '@dalliance/brand/ui'
import { Handoff } from './Handoff'

export const metadata: Metadata = { title: 'Back to Dalliance', robots: { index: false, follow: false } }

// Set by the Electron plugin once sign-in finishes: `${cookiePrefix}.${clientID}`, readable for two minutes
const HANDOFF_COOKIE = 'better-auth.electron'

export default async function DonePage() {
  const code = (await cookies()).get(HANDOFF_COOKIE)?.value ?? null
  return (
    <>
      <SiteHeader />
      <div className={sheet}>
        <main id="main" className={mastheadRuled}>
          <p className={`${labelMono} mb-4`}>Dalliance account</p>
          <h1 className={headline}>Back to the app</h1>
          <Handoff code={code} />
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
