'use client'

import { useEffect, useRef, useState } from 'react'
import { installCommand } from '@/lib/site'
import { focusRing } from '@dalliance/brand/ui'

/**
 * The Terminal install command, with a button that copies it. It installs without the unidentified developer
 * warning the DMG gets until releases are notarized. See docs/releasing.md.
 */
export function InstallCommand({ centred = false }: { centred?: boolean }) {
  const [copied, setCopied] = useState(false)
  const code = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  // When the browser won't allow it, select the command instead, so Cmd+C copies it
  const copy = () =>
    navigator.clipboard.writeText(installCommand).then(
      () => setCopied(true),
      () => {
        if (code.current) getSelection()?.selectAllChildren(code.current)
      },
    )

  return (
    <div className={`mt-4 flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 ${centred ? 'justify-center' : ''}`}>
      <span className="text-[13px] text-ink-subtle">Or in Terminal</span>
      <div className="flex h-9 max-w-full min-w-0 items-center rounded-lg border bg-paper pr-1 pl-3 font-mono text-[13px] text-ink">
        <span className="mr-2 text-ink-faint select-none" aria-hidden>
          $
        </span>
        <code ref={code} className="min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">{installCommand}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy the install command'}
          className={`ml-2 grid size-7 shrink-0 place-items-center rounded-md text-ink-subtle transition-colors duration-120 ease-out hover:bg-cell hover:text-ink motion-reduce:transition-none ${focusRing}`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </div>
    </div>
  )
}

const icon = 'size-[15px] fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]'

function CopyIcon() {
  return (
    <svg className={icon} viewBox="0 0 24 24" aria-hidden>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className={icon} viewBox="0 0 24 24" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
