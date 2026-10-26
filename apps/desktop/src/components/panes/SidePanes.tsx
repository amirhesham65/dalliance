import { Activity, CircleAlert, ExternalLink, FolderOpen, History, LocateFixed, Pin, PinOff, Play, RefreshCw, RotateCw, ShieldCheck, Sparkles, Square, Variable } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ErrorBoundary } from '@/components/app/ErrorBoundary'
import { IconButton } from '@/components/app/IconButton'
import { RevisionEntry } from '@/components/notebook/CellHistory'
import { FileTree } from './FileTree'
import { InlineText } from '@/components/notebook/InlineText'
import { OutputList } from '@/components/notebook/outputs/OutputView'
import { RefText } from '@/components/notebook/RefText'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { costText, spendText } from '@/lib/cost'
import { ago, cellTitle } from '@/lib/notebook/text'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import type { EnvironmentView as EnvironmentInfo, FileEntry } from '@dalliance/shared/ipc'
import type { PromptCell } from '@dalliance/shared/notebook'
import { type LogEntry, type VariablesView, actions, getApi, useNotebook } from '@/store/notebook-store'
import { BriefPane } from './BriefPane'
import { Pane } from './Pane'

/** The one side pane that is open, if any. */
export function SidePane() {
  const pane = useNotebook((s) => s.pane)
  if (!pane) return null
  return (
    <div className="flex min-w-0 flex-1 flex-col [&>section]:flex-1">
      {/* Keyed by pane, so opening another pane starts it fresh */}
      <ErrorBoundary key={pane} what="This pane" className="m-2 bg-background">
        {pane === 'brief' && <BriefPane />}
        {pane === 'variables' && <VariablesPane />}
        {pane === 'history' && <HistoryPane />}
        {pane === 'files' && <FilesPane />}
        {pane === 'pinned' && <PinnedPane />}
        {pane === 'activity' && <ActivityPane />}
      </ErrorBoundary>
    </div>
  )
}

const close = () => actions.openPane(null)

function Empty({ children }: { children: string }) {
  return <p className="px-4 py-2 text-[13px] leading-[1.6] text-faint">{children}</p>
}

/** What is in memory, and what the Python has installed. One pane, two views. */
function VariablesPane() {
  const variables = useNotebook((s) => s.variables)
  const environment = useNotebook((s) => s.environment)
  const loading = useNotebook((s) => s.environmentLoading)
  const stale = useNotebook((s) => s.environmentStale)
  const view = useNotebook((s) => s.variablesView)
  // Read the libraries when the view is first shown, and again when a run or a restart may have changed them
  useEffect(() => {
    if (view === 'environment' && (!useNotebook.getState().environment || stale)) void actions.loadEnvironment()
  }, [view, stale])
  return (
    <Pane
      title="Variables & Environment"
      icon={<Variable />}
      onClose={close}
      actions={
        <IconButton
          label="Refresh"
          size="icon-xs"
          onClick={() =>
            void (view === 'variables'
              ? actions.refreshVariables().catch((err: unknown) => actions.notifyFailure("Couldn't list the variables", err))
              : actions.loadEnvironment())
          }
        >
          <RefreshCw className={cn(view === 'environment' && loading && 'animate-spin')} />
        </IconButton>
      }
    >
      <Tabs value={view} onValueChange={(v) => actions.showVariablesView(v as VariablesView)} className="gap-0">
        <TabsList aria-label="View" className="mx-4 mb-2 flex h-8 w-auto bg-hover">
          <TabsTrigger value="variables" className="text-xs font-normal">
            Variables
          </TabsTrigger>
          <TabsTrigger value="environment" className="text-xs font-normal">
            Environment
          </TabsTrigger>
        </TabsList>
        <TabsContent value="variables">
          {variables.length ? (
            <ul className="flex flex-col px-2 pb-3">
              {variables.map((v) => (
                <li key={v.name} className="rounded-lg px-2 py-2 hover:bg-hover" title={v.detail || v.type}>
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[12.5px] text-ref">{v.name}</span>
                    <span className="text-xs text-faint">{v.type}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">{v.shape}</span>
                  </div>
                  {v.detail && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{v.detail}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing in memory yet. Variables appear here as cells run, and later cells can use them with @name.</Empty>
          )}
        </TabsContent>
        <TabsContent value="environment">
          <EnvironmentView environment={environment} loading={loading} />
        </TabsContent>
      </Tabs>
    </Pane>
  )
}

/** The Python in use and the libraries it has, with versions, searchable. */
function EnvironmentView({ environment, loading }: { environment: EnvironmentInfo | null; loading: boolean }) {
  const [query, setQuery] = useState('')
  if (!environment) return <Empty>{loading ? 'Reading the environment…' : 'Nothing to show yet.'}</Empty>
  if (environment.error) return <p className="px-4 py-2 text-[13px] leading-[1.6] text-destructive">{environment.error}</p>
  const q = query.trim().toLowerCase()
  const shown = q ? environment.packages.filter((p) => p.name.toLowerCase().includes(q)) : environment.packages
  return (
    <div className="flex flex-col pb-3">
      <p className="px-4 pb-2 text-[12.5px] text-muted-foreground" title={environment.python ?? undefined}>
        Python {environment.version ?? ''}
        <span className="text-faint"> · {environment.packages.length} libraries</span>
      </p>
      <input
        aria-label="Search libraries"
        placeholder="Search libraries"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mx-4 mb-1 h-8 rounded-lg border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-faint focus-visible:border-ring"
      />
      {shown.length ? (
        <ul aria-label="Libraries" className="flex flex-col px-2">
          {shown.map((p) => (
            <li key={p.name} className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
              <span className="truncate font-mono text-[12.5px] text-ref">{p.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">{p.version}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{q ? 'No library matches.' : 'This Python has no libraries yet.'}</Empty>
      )}
    </div>
  )
}

/** Working versions across the notebook, newest first. */
function HistoryPane() {
  const cells = useNotebook((s) => s.notebook.cells)
  let number = 0
  const revisions = cells.flatMap((cell) => {
    if (cell.kind !== 'prompt') return []
    const cellNumber = ++number
    return cell.history.map((rev) => ({ cell, rev, number: cellNumber }))
  }).sort((a, b) => b.rev.at - a.rev.at)
  return (
    <Pane title="History" icon={<History />} onClose={close}>
      {!revisions.length ? (
        <Empty>Working versions from every prompt cell appear here as the notebook runs.</Empty>
      ) : (
        <ol aria-label="Notebook history" className="flex flex-col gap-5 px-4 pb-5">
          {revisions.map(({ cell, rev, number }) => (
            <RevisionEntry key={`${cell.id}:${rev.at}`} cell={cell} rev={rev} heading={
              <button type="button" onClick={() => actions.select(cell.id)} className="mb-1.5 block w-full text-left" aria-label={`Go to cell ${number}`}>
                <span className="eyebrow text-faint">Cell {number}</span>
                <span className="block truncate font-serif text-[15px]"><RefText text={cellTitle(cell, 90)} /></span>
              </button>
            } />
          ))}
        </ol>
      )}
    </Pane>
  )
}

function FilesPane() {
  const path = useNotebook((s) => s.path)
  const kernelCwd = useNotebook((s) => s.kernel.cwd)
  const runs = useNotebook((s) => s.log[0]?.id)
  const added = useNotebook((s) => s.filesVersion)
  const [files, setFiles] = useState<FileEntry[] | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)

  // Cells can write files, so look again after each run
  useEffect(() => {
    let live = true
    void getApi()
      ?.listFiles()
      .then((f) => { if (live) { setFiles(f); setError(false) } })
      .catch(() => { if (live) { setFiles([]); setError(true) } })
    return () => {
      live = false
    }
  }, [path, kernelCwd, runs, added, tick])

  const load = (file: string) => {
    const id = actions.insertAfterSelected('prompt')
    actions.setPrompt(id, `Load ${file}`)
  }

  const reveal = async () => {
    try {
      await getApi()?.revealFolder()
    } catch (err) {
      actions.notifyFailure("Couldn't open the folder", err)
    }
  }

  return (
    <Pane
      title="Files"
      icon={<FolderOpen />}
      bodyClassName="overflow-hidden"
      onClose={close}
      actions={
        <>
          <IconButton label={revealLabel()} size="icon-xs" onClick={() => void reveal()}>
            <ExternalLink />
          </IconButton>
          <IconButton label="Refresh" size="icon-xs" onClick={() => setTick((t) => t + 1)}>
            <RefreshCw />
          </IconButton>
        </>
      }
    >
      {error ? (
        <p role="alert" className="px-4 py-2 text-[13px] text-destructive">Couldn't read this folder. Try Refresh.</p>
      ) : files == null ? <Empty>Reading files…</Empty> : files.length ? (
        <FileTree key={`${path}:${kernelCwd}`} files={files} onLoad={load} />
      ) : (
        <Empty>No files here yet. Save the notebook in the folder with your data, or drop data files next to it.</Empty>
      )}
    </Pane>
  )
}

/** What the platform calls showing a folder in its file manager. */
function revealLabel() {
  const platform = getApi()?.platform
  return platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in File Explorer' : 'Show in file manager'
}

/** Results kept in view while you work further down the notebook, one card per pinned cell. */
function PinnedPane() {
  const pinnedIds = useNotebook((s) => s.pinnedIds)
  const cells = useNotebook((s) => s.notebook.cells)
  const pinned = pinnedIds
    .map((id) => cells.find((c) => c.id === id))
    .filter((c): c is PromptCell => c?.kind === 'prompt')
  return (
    <Pane title="Pinned" icon={<Pin />} onClose={close}>
      {!pinned.length ? (
        <Empty>Pin a result with the pin icon next to its run time. Pinned results stay here while you work, and update when their cell reruns.</Empty>
      ) : (
        <ol className="flex flex-col gap-2 px-2 pb-3">
          {pinned.map((cell) => (
            <PinnedCard key={cell.id} cell={cell} />
          ))}
        </ol>
      )}
    </Pane>
  )
}

function PinnedCard({ cell }: { cell: PromptCell }) {
  const running = useNotebook((s) => s.runs[cell.id]?.status === 'running')
  const [open, setOpen] = useState(true)
  return (
    <li className="group/pin rounded-lg border bg-background">
      <div className="flex items-center gap-1 py-1 pr-1 pl-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 truncate py-1 text-left font-serif text-[15px]">
          <RefText text={cellTitle(cell, 80)} />
        </button>
        {running && <span className="text-xs text-faint">running</span>}
        {cell.state === 'stale' && !running && <span className="text-xs text-warn">out of date</span>}
        <IconButton label="Go to cell" size="icon-xs" onClick={() => actions.select(cell.id)}>
          <LocateFixed />
        </IconButton>
        <IconButton label="Unpin" size="icon-xs" onClick={() => actions.togglePin(cell.id)}>
          <PinOff />
        </IconButton>
      </div>
      {open && (
        <div className={cn('flex flex-col gap-3 px-3 pb-3', running && 'opacity-60')}>
          {cell.answer && (
            <p className="font-serif text-[14.5px] leading-[1.55]" data-selectable>
              <InlineText text={cell.answer} />
            </p>
          )}
          <OutputList outputs={cell.outputs} />
          {!cell.outputs.length && !cell.answer && <p className="text-[13px] text-faint">No result yet.</p>}
        </div>
      )}
    </li>
  )
}

const LOG_ICON: Record<LogEntry['kind'], ReactNode> = {
  wrote: <Sparkles className="text-ink" />,
  ran: <Play className="fill-current text-ink" />,
  failed: <CircleAlert className="text-destructive" />,
  stopped: <Square className="fill-current text-faint" />,
  restarted: <RotateCw className="text-faint" />,
  restored: <History className="text-faint" />,
  verified: <ShieldCheck className="text-ink" />,
}

/**
 * What happened in this session, newest first. Click an entry to jump to its cell. With Show token usage on, each run
 * shows its token usage, and the top shows the notebook total.
 */
function ActivityPane() {
  const log = useNotebook((s) => s.log)
  const cells = useNotebook((s) => s.notebook.cells)
  const showUsage = useNotebook((s) => s.settings?.showUsage === true)
  const total = useNotebook((s) => (showUsage ? spendText(s.spend) : null))
  const now = useNow()
  return (
    <Pane
      title="Activity"
      icon={<Activity />}
      onClose={close}
      actions={
        log.length > 0 && (
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => actions.clearLog()}>
            Clear
          </Button>
        )
      }
    >
      {total && (
        <p aria-label="This notebook's token usage" className="mx-4 mb-2 border-b pb-2 text-xs leading-[1.5] text-muted-foreground tabular-nums">
          This notebook: {total}
        </p>
      )}
      {!log.length ? (
        <Empty>Runs, failures, restarts and restores show up here as they happen.</Empty>
      ) : (
        <ol aria-label="Run log" className="flex flex-col px-2 pb-3">
          {log.map((e) => {
            const exists = e.cellId != null && cells.some((c) => c.id === e.cellId)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  disabled={!exists}
                  onClick={() => e.cellId && actions.select(e.cellId)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] leading-[1.45] enabled:hover:bg-hover"
                >
                  <span className="flex h-[1.45em] shrink-0 items-center [&_svg]:size-3.5">{LOG_ICON[e.kind]}</span>
                  <span className={cn('min-w-0 flex-1', e.kind === 'failed' ? 'text-foreground' : 'text-muted-foreground')}>
                    {e.text}
                    {showUsage && e.cost && <span className="block text-xs text-faint tabular-nums">{costText(e.cost)}</span>}
                  </span>
                  <span className="shrink-0 text-xs leading-[1.45rem] text-faint tabular-nums">{ago(e.at, now)}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Pane>
  )
}
