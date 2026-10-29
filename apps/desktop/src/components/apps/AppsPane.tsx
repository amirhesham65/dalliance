import { AppWindow, Plus, RefreshCw } from 'lucide-react'
import { Pane } from '@/components/panes/Pane'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { appActions, useApps } from '@/store/apps-store'
import { actions, useNotebook } from '@/store/notebook-store'
import { cn } from '@/lib/utils'

export function AppsPane() {
  const apps = useApps((s) => s.apps)
  const selected = useApps((s) => s.selectedId)
  const loading = useApps((s) => s.loading)
  const error = useApps((s) => s.error)
  const create = () => {
    appActions.notebook()
    actions.insertCell(useNotebook.getState().notebook.cells.length, 'prompt')
    const id = useNotebook.getState().selectedId
    if (id) {
      actions.setPrompt(id, "Let's create an app that ")
      actions.focus(id)
    }
  }
  return (
    <Pane title="Apps" icon={<AppWindow />} onClose={() => actions.openPane(null)} actions={
      <IconButton label="Refresh apps" size="icon-xs" onClick={() => void appActions.refresh()}><RefreshCw className={cn(loading && 'animate-spin')} /></IconButton>
    } footer="Apps belong to this project. Notebook data is saved as snapshots.">
      <div className="px-3 pb-3">
        <Button size="sm" variant="secondary" className="mb-3 w-full justify-start gap-2" onClick={create}><Plus className="size-3.5" />Create an app</Button>
        {error && <p role="alert" className="mb-3 text-[13px] text-destructive">{error}</p>}
        {!apps.length && <p className="px-1 text-[13px] leading-relaxed text-muted-foreground">{loading ? 'Reading project apps…' : 'Turn an analysis into an interactive app. Describe what it should do in a prompt cell, then run it.'}</p>}
        <ul className="space-y-1" aria-label="Project apps">
          {apps.map((app) => (
            <li key={app.id}>
              <button type="button" aria-pressed={selected === app.id} onClick={() => void appActions.open(app.id)} className={cn('w-full rounded-lg px-3 py-2.5 text-left hover:bg-hover focus-visible:outline-ring', selected === app.id && 'bg-hover')}>
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  <span className={cn('size-1.5 shrink-0 rounded-full bg-faint', app.status === 'running' && 'bg-go', app.status === 'starting' && 'bg-warn pulse', app.status === 'error' && 'bg-destructive')} />
                  <span className="truncate">{app.title}</span>
                  <span className="ml-auto text-[11px] font-normal text-faint">{app.status}</span>
                </span>
                {app.description && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{app.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Pane>
  )
}
