'use client'

import { type ImgHTMLAttributes, useEffect, useRef, useState } from 'react'

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
    <section className="reel" aria-labelledby="reel-title">
      <div className="reel-head">
        <h2 id="reel-title">{title}</h2>
        <p>{intro}</p>
        <div className="pager">
          <button type="button" aria-label="Previous screenshot" aria-controls="track" disabled={current === 0} onClick={() => go(current - 1)}>
            <Chevron d="m15 18-6-6 6-6" />
          </button>
          <button type="button" aria-label="Next screenshot" aria-controls="track" disabled={current === frames.length - 1} onClick={() => go(current + 1)}>
            <Chevron d="m9 18 6-6-6-6" />
          </button>
        </div>
      </div>

      <div className={live ? 'track live' : 'track'} id="track" ref={track} tabIndex={0} role="group" aria-label="Screenshots of Dalliance, scrollable">
        {frames.map((f, i) => (
          <figure key={f.label} className={i === current ? 'frame here' : 'frame'} onClick={i === current ? undefined : () => go(i)}>
            {/* One picture per frame, so a dark page never shows a light app and the browser fetches only one file */}
            <picture>
              <source media="(prefers-color-scheme: dark)" srcSet={f.dark} sizes={f.img.sizes} />
              <img {...f.img} alt={f.img.alt} />
            </picture>
            <figcaption className="visually-hidden">{f.label}</figcaption>
          </figure>
        ))}
      </div>

      <div className="ledger" role="group" aria-label="Choose a screenshot">
        {frames.map((f, i) => (
          <button key={f.label} type="button" aria-current={i === current} aria-controls="track" onClick={() => go(i)}>
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            {f.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function Chevron({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
