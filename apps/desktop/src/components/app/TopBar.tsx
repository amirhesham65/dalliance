import { ChevronDown, FilePlus, FolderOpen, PanelLeft, Settings } from 'lucide-react'
import { useState } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSidebar } from '@/components/ui/sidebar'
import { PROVIDERS } from '@/lib/keys'
import { makerOfModel } from '@/lib/makers'
import { ago, modelLabel } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import { type Effort, type RecentNotebook, isOllama } from '@dalliance/shared/ipc'
import { actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'
import { IconButton } from './IconButton'
import { MakerLogo } from './MakerLogo'
import { ProfileMenu } from './ProfileMenu'

/** `minimal` is for the start page and the first-run setup: nothing but Settings, over a draggable bar. The full bar adds the account. */
export function TopBar({ minimal }: { minimal?: boolean }) {
  const platform = getApi()?.platform
  const { open, toggleSidebar } = useSidebar()
  const settingsOpen = useNotebook((s) => s.settingsPage != null)
  const mod = platform === 'darwin' || navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
  return (
    <header
      className={cn(
        'app-drag flex h-12 shrink-0 items-center gap-2 px-3 text-[13px]',
        // Leave room for the native window controls drawn over the bar
        platform === 'darwin' && 'pl-[84px]',
        platform && platform !== 'darwin' && 'pr-[150px]',
      )}
    >
      {!minimal && (
        <>
          <IconButton label={`${open ? 'Hide' : 'Show'} overview`} shortcut={`${mod}B`} aria-expanded={open} onClick={toggleSidebar} className="app-no-drag">
            <PanelLeft />
          </IconButton>
          <NotebookTab />
        </>
      )}
      <div className="app-no-drag ml-auto flex items-center gap-1">
        {!minimal && <ModelChip />}
        <IconButton label="Settings" shortcut={`${mod},`} aria-pressed={settingsOpen} onClick={() => (settingsOpen ? actions.closeSettings() : actions.openSettings())}>
          <Settings />
        </IconButton>
        {!minimal && <ProfileMenu mod={mod} />}
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

  const load = async (fn: () => Promise<{ notebook: import('@dalliance/shared/notebook').Notebook; path: string | null } | null>) => {
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

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
]

/** Which model writes the cells, and how hard it thinks. Searches every model the provider offers. */
function ModelChip() {
  const settings = useNotebook((s) => s.settings)
  const list = useNotebook((s) => s.models)
  const probing = useNotebook((s) => s.probingModels)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const api = getApi()
  if (!settings || !api) return null
  const update = async (u: Parameters<typeof api.updateSettings>[0]) => {
    useNotebook.setState({ settings: await api.updateSettings(u) })
  }
  const choose = (id: string) => {
    void update({ model: id })
    setOpen(false)
    setQuery('')
  }
  // A model the key's plan doesn't run has no place in the picker
  const models = (list?.provider === settings.provider ? list.models : []).filter((m) => !m.locked)
  const current = models.find((m) => m.id === settings.model)
  // Anthropic first, then the other makers alphabetically
  const makers = [...new Set(models.map((m) => m.maker))].sort((a, b) => (a === 'Anthropic' ? -1 : b === 'Anthropic' ? 1 : a.localeCompare(b)))
  const effortApplies = settings.provider === 'anthropic' || /^(anthropic|openai)\//.test(settings.model)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void actions.loadModels()
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-muted-foreground hover:bg-background hover:text-foreground aria-expanded:bg-background">
          <MakerLogo maker={current?.maker ?? makerOfModel(settings.provider, settings.model)} />
          <span className="max-w-[180px] truncate">{current?.name.replace(/^Claude /, '') ?? modelLabel(settings.model)}</span>
          {effortApplies && <span className="text-faint">· {EFFORTS.find((e) => e.value === settings.effort)?.label.toLowerCase()}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <Command loop>
          <CommandInput placeholder="Search models" value={query} onValueChange={setQuery} />
          <CommandList className="scrollbar-thin max-h-[340px]">
            {!list && <p className="px-3 py-6 text-center text-[13px] text-faint">Loading models…</p>}
            {list?.error && <p className="px-3 py-3 text-[13px] text-destructive">{list.error}</p>}
            {probing && <p className="px-3 py-2 text-[12px] text-faint">Checking which models your plan includes…</p>}
            <CommandEmpty>
              {query.trim() ? (
                <button type="button" className="text-[13px] hover:underline" onClick={() => choose(query.trim())}>
                  Use <span className="font-mono text-xs">{query.trim()}</span> as the model id
                </button>
              ) : (
                'No models.'
              )}
            </CommandEmpty>
            {makers.map((maker) => (
              <CommandGroup
                key={maker}
                heading={
                  <span className="flex items-center gap-1.5">
                    <MakerLogo maker={maker} className="size-3" />
                    {maker}
                  </span>
                }
              >
                {models
                  .filter((m) => m.maker === maker)
                  .map((m) => (
                    <CommandItem
                      key={m.id}
                      value={`${m.name} ${m.id}`}
                      data-checked={m.id === settings.model}
                      onSelect={() => choose(m.id)}
                      title={m.id}
                      className="gap-2 text-[13px] [&>svg:last-child]:ml-0 [&>svg:last-child]:size-3.5 [&>svg:last-child]:text-ink"
                    >
                      <span className="truncate">{m.name}</span>
                      {m.price && <span className="ml-auto shrink-0 text-[11.5px] text-faint tabular-nums">{m.price}</span>}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="border-t p-1.5">
          <p className="eyebrow px-2 pt-1 pb-1.5">Effort</p>
          <div className={cn('mx-2 flex rounded-lg bg-hover p-0.5', !effortApplies && 'opacity-50')} role="group" aria-label="Effort">
            {EFFORTS.map((e) => (
              <button
                key={e.value}
                type="button"
                disabled={!effortApplies}
                aria-pressed={settings.effort === e.value}
                onClick={() => void update({ effort: e.value })}
                className={cn(
                  'flex-1 rounded-md py-1 text-xs',
                  settings.effort === e.value ? 'bg-background text-foreground shadow-pane' : 'text-muted-foreground enabled:hover:text-foreground',
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="px-2 pt-1.5 text-[11.5px] text-faint">
            {effortApplies
              ? 'Prices are per million input / output tokens.'
              : isOllama(settings.provider)
                ? 'Ollama models use their own thinking settings.'
                : 'Effort applies to Anthropic and OpenAI models. This one uses its default.'}
          </p>
          <div className="mt-1 border-t pt-1">
            <MenuButton
              icon={<Settings />}
              label={`Provider: ${PROVIDERS[settings.provider].label}…`}
              onClick={() => {
                setOpen(false)
                actions.openSettings('models')
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
