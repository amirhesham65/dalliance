'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * The top bar. It scrolls with the page until it reaches the top, then stays there. Once stuck, its rule
 * runs the full width, since the content passing under it (the reel) does too.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    // The sentinel sits just above the bar, so it leaves the viewport exactly when the bar sticks
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinel} className="bar-sentinel" aria-hidden />
      <header className="bar" data-stuck={stuck || undefined}>
        <div className="sheet topbar gutter">{children}</div>
      </header>
    </>
  )
}
