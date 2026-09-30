import { Activity, FileText, FolderOpen, History, Pin, Variable } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { Kbd } from '@/components/ui/kbd'
import { cellTitle } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { Cell, PromptCell } from '@dalliance/shared/notebook'
import { type CellRun, type PaneKind, actions, useNotebook } from '@/store/notebook-store'

type Progress = 'running' | 'queued' | 'done' | 'error' | 'stale' | 'edited' | 'idle'

function progressOf(cell: PromptCell, status: CellRun['status'] | undefined): Progress {
  if (status) return status
  return cell.state === 'done' ? 'done' : cell.state
}

/** The outline's status dot: its colour, and the words that say the same thing without colour. */
function statusDot(cell: Cell, running: boolean): { className: string; text: string } | null {
  if (running) return { className: 'bg-go pulse', text: 'running' }
  if (cell.kind !== 'prompt') return null
  if (cell.state === 'error') return { className: 'bg-destructive', text: 'failed' }
  if (cell.state === 'stale') return { className: 'bg-warn', text: 'out of date' }
  if (cell.state === 'edited') return { className: 'bg-muted-foreground', text: 'edited' }
  return null
}

const PROGRESS_TEXT: Record<Progress, string> = {
  running: 'running',
  queued: 'queued',
  done: 'up to date',
  error: 'failed',
  stale: 'out of date',
  edited: 'edited, not run',
  idle: 'not run yet',
}

/**
 * Each cell's run status, as one object that only changes when a status does. A status tick or streamed
 * output from the running cell leaves it equal, so the overview doesn't redraw for them.
 */
function useRunStatuses(): Record<string, CellRun['status']> {
  return useNotebook(useShallow((s) => Object.fromEntries(Object.entries(s.runs).map(([id, r]) => [id, r.status]))))
}

/** The overview: where the notebook stands, what happened, its cells, and the side panes. */
export function Sidebar() {
  return (
    <SidebarRoot collapsible="none" role="complementary" aria-label="Overview" className="h-full w-full overflow-hidden rounded-xl border shadow-pane">
      <SidebarHeader className="gap-3 px-4 pt-4 pb-3">
        <NotebookStatus />
      </SidebarHeader>
      <SidebarSeparator className="mx-0" />
      <SidebarContent className="scrollbar-thin gap-0">
        <Outline />
      </SidebarContent>
      <SidebarSeparator className="mx-0" />
      <SidebarFooter className="p-2">
        <PaneMenu />
      </SidebarFooter>
    </SidebarRoot>
  )
}

function NotebookStatus() {
  const path = useNotebook((s) => s.path)
  const kernel = useNotebook((s) => s.kernel)
  const name = path ? (path.split(/[\\/]/).pop() ?? path).replace(/\.ipynb$/, '') : 'Untitled'
  const folderPath = path ? path.split(/[\\/]/).slice(0, -1).join('/') : kernel.cwd
  const folder = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return (
    <>
      <div className="min-w-0">
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
    </>
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
  const statuses = useRunStatuses()
  const prompts = cells.filter((c): c is PromptCell => c.kind === 'prompt')
  if (!prompts.length) return null
  return (
    // Each segment names its cell and status in words, for the tooltip and for screen readers
    <div className="flex h-3.5 overflow-hidden rounded-[3px] border border-ink/70" role="group" aria-label="Cells by status">
      {prompts.map((c, i) => {
        const progress = progressOf(c, statuses[c.id])
        const label = `Cell ${i + 1}, ${cellTitle(c, 60)}: ${PROGRESS_TEXT[progress]}`
        return (
          <button
            key={c.id}
            type="button"
            tabIndex={-1}
            title={label}
            aria-label={label}
            onClick={() => actions.select(c.id)}
            className={cn('h-full min-w-1 flex-1', SEGMENT[progress], i > 0 && 'border-l border-background/60')}
          />
        )
      })}
    </div>
  )
}

function summaryText(prompts: PromptCell[], statuses: Record<string, CellRun['status']>, runningText: string | null): string {
  const total = prompts.length
  const count = (p: Progress) => prompts.filter((c) => progressOf(c, statuses[c.id]) === p).length
  const runningIndex = prompts.findIndex((c) => statuses[c.id] === 'running')
  const queued = count('queued')
  if (runningIndex >= 0) {
    const text = runningText ?? 'Running'
    const more = queued ? ` ${queued} more queued.` : ''
    return `Cell ${runningIndex + 1} of ${total}: ${text.charAt(0).toLowerCase()}${text.slice(1)}.${more}`
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

/**
 * Where the notebook stands, in a sentence. It follows every status on screen, but screen readers hear only
 * the end of a run, not each step on the way.
 */
function Summary() {
  const cells = useNotebook((s) => s.notebook.cells)
  const statuses = useRunStatuses()
  const runningText = useNotebook((s) => Object.values(s.runs).find((r) => r.status === 'running')?.statusText ?? null)
  const prompts = cells.filter((c): c is PromptCell => c.kind === 'prompt')
  const text = prompts.length ? summaryText(prompts, statuses, runningText) : 'Add a prompt cell to get started.'
  const busy = Object.keys(statuses).length > 0
  const wasBusy = useRef(busy)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    if (wasBusy.current && !busy) setAnnouncement(`Finished running. ${text}`)
    wasBusy.current = busy
  }, [busy, text])
  return (
    <>
      <p className="text-[13.5px] leading-[1.55] text-muted-foreground">{text}</p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}

function Outline() {
  const cells = useNotebook((s) => s.notebook.cells)
  const selectedId = useNotebook((s) => s.selectedId)
  const runningId = useNotebook((s) => Object.keys(s.runs).find((id) => s.runs[id].status === 'running') ?? null)
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="eyebrow h-6">Cells</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {cells.map((cell) => {
            const dot = statusDot(cell, cell.id === runningId)
            return (
              <SidebarMenuItem key={cell.id}>
                <SidebarMenuButton
                  isActive={cell.id === selectedId}
                  onClick={() => actions.select(cell.id)}
                  className={cn('pr-6 text-[13px] text-muted-foreground data-active:font-normal data-active:text-foreground', cell.kind === 'note' && 'font-medium')}
                >
                  <span className="truncate">{cellTitle(cell)}</span>
                  {dot && <span className="sr-only">, {dot.text}</span>}
                </SidebarMenuButton>
                {dot && (
                  <span
                    aria-hidden="true"
                    className={cn('pointer-events-none absolute top-1/2 right-2.5 size-1.5 -translate-y-1/2 rounded-full', dot.className)}
                  />
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

const PANES: { kind: PaneKind; label: string; icon: ReactNode; key: string }[] = [
  { kind: 'brief', label: 'Brief', icon: <FileText />, key: '1' },
  { kind: 'variables', label: 'Variables', icon: <Variable />, key: '2' },
  { kind: 'history', label: 'History', icon: <History />, key: '3' },
  { kind: 'files', label: 'Files', icon: <FolderOpen />, key: '4' },
  { kind: 'pinned', label: 'Pinned', icon: <Pin />, key: '5' },
  { kind: 'activity', label: 'Activity', icon: <Activity />, key: '6' },
]

/** The side panes, opened beside the overview. Cmd+1 to Cmd+6 toggle them too. */
function PaneMenu() {
  const pane = useNotebook((s) => s.pane)
  const brief = useNotebook((s) => s.brief)
  const variables = useNotebook((s) => s.variables.length)
  const pins = useNotebook((s) => s.pinnedIds.length)
  const failures = useNotebook((s) => s.log.filter((e) => e.kind === 'failed').length)
  const events = useNotebook((s) => s.log.length)
  const versions = useNotebook((s) => {
    const cell = s.notebook.cells.find((c) => c.id === s.selectedId)
    return cell?.kind === 'prompt' ? cell.history.length : 0
  })
  const badge: Record<PaneKind, string> = {
    brief: brief?.text?.trim() ? '' : 'empty',
    variables: variables ? String(variables) : '',
    history: versions ? String(versions) : '',
    files: '',
    pinned: pins ? String(pins) : '',
    activity: failures ? `${failures} failed` : events ? String(events) : '',
  }
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
  return (
    <SidebarMenu aria-label="Panes">
      {PANES.map((p) => (
        <SidebarMenuItem key={p.kind}>
          <SidebarMenuButton
            isActive={pane === p.kind}
            aria-pressed={pane === p.kind}
            onClick={() => actions.togglePane(p.kind)}
            // The sidebar only shows its tooltips when collapsed; this one carries the shortcut, so it always shows
            tooltip={{
              side: 'right',
              hidden: false,
              children: (
                <>
                  {p.label}
                  <Kbd className="ml-1.5">
                    {mod}
                    {p.key}
                  </Kbd>
                </>
              ),
            }}
            className="text-[13px] [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          >
            {p.icon}
            <span>{p.label}</span>
          </SidebarMenuButton>
          {badge[p.kind] && (
            <SidebarMenuBadge className={cn('font-normal text-faint', p.kind === 'activity' && failures > 0 && 'text-destructive')}>{badge[p.kind]}</SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}
