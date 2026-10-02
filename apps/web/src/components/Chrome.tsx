import Link from 'next/link'
import type { ReactNode } from 'react'
import { site } from '@/lib/site'
import { button, buttonLarge, gutter, label, sheet } from '@dalliance/brand/ui'
import { StickyBar } from './StickyBar'
import { Wordmark } from './Wordmark'

/** The hatched band and the top bar that open every page. */
export function SiteHeader() {
  return (
    <>
      <div className={sheet}>
        <div className="h-10 border-b bg-hatch fade-down lg:h-14" aria-hidden />
      </div>
      <StickyBar>
        <Wordmark />
        <a className={button} href="/download?from=bar">
          <AppleLogo />
          Download for macOS
        </a>
      </StickyBar>
    </>
  )
}

/**
 * A ruled band: its label in the left margin, the copy beside it, so a page reads as a document rather
 * than a stack of headings. Labels must stay short enough to hold one line in the 200px column.
 */
export function Band({ title, labelId, id, children }: { title: string; labelId: string; id?: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={labelId}
      className={`${gutter} scroll-mt-18 border-b py-8 lg:grid lg:grid-cols-[200px_1fr] lg:gap-14 lg:py-14 [&_p]:max-w-[62ch] [&_p]:text-pretty [&_p+p]:mt-4 [&_strong]:font-semibold [&_strong]:text-ink`}
    >
      <h2 id={labelId} className={`${label} mb-4 lg:mb-0 lg:pt-[5px]`}>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** `from` tells the download log which button was pressed */
export function Act({ from }: { from: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      <a className={buttonLarge} href={`/download?from=${from}`}>
        <AppleLogo />
        Download for macOS
      </a>
      <span className="text-[13px] text-ink-subtle">{site.status}</span>
    </div>
  )
}

function AppleLogo() {
  return (
    // Sized to the cap height, and nudged up a hair so the leaf does not sit low against the label
    <svg className="-mt-[0.12em] mr-[0.45em] size-[0.9em] shrink-0 fill-current" viewBox="0 0 814 1000" aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  )
}

export function SiteFooter() {
  return (
    <div className={sheet}>
      <footer
        className={`${gutter} flex items-center justify-between gap-4 pt-8 pb-[max(56px,env(safe-area-inset-bottom))] text-[13px] text-ink-subtle max-sm:flex-col max-sm:items-start max-sm:gap-3`}
      >
        <span>© 2026 {site.author}</span>
        <nav aria-label="Footer" className="flex gap-4 [&_a]:text-ink-subtle [&_a:hover]:text-ink">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  )
}
