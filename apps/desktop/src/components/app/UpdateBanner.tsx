import { X } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { getApi, useNotebook } from '@/store/notebook-store'

/**
 * Says a newer Dalliance is out, over the start page and the notebook alike. Download opens the website's download
 * in the browser. Dismissing it hides that version for the session. See docs/releasing.md.
 */
export function UpdateBanner() {
  const update = useNotebook((s) => s.update)
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!update || update.version === dismissed) return null
  return (
    <div role="status" className="mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-background py-2 pr-2 pl-4 text-[13px] shadow-pane">
      <span className="text-muted-foreground">Dalliance {update.version} is available.</span>
      <Button size="xs" variant="secondary" onClick={() => void getApi()?.downloadUpdate()}>
        Download
      </Button>
      <IconButton label="Dismiss update" size="icon-xs" className="ml-auto" onClick={() => setDismissed(update.version)}>
        <X />
      </IconButton>
    </div>
  )
}
