import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { buttonLarge, headline, labelMono, mastheadRuled, sheet, support } from '@dalliance/brand/ui'

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } }

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <div className={sheet}>
        <main id="main" className={mastheadRuled}>
          <p className={`${labelMono} mb-4`} aria-hidden>
            [404]
          </p>
          <h1 className={headline}>This cell has no output.</h1>
          <p className={support}>This page does not exist.</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Link className={buttonLarge} href="/">
              Back to the home page
            </Link>
          </div>
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
