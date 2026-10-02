import { brand } from '@dalliance/brand/brand'
import { gutter, sheet } from '@dalliance/brand/ui'
import { Wordmark } from './Wordmark'

/** The hatched band and the top bar, as on the website, without its download and GitHub buttons. */
export function SiteHeader() {
  return (
    <>
      <div className={sheet}>
        <div className="h-10 border-b bg-hatch fade-down lg:h-14" aria-hidden />
      </div>
      <header className={`${sheet} ${gutter} flex items-center justify-between gap-4 border-b pt-[max(12px,env(safe-area-inset-top))] pb-3`}>
        <Wordmark />
      </header>
    </>
  )
}

export function SiteFooter() {
  return (
    <div className={sheet}>
      <footer
        className={`${gutter} flex items-center justify-between gap-4 pt-8 pb-[max(56px,env(safe-area-inset-bottom))] text-[13px] text-ink-subtle max-sm:flex-col max-sm:items-start max-sm:gap-3`}
      >
        <span>© 2026 {brand.author}</span>
        <nav aria-label="Footer" className="flex gap-4 [&_a]:text-ink-subtle [&_a:hover]:text-ink">
          <a href={brand.website}>Website</a>
          <a href={`${brand.website}/privacy`}>Privacy</a>
        </nav>
      </footer>
    </div>
  )
}
