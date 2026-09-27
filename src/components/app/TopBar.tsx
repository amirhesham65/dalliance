import { PanelLeft, Play, RotateCw, Settings, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { actions, getApi, useNotebook } from '@/store/notebook-store'
import { IconButton } from './IconButton'

interface TopBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

const KERNEL_LABEL = { starting: 'starting', idle: 'idle', busy: 'running', dead: 'not running' } as const

export function TopBar({ sidebarOpen, onToggleSidebar, onOpenSettings }: TopBarProps) {
  const path = useNotebook((s) => s.path)
  const dirty = useNotebook((s) => s.dirty)
  const kernel = useNotebook((s) => s.kernel)
  const busy = useNotebook((s) => Object.keys(s.runs).length > 0)
  const platform = getApi()?.platform
  const name = path ? (path.split(/[\\/]/).pop() ?? path) : 'Untitled'

  return (
    <header
      className={cn(
        'app-drag flex h-12 shrink-0 items-center gap-2 border-b px-3 text-[13.5px]',
        // Leave room for the native window controls drawn over the bar
        platform === 'darwin' && 'pl-[84px]',
        platform && platform !== 'darwin' && 'pr-[150px]',
      )}
    >
      <IconButton label={sidebarOpen ? 'Hide outline' : 'Show outline'} aria-expanded={sidebarOpen} onClick={onToggleSidebar} className="app-no-drag">
        <PanelLeft />
      </IconButton>
      <span className="truncate font-medium" title={path ?? undefined}>
        {name.replace(/\.ipynb$/, '')}
      </span>
      {dirty && <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-label="Unsaved changes" />}
      <span className="hidden items-center gap-1.5 text-faint sm:flex" title={kernel.error ?? kernel.cwd}>
        <span
          className={cn(
            'size-1.5 rounded-full',
            kernel.status === 'idle' && 'bg-go',
            (kernel.status === 'busy' || kernel.status === 'starting') && 'bg-warn',
            kernel.status === 'dead' && (kernel.error ? 'bg-destructive' : 'bg-faint'),
          )}
        />
        {kernel.python ? `Python ${kernel.python}` : 'Python'} · {KERNEL_LABEL[kernel.status]}
      </span>

      <div className="app-no-drag ml-auto flex items-center gap-1">
        {busy && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void actions.interrupt()}>
            <Square className="size-3 fill-current" />
            Stop
          </Button>
        )}
        <IconButton label="Restart kernel" onClick={() => void actions.restart()}>
          <RotateCw />
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}>
          <Settings />
        </IconButton>
        <Button variant="secondary" size="sm" onClick={() => actions.runAll()}>
          <Play className="fill-go text-go" />
          Run all
        </Button>
      </div>
    </header>
  )
}
