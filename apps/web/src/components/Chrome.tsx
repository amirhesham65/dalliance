import Link from 'next/link'
import type { ReactNode } from 'react'
import { site } from '@/lib/site'
import { button, buttonLarge, buttonQuiet, gutter, label, sheet } from '@dalliance/brand/ui'
import { InstallCommand } from './InstallCommand'
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
        <div className="flex items-center gap-2 sm:gap-5">
          {/* No room beside the download button on a phone, where the footer links it instead */}
          <Link className="text-[14px] font-medium text-ink-subtle no-underline hover:text-ink max-sm:hidden" href="/blog">
            Blog
          </Link>
          <a className={`${buttonQuiet} max-sm:size-8 max-sm:p-0`} href={site.sourceUrl} target="_blank" rel="noreferrer" aria-label="GitHub">
            <GitHubLogo />
            <span className="max-sm:hidden">GitHub</span>
          </a>
          <a className={button} href="/download?from=bar">
            <AppleLogo />
            Download for macOS
          </a>
        </div>
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
export function Act({ from, centred = false }: { from: string; centred?: boolean }) {
  return (
    <>
      <div className={`mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 ${centred ? 'justify-center' : ''}`}>
        <a className={buttonLarge} href={`/download?from=${from}`}>
          <AppleLogo />
          Download for macOS
        </a>
        <a className={`${buttonQuiet} h-10 gap-2 px-4 text-[15px] [&_svg]:mr-0`} href={site.sourceUrl} target="_blank" rel="noreferrer">
          <GitHubLogo />
          GitHub
        </a>
      </div>
      <InstallCommand centred={centred} />
    </>
  )
}

function GitHubLogo() {
  return (
    <svg className="size-4 shrink-0 sm:mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.105.773-.24.773-.535 0-.267-.01-1.155-.016-2.096-3.13.68-3.791-1.327-3.791-1.327-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.078-.686.078-.686 1.13.08 1.725 1.16 1.725 1.16 1.006 1.724 2.64 1.225 3.284.937.102-.728.394-1.225.716-1.507-2.499-.284-5.126-1.25-5.126-5.563 0-1.23.44-2.234 1.16-3.023-.117-.285-.503-1.43.11-2.98 0 0 .945-.303 3.095 1.155A10.78 10.78 0 0 1 12 6.183c.956.004 1.919.129 2.818.379 2.148-1.458 3.09-1.155 3.09-1.155.616 1.55.23 2.695.114 2.98.723.789 1.159 1.793 1.159 3.023 0 4.324-2.632 5.276-5.139 5.554.404.35.764 1.04.764 2.096 0 1.513-.014 2.733-.014 3.105 0 .298.203.645.774.535A11.25 11.25 0 0 0 12 .75Z" />
    </svg>
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
          <Link href="/blog">Blog</Link>
          <Link href="/privacy">Privacy</Link>
          <a href={site.sourceUrl} target="_blank" rel="noreferrer">Source</a>
        </nav>
      </footer>
    </div>
  )
}
