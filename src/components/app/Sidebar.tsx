import { ChevronDown, CircleAlert, FileText, FolderOpen, History, Play, RotateCw, Sparkles, Square, Variable } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ago, cellTitle } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { Cell, PromptCell } from '@/shared/notebook'
import { type CellRun, type LogEntry, type PaneKind, actions, useNotebook } from '@/store/notebook-store'

type Progress = 'running' | 'queued' | 'done' | 'error' | 'stale' | 'edited' | 'idle'

function progressOf(cell: PromptCell, run: CellRun | undefined): Progress {
  if (run) return run.status
  return cell.state === 'done' ? 'done' : cell.state
}

function statusDot(cell: Cell, running: boolean) {
  if (running) return 'bg-go pulse'
  if (cell.kind !== 'prompt') return 'bg-transparent'
  if (cell.state === 'error') return 'bg-destructive'
  if (cell.state === 'stale') return 'bg-warn'
  if (cell.state === 'edited') return 'bg-muted-foreground'
  return 'bg-transparent'
}

/** Re-render every half minute so "2m ago" style times stay true. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function Sidebar() {
  return (
    <aside aria-label="Overview" className="flex w-[272px] shrink-0 flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-pane">
        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          <NotebookStatus />
          <Outline />
        </div>
      </div>
      <PaneTiles />
    </aside>
  )
}

function NotebookStatus() {
  const path = useNotebook((s) => s.path)
  const kernel = useNotebook((s) => s.kernel)
  const name = path ? (path.split(/[\\/]/).pop() ?? path).replace(/\.ipynb$/, '') : 'Untitled'
  const folderPath = path ? path.split(/[\\/]/).slice(0, -1).join('/') : kernel.cwd
  const folder = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return (
    <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
      <div>
        <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]" title={path ?? undefined}>
          {name}
        </h1>
        <p className="mt-0.5 flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
          <span className="truncate" title={folderPath}>
            {folder || 'No folder'}
          </span>
          <KernelBadge />
        </p>
      </div>
      <ProgressBar />
      <Summary />
      <RunLog />
    </div>
  )
}

const KERNEL_LABEL = { starting: 'starting', idle: 'idle', busy: 'running', dead: 'off' } as const

function KernelBadge() {
  const kernel = useNotebook((s) => s.kernel)
  return (
    <span className="flex shrink-0 items-center gap-1.5 tabular-nums" title={kernel.error ?? kernel.cwd}>
      <span
        className={cn(
          'size-1.5 rounded-full',
          kernel.status === 'idle' && 'bg-go',
          (kernel.status === 'busy' || kernel.status === 'starting') && 'bg-warn pulse',
          kernel.status === 'dead' && (kernel.error ? 'bg-destructive' : 'bg-faint'),
        )}
      />
      {kernel.python ? `Python ${kernel.python.split('.').slice(0, 2).join('.')}` : 'Python'} · {KERNEL_LABEL[kernel.status]}
    </span>
  )
}

const SEGMENT: Record<Progress, string> = {
  done: 'bg-ink',
  running: 'bg-ink pulse',
  error: 'bg-destructive',
  queued: 'hatch bg-hover',
  stale: 'hatch',
  edited: 'hatch',
  idle: 'hatch',
}

/** One segment per prompt cell: solid when its result is current, hatched when it still needs a run. */
function ProgressBar() {
  const cells = useNotebook((s) => s.notebook.cells)
  const runs = useNotebook((s) => s.runs)
  const prompts = cells.filter((c): c is PromptCell => c.kind === 'prompt')
  if (!prompts.length) return null
  return (
    <div className="flex h-3.5 overflow-hidden rounded-[3px] border border-ink/70" role="img" aria-label={summaryText(prompts, runs)}>
      {prompts.map((c, i) => (
        <button
          key={c.id}
          type="button"
          tabIndex={-1}
          title={`${cellTitle(c, 60)} · ${progressOf(c, runs[c.id])}`}
          onClick={() => actions.select(c.id)}
          className={cn('h-full min-w-1 flex-1', SEGMENT[progressOf(c, runs[c.id])], i > 0 && 'border-l border-background/60')}
        />
      ))}
    </div>
  )
}

function summaryText(prompts: PromptCell[], runs: Record<string, CellRun>): string {
  const total = prompts.length
  const count = (p: Progress) => prompts.filter((c) => progressOf(c, runs[c.id]) === p).length
  const runningIndex = prompts.findIndex((c) => runs[c.id]?.status === 'running')
  const queued = count('queued')
  if (runningIndex >= 0) {
    const run = runs[prompts[runningIndex].id]
    const more = queued ? ` ${queued} more queued.` : ''
    return `Cell ${runningIndex + 1} of ${total}: ${run.statusText.charAt(0).toLowerCase()}${run.statusText.slice(1)}.${more}`
  }
  const done = count('done')
  const failed = count('error')
  const outdated = count('stale') + count('edited')
  const never = count('idle')
  if (done === total) return total === 1 ? 'The cell is up to date.' : `All ${total} cells are up to date.`
  if (!done && !failed && !outdated) return 'Nothing has run yet. Press Run all, or Shift+Enter in a cell.'
  const parts = [`${done} of ${total} cells up to date`]
  if (failed) parts.push(`${failed} failed`)
  if (outdated) parts.push(`${outdated} out of date`)
  if (never) parts.push(`${never} not run yet`)
  return `${parts.join(', ')}.`
}

function Summary() {
  const cells = useNotebook((s) => s.notebook.cells)
  const runs = useNotebook((s) => s.runs)
  const prompts = cells.filter((c): c is PromptCell => c.kind === 'prompt')
  if (!prompts.length) return <p className="text-[13.5px] leading-[1.55] text-muted-foreground">Add a prompt cell to get started.</p>
  return (
    <p className="text-[13.5px] leading-[1.55] text-muted-foreground" aria-live="polite">
      {summaryText(prompts, runs)}
    </p>
  )
}

const LOG_ICON: Record<LogEntry['kind'], ReactNode> = {
  wrote: <Sparkles className="size-3.5 text-ink" />,
  ran: <Play className="size-3 fill-current text-ink" />,
  failed: <CircleAlert className="size-3.5 text-destructive" />,
  stopped: <Square className="size-3 fill-current text-faint" />,
  restarted: <RotateCw className="size-3.5 text-faint" />,
  restored: <History className="size-3.5 text-faint" />,
}

function RunLog() {
  const log = useNotebook((s) => s.log)
  const [expanded, setExpanded] = useState(false)
  const now = useNow()
  if (!log.length) return null
  const shown = expanded ? log : log.slice(0, 4)
  return (
    <div className="flex flex-col">
      <ol className="flex flex-col text-[13px]" aria-label="Run log">
        {shown.map((e, i) => (
          <li key={e.id}>
            <button
              type="button"
              disabled={!e.cellId}
              onClick={() => e.cellId && actions.select(e.cellId)}
              title={e.text}
              className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted-foreground enabled:hover:bg-hover enabled:hover:text-foreground"
            >
              <span className="flex w-3.5 shrink-0 justify-center">{LOG_ICON[e.kind]}</span>
              <span className="truncate">{e.text}</span>
              {i === 0 && <span className="ml-auto shrink-0 pl-2 text-xs text-faint tabular-nums">{ago(e.at, now)}</span>}
            </button>
          </li>
        ))}
      </ol>
      {log.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-0.5 flex w-fit items-center gap-1.5 py-0.5 text-[12.5px] text-faint hover:text-muted-foreground"
          aria-expanded={expanded}
        >
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : `Show ${log.length - 4} more`}
        </button>
      )}
    </div>
  )
}

function Outline() {
  const cells = useNotebook((s) => s.notebook.cells)
  const selectedId = useNotebook((s) => s.selectedId)
  const runs = useNotebook((s) => s.runs)
  return (
    <section className="border-t px-2.5 pt-3 pb-3">
      <h2 className="eyebrow px-1.5 pb-1.5">Cells</h2>
      <ol className="flex flex-col text-[13px]">
        {cells.map((cell) => (
          <li key={cell.id}>
            <button
              type="button"
              onClick={() => actions.select(cell.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left',
                cell.id === selectedId ? 'bg-hover text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('truncate', cell.kind === 'note' && 'font-medium')}>{cellTitle(cell)}</span>
              <span className={cn('ml-auto size-1.5 shrink-0 rounded-full', statusDot(cell, runs[cell.id]?.status === 'running'))} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Launchers for the side panes, as small cards under the overview. */
function PaneTiles() {
  const pane = useNotebook((s) => s.pane)
  const brief = useNotebook((s) => s.brief)
  const variables = useNotebook((s) => s.variables)
  const versions = useNotebook((s) => {
    const cell = s.notebook.cells.find((c) => c.id === s.selectedId)
    return cell?.kind === 'prompt' ? cell.history.length : 0
  })
  const briefTitle = brief?.text?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
  const tiles: { kind: PaneKind; label: string; icon: ReactNode; meta: string; preview?: string }[] = [
    { kind: 'brief', label: 'Brief', icon: <FileText />, meta: brief?.text ? '' : 'Empty', preview: briefTitle },
    { kind: 'variables', label: 'Variables', icon: <Variable />, meta: variables.length ? String(variables.length) : 'None' },
    { kind: 'history', label: 'History', icon: <History />, meta: versions ? String(versions) : '' },
    { kind: 'files', label: 'Files', icon: <FolderOpen />, meta: '' },
  ]
  return (
    <nav aria-label="Panes" className="grid shrink-0 grid-cols-2 gap-2">
      {tiles.map((t) => (
        <button
          key={t.kind}
          type="button"
          aria-pressed={pane === t.kind}
          onClick={() => actions.togglePane(t.kind)}
          className={cn(
            'flex h-[68px] flex-col justify-between rounded-xl border bg-background p-3 text-left shadow-pane transition-colors hover:border-ring/70',
            pane === t.kind && 'border-ink/60 ring-1 ring-ink/20',
          )}
        >
          <span className="flex items-center gap-2 text-faint [&_svg]:size-3.5">
            {t.icon}
            {t.preview && <span className="truncate font-serif text-[12px] text-muted-foreground">{t.preview}</span>}
          </span>
          <span className="flex items-baseline justify-between gap-2 text-[13px]">
            <span>{t.label}</span>
            <span className="truncate text-[11.5px] text-faint tabular-nums">{t.meta}</span>
          </span>
        </button>
      ))}
    </nav>
  )
}
