import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { site } from '@/lib/site'
import { headline, labelMono, mastheadRuled, sheet, support } from '@/lib/ui'

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <div className={sheet}>
        <main id="main" className={mastheadRuled}>
          <p className={`${labelMono} mb-4`}>[404]</p>
          <h1 className={headline}>Nothing here</h1>
          <p className={support}>
            This address only handles sign-in and billing for the Dalliance app. The website is at <a href={site.website}>dalliance.io</a>.
          </p>
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
