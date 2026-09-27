import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter, SiteHeader } from '@/components/Chrome'

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } }

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <div className="sheet">
        <main id="main" className="masthead ruled gutter">
          <p className="eyebrow meta" aria-hidden>
            [404]
          </p>
          <h1>This cell has no output.</h1>
          <p className="support">This page does not exist.</p>
          <div className="act">
            <Link className="btn lg" href="/">
              Back to the home page
            </Link>
          </div>
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
