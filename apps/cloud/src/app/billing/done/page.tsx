import type { Metadata } from 'next'
import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { DESKTOP_SCHEME } from '@/lib/auth/client'
import { buttonLarge, headline, labelMono, mastheadRuled, sheet, support } from '@dalliance/brand/ui'

export const metadata: Metadata = { title: 'Back to Dalliance', robots: { index: false, follow: false } }

/**
 * Where Polar sends the browser after checkout, with ?checkout_id, and after the billing portal. The plan reaches
 * the app through Polar's webhook, not through this page, so it only has to say so.
 */
export default async function BillingDone({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const paid = typeof (await searchParams).checkout_id === 'string'
  return (
    <>
      <SiteHeader />
      <div className={sheet}>
        <main id="main" className={mastheadRuled}>
          <p className={`${labelMono} mb-4`}>Dalliance plan</p>
          <h1 className={headline}>{paid ? 'Thanks, you’re subscribed' : 'Back to the app'}</h1>
          <p className={support}>
            {paid
              ? 'Dalliance picks up the new plan on its own within a few seconds. You can close this tab.'
              : 'Any change you made shows up in Dalliance on its own. You can close this tab.'}
          </p>
          <div className="mt-6">
            <a className={buttonLarge} href={`${DESKTOP_SCHEME}://billing`}>
              Open Dalliance
            </a>
          </div>
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
