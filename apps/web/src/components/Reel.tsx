'use client'

import { type ImgHTMLAttributes, useEffect, useRef, useState } from 'react'
import { focusRing, label } from '@/lib/ui'

export type Frame = {
  label: string
  /** srcSet for the dark capture; the img carries the light one */
  dark: string
  img: ImgHTMLAttributes<HTMLImageElement>
}

/**
 * Captures of the app in a scroll-snapping track, with a ledger underneath that names the current frame
 * and jumps to any other. It never moves on its own.
 */
export function Reel({ title, intro, frames }: { title: string; intro: string; frames: Frame[] }) {
  const track = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const el = track.current
    if (!el) return
    setLive(true)
    let raf = 0
    // The current frame is the one whose left edge sits closest to the track's snap line
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const inset = parseFloat(getComputedStyle(el).scrollPaddingInlineStart) || 0
        let best = 0
        let distance = Infinity
        Array.from(el.children).forEach((child, i) => {
          const d = Math.abs((child as HTMLElement).offsetLeft - inset - el.scrollLeft)
          if (d < distance) [best, distance] = [i, d]
        })
        setCurrent(best)
      })
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  const go = (i: number) => {
    const el = track.current
    const child = el?.children[i] as HTMLElement | undefined
    if (!el || !child) return
    const inset = parseFloat(getComputedStyle(el).scrollPaddingInlineStart) || 0
    el.scrollTo({ left: child.offsetLeft - inset })
  }

  return (
    // The one place the ruled page opens: this band sits outside the sheet, so its rules run the full
    // viewport. Its inset lands on the sheet's gutter, so the label, the first frame and the ledger all
    // start on the same line as the headline above.
    <section
      aria-labelledby="reel-title"
      className="border-y pt-8 pb-6 [--frame-width:min(980px,86vw)] [--reel-inset:max(16px,calc((100%_-_var(--container-sheet))/2_+_16px))] sm:[--reel-inset:max(24px,calc((100%_-_var(--container-sheet))/2_+_24px))] lg:pt-14 lg:pb-8 lg:[--reel-inset:max(56px,calc((100%_-_var(--container-sheet))/2_+_56px))]"
    >
      <div className="mb-4 px-(--reel-inset) lg:mb-10 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_auto] lg:gap-14">
        <h2 id="reel-title" className={`${label} mb-4 lg:mb-0 lg:pt-[5px]`}>
          {title}
        </h2>
        <p className="max-w-[60ch] text-pretty">{intro}</p>
        {/* Prev and next at the head's right margin, never on top of a capture. Pointer screens only: on a
            phone the whole track is there to swipe. */}
        <div className="hidden lg:-mr-2 lg:flex lg:gap-1 lg:self-start">
          <button type="button" className={pagerButton} aria-label="Previous screenshot" aria-controls="track" disabled={current === 0} onClick={() => go(current - 1)}>
            <Chevron d="m15 18-6-6 6-6" />
          </button>
          <button type="button" className={pagerButton} aria-label="Next screenshot" aria-controls="track" disabled={current === frames.length - 1} onClick={() => go(current + 1)}>
            <Chevron d="m9 18 6-6-6-6" />
          </button>
        </div>
      </div>

      {/* Room after the last frame, so every frame, the last included, can snap to the headline's line; and
          room above and below for the frames' shadows, deepest below */}
      <div
        className="relative flex scroll-px-(--reel-inset) items-start gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth scrollbar-none snap-x snap-mandatory ps-(--reel-inset) pe-[max(var(--reel-inset),calc(100%_-_var(--frame-width)_-_var(--reel-inset)))] pt-3 pb-11 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ink)] motion-reduce:scroll-auto lg:gap-8"
        id="track"
        ref={track}
        tabIndex={0}
        role="group"
        aria-label="Screenshots of Dalliance, scrollable"
      >
        {frames.map((f, i) => (
          <figure
            key={f.label}
            // Captures are 3200 by 2000, so the frame holds that aspect. A frame other than the current one brings
            // itself over when clicked; the current one stays put.
            className={`aspect-[16/10] shrink-0 grow-0 basis-(--frame-width) snap-start overflow-hidden rounded-xl bg-hairline shadow-frame ${live && i !== current ? 'cursor-pointer' : ''}`}
            onClick={i === current ? undefined : () => go(i)}
          >
            {/* One picture per frame, so a dark page never shows a light app and the browser fetches only one file */}
            <picture className="contents">
              <source media="(prefers-color-scheme: dark)" srcSet={f.dark} sizes={f.img.sizes} />
              <img {...f.img} alt={f.img.alt} className="block size-full object-cover" />
            </picture>
            <figcaption className="sr-only">{f.label}</figcaption>
          </figure>
        ))}
      </div>

      {/* The ledger: a tick per frame, the current one inked */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 px-(--reel-inset) lg:mt-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none lg:gap-4" role="group" aria-label="Choose a screenshot">
        {frames.map((f, i) => (
          <button
            key={f.label}
            type="button"
            aria-current={i === current}
            aria-controls="track"
            onClick={() => go(i)}
            className={`group flex w-full cursor-pointer items-baseline gap-2 border-t-2 border-hairline pt-2 text-left text-[14px] text-ink-subtle transition-colors duration-120 ease-out hover:text-ink aria-[current=true]:border-accent aria-[current=true]:font-medium aria-[current=true]:text-ink focus-visible:rounded-sm ${focusRing}`}
          >
            <span className="font-mono text-[12px] text-ink-faint tabular-nums group-aria-[current=true]:text-ink">{String(i + 1).padStart(2, '0')}</span>
            {f.label}
          </button>
        ))}
      </div>
    </section>
  )
}

const pagerButton =
  'flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-subtle transition-colors duration-120 ease-out outline-none enabled:hover:bg-hairline enabled:hover:text-ink focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-default disabled:opacity-40'

function Chevron({ d }: { d: string }) {
  return (
    <svg className="block size-[18px]" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
