'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { gutter, sheet } from '@dalliance/brand/ui'

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
      <div ref={sentinel} className="-mb-px h-px" aria-hidden />
      {/* Full width, so the paper behind it covers the full-bleed reel as it passes underneath. Frosted only
          once stuck; at rest it is plain paper, so no strip shows past the sheet. */}
      <header
        data-stuck={stuck || undefined}
        className="group sticky top-0 z-20 bg-paper transition-shadow duration-120 ease-out motion-reduce:transition-none data-stuck:shadow-[0_1px_0_var(--hairline)] supports-[backdrop-filter:blur(1px)]:data-stuck:bg-paper/86 supports-[backdrop-filter:blur(1px)]:data-stuck:backdrop-blur-md supports-[backdrop-filter:blur(1px)]:data-stuck:backdrop-saturate-140"
      >
        <div className={`${sheet} ${gutter} flex items-center justify-between gap-4 border-b pt-[max(12px,env(safe-area-inset-top))] pb-3 group-data-stuck:border-transparent`}>
          {children}
        </div>
      </header>
    </>
  )
}
