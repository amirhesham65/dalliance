import { ChevronDown, FilePlus, FolderOpen, PanelLeft, Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ago, modelLabel } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { Effort, Provider, RecentNotebook } from '@/shared/ipc'
import { actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'
import { IconButton } from './IconButton'

interface TopBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

export function TopBar({ sidebarOpen, onToggleSidebar, onOpenSettings }: TopBarProps) {
  const platform = getApi()?.platform
  return (
    <header
      className={cn(
        'app-drag flex h-12 shrink-0 items-center gap-2 px-3 text-[13px]',
        // Leave room for the native window controls drawn over the bar
        platform === 'darwin' && 'pl-[84px]',
        platform && platform !== 'darwin' && 'pr-[150px]',
      )}
    >
      <IconButton label={sidebarOpen ? 'Hide overview' : 'Show overview'} aria-expanded={sidebarOpen} onClick={onToggleSidebar} className="app-no-drag">
        <PanelLeft />
      </IconButton>
      <NotebookTab />
      <div className="app-no-drag ml-auto flex items-center gap-1">
        <ModelChip onOpenSettings={onOpenSettings} />
        <IconButton label="Settings" onClick={onOpenSettings}>
          <Settings />
        </IconButton>
      </div>
    </header>
  )
}

/** The open notebook as a tab. It opens a list of recent notebooks, like switching workspaces. */
function NotebookTab() {
  const path = useNotebook((s) => s.path)
  const dirty = useNotebook((s) => s.dirty)
  const busy = useNotebook((s) => Object.values(s.runs).some((r) => r.status === 'running'))
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<RecentNotebook[]>([])
  const api = getApi()
  const name = path ? (path.split(/[\\/]/).pop() ?? path).replace(/\.ipynb$/, '') : 'Untitled'

  const load = async (fn: () => Promise<{ notebook: import('@/shared/notebook').Notebook; path: string | null } | null>) => {
    setOpen(false)
    if (!api || !(await api.confirmDiscard())) return
    const opened = await fn()
    if (opened) actions.load(opened.notebook, opened.path)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void api?.recentNotebooks().then(setRecent)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="app-no-drag flex h-8 max-w-[360px] items-center gap-2 rounded-lg border bg-background px-3 shadow-pane hover:border-ring/70"
          title={path ?? undefined}
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', busy ? 'bg-go pulse' : 'bg-go/70')} />
          <span className="truncate font-medium">{name}</span>
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-label="Unsaved changes" />}
          <ChevronDown className="size-3.5 shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="eyebrow px-2 pt-1.5 pb-1">Recent</p>
        {recent.length ? (
          <ul className="flex flex-col">
            {recent.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  onClick={() => void load(() => api!.openRecent(r.path))}
                  className={cn('flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover', r.path === path && 'bg-hover')}
                  title={r.path}
                >
                  <span className="truncate">{r.name}</span>
                  <span className="truncate text-xs text-faint">{r.folder}</span>
                  <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">{ago(r.openedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-1.5 text-[13px] text-faint">Notebooks you open or save show up here.</p>
        )}
        <div className="mt-1 flex flex-col border-t pt-1">
          <MenuButton
            icon={<FilePlus />}
            label="New notebook"
            onClick={() =>
              void load(async () => {
                await api?.restartKernel()
                return { notebook: welcomeNotebook(), path: null }
              })
            }
          />
          <MenuButton icon={<FolderOpen />} label="Open…" onClick={() => void load(() => api!.openNotebook())} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover [&_svg]:size-3.5 [&_svg]:text-faint">
      {icon}
      {label}
    </button>
  )
}

const PRESETS: Record<Provider, { id: string; label: string; note: string }[]> = {
  gateway: [
    { id: 'anthropic/claude-opus-5', label: 'Opus 5', note: 'Best for hard analysis' },
    { id: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', note: 'Fast and capable' },
    { id: 'anthropic/claude-haiku-4.5', label: 'Haiku 4.5', note: 'Fastest, simple cells' },
  ],
  anthropic: [
    { id: 'claude-opus-5', label: 'Opus 5', note: 'Best for hard analysis' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'Fast and capable' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'Fastest, simple cells' },
  ],
}

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
]

/** Which model writes the cells, and how hard it thinks. One click away instead of in Settings. */
function ModelChip({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useNotebook((s) => s.settings)
  const [open, setOpen] = useState(false)
  const api = getApi()
  if (!settings || !api) return null
  const update = async (u: Parameters<typeof api.updateSettings>[0]) => {
    useNotebook.setState({ settings: await api.updateSettings(u) })
  }
  const presets = PRESETS[settings.provider]
  const custom = !presets.some((p) => p.id === settings.model)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-muted-foreground hover:bg-background hover:text-foreground aria-expanded:bg-background">
          <Sparkles className="size-3.5" />
          <span>{modelLabel(settings.model)}</span>
          <span className="text-faint">· {EFFORTS.find((e) => e.value === settings.effort)?.label.toLowerCase()}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="eyebrow px-2 pt-1.5 pb-1">Model</p>
        <ul className="flex flex-col">
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={settings.model === p.id}
                onClick={() => void update({ model: p.id })}
                className={cn('flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover', settings.model === p.id && 'bg-hover')}
              >
                <span className={cn('size-1.5 shrink-0 translate-y-[-1px] rounded-full', settings.model === p.id ? 'bg-ink' : 'bg-transparent')} />
                <span>{p.label}</span>
                <span className="ml-auto text-xs text-faint">{p.note}</span>
              </button>
            </li>
          ))}
          {custom && (
            <li className="flex items-baseline gap-2 rounded-lg bg-hover px-2 py-1.5 text-[13px]">
              <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-ink" />
              <span className="truncate font-mono text-xs">{settings.model}</span>
            </li>
          )}
        </ul>
        <p className="eyebrow px-2 pt-3 pb-1.5">Effort</p>
        <div className="mx-2 flex rounded-lg bg-hover p-0.5" role="group" aria-label="Effort">
          {EFFORTS.map((e) => (
            <button
              key={e.value}
              type="button"
              aria-pressed={settings.effort === e.value}
              onClick={() => void update({ effort: e.value })}
              className={cn(
                'flex-1 rounded-md py-1 text-xs',
                settings.effort === e.value ? 'bg-background text-foreground shadow-pane' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className="mt-2 border-t pt-1">
          <MenuButton
            icon={<Settings />}
            label="Provider and keys…"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
