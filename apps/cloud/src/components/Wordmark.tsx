import { MARK_SQUARES } from '@/lib/mark'
import { site } from '@/lib/site'

export function Mark() {
  return (
    // 17.5px keeps each of the seven rows on whole device pixels on Retina screens
    <svg className="block h-[17.5px] w-auto shrink-0 fill-current" viewBox="0 0 6 7" shapeRendering="crispEdges" aria-hidden>
      {MARK_SQUARES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  )
}

/** Links to the website, since this service has no home page of its own. */
export function Wordmark() {
  return (
    <a className="inline-flex items-center gap-2 font-serif text-[17px] font-semibold tracking-[-0.02em] text-ink no-underline" href={site.website} aria-label="Dalliance website">
      <Mark />
      Dalliance
    </a>
  )
}
