import { X } from 'lucide-react'
import { useState } from 'react'
import type { PinChange } from '@dalliance/shared/ipc'
import { IconButton } from '@/components/app/IconButton'
import { describePinChange } from '@/lib/pins'
import { actions, useNotebook } from '@/store/notebook-store'

/** How many changes the banner lists before it offers the rest. */
const SHOWN = 3

/**
 * A quiet line over the notebook when the Python, a package or a data file differs from what the notebook was saved
 * with. Nothing when nothing did. Dismissing it hides it until the next check. See docs/renderer.md#layout.
 */
export function PinChangesBanner() {
  const changes = useNotebook((s) => s.pinChanges)
  // Open for this list of changes only, so a new check starts folded again
  const [openFor, setOpenFor] = useState<PinChange[] | null>(null)
  if (!changes.length) return null
  const open = openFor === changes
  const shown = open ? changes : changes.slice(0, SHOWN)
  const more = changes.length - shown.length
  return (
    <div
      role="status"
      aria-label="Changed since this notebook was saved"
      className="mx-2 mb-2 flex items-start gap-3 rounded-xl border bg-background py-2 pr-2 pl-4 text-[13px] shadow-pane"
    >
      <p className="min-w-0 flex-1 py-0.5 text-muted-foreground">
        <span className="text-foreground">Changed since this notebook was saved:</span> {shown.map(describePinChange).join('; ')}
        {more > 0 && (
          <>
            {'; '}
            <button type="button" className="underline decoration-foreground/20 underline-offset-2 hover:text-foreground" onClick={() => setOpenFor(changes)}>
              and {more} more
            </button>
          </>
        )}
        .
      </p>
      <IconButton label="Dismiss what changed" size="icon-xs" onClick={() => actions.dismissPinChanges()}>
        <X />
      </IconButton>
    </div>
  )
}
