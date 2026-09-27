/** Class groups the pages share, so the ruled-sheet grammar is spelled once. */

/** The ruled column every band sits in */
export const sheet = 'mx-auto max-w-sheet border-x'
/** Inline padding that lands every band's text on the same vertical line */
export const gutter = 'px-4 sm:px-6 lg:px-14'
/** Small uppercase labels that name a group, as in the app's sidebar. Never a control. */
const labelBase = 'text-[12px] leading-[1.3] font-medium text-ink-subtle uppercase'
export const label = `${labelBase} tracking-[0.08em]`
/** The same label in the code face, for dates and codes like [404] */
export const labelMono = `${labelBase} font-mono tracking-[0.04em]`

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper'

/** The download control: a link styled as the app's primary button */
const buttonBase = `inline-flex items-center justify-center rounded-lg bg-brand leading-[normal] font-medium whitespace-nowrap text-on-brand no-underline transition-[background-color,transform] duration-120 ease-out hover:bg-brand-hover active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${focusRing}`
export const button = `${buttonBase} h-8 px-3 text-[14px]`
export const buttonLarge = `${buttonBase} h-10 px-4 text-[15px]`
/** A link that sits beside the download button without competing with it: paper, a hairline, ink text */
export const buttonQuiet = `inline-flex h-8 items-center justify-center rounded-lg border bg-paper px-3 text-[14px] leading-[normal] font-medium whitespace-nowrap text-ink no-underline transition-[background-color,transform] duration-120 ease-out hover:bg-cell active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${focusRing}`

/** Masthead headline and the line under it, on every page */
export const headline = 'max-w-[22ch] font-serif text-[36px] leading-[1.15] font-medium tracking-[-0.02em] text-balance text-ink lg:max-w-[24ch] lg:text-[54px]'
export const support = 'mt-6 max-w-[56ch] text-pretty lg:text-[18px] lg:leading-[1.5]'
/** A masthead with its own bottom rule, for pages without the reel to supply one */
export const mastheadRuled = `${gutter} border-b pt-16 pb-14 lg:pt-26 lg:pb-22`

export { focusRing }
