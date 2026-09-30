import { NotebookText, Play, Plus, RotateCw, ShieldCheck, Square } from 'lucide-react'
import { Fragment, memo, useEffect, useRef } from 'react'
import { ErrorBoundary } from '@/components/app/ErrorBoundary'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { actions, useNotebook } from '@/store/notebook-store'
import { CellView } from './CellView'
import { VerifyConfirm, VerifyReportView } from './VerifyReport'

/**
 * The notebook column. Cells are memoized: typing in one cell, or a run event for one cell, redraws that cell
 * and leaves the others alone. Keep the props passed to CellView stable for that to hold.
 */
export function NotebookView() {
  const cells = useNotebook((s) => s.notebook.cells)
  const selectedId = useNotebook((s) => s.selectedId)
  const busy = useNotebook((s) => Object.keys(s.runs).length > 0)
  const report = useNotebook((s) => s.verify)
  const verifying = report?.phase === 'restarting' || report?.phase === 'running' || report?.phase === 'stopping'
  const scroller = useRef<HTMLDivElement>(null)
  const prompts = cells.filter((c) => c.kind === 'prompt').length

  // Keep the selected cell in view when it changes from the keyboard or the outline
  useEffect(() => {
    if (!selectedId) return
    const el = scroller.current?.querySelector(`[data-cell-id="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // Prompt cells are numbered as the overview's summary counts them: "Cell 2 of 5"
  let number = 0
  return (
    // Command mode listens while focus is in here, see useCommandMode() in App.tsx
    <main data-command-scope className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-pane">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-[13px]">
        <NotebookText className="size-3.5 text-muted-foreground" />
        <h2 className="font-medium">Notebook</h2>
        <span className="text-faint tabular-nums">
          {prompts} {prompts === 1 ? 'prompt' : 'prompts'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {busy && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void actions.interrupt()}>
              <Square className="size-3 fill-current" />
              Stop
            </Button>
          )}
          <IconButton label="Restart kernel" size="icon-xs" onClick={() => void actions.restart()}>
            <RotateCw />
          </IconButton>
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={verifying} onClick={() => actions.askVerify()}>
            <ShieldCheck />
            Verify
          </Button>
          <Button variant="outline" size="sm" onClick={() => actions.runAll()}>
            <Play className="fill-ink text-ink" />
            Run all
          </Button>
        </div>
      </header>
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-4 pt-7 pb-40 sm:px-6">
          {report && (
            <ErrorBoundary what="The Verify report" className="mb-6 ml-11">
              <VerifyReportView report={report} />
            </ErrorBoundary>
          )}
          {cells.length === 0 && <p className="ml-11 py-3 text-sm text-faint">This notebook is empty.</p>}
          {cells.map((cell, i) => (
            <Fragment key={cell.id}>
              <ErrorBoundary what="This cell" className="my-3 ml-11">
                <CellView cell={cell} number={cell.kind === 'prompt' ? ++number : 0} selected={cell.id === selectedId} />
              </ErrorBoundary>
              <CellInserter index={i + 1} divider={i < cells.length - 1} />
            </Fragment>
          ))}
          <button
            type="button"
            onClick={() => actions.insertCell(useNotebook.getState().notebook.cells.length, 'prompt')}
            className="mt-2 ml-11 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-faint hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-3" />
            Add cell
          </button>
        </div>
      </div>
      <VerifyConfirm />
    </main>
  )
}

/**
 * A thin line between two cells, so it is clear where one ends. Hover it to add a cell there. The line is one
 * piece, a little narrower than the cells, and the buttons sit over its middle. Both live in the cells' column,
 * ml-11 like the cells, so the line and the buttons share one centre.
 */
const CellInserter = memo(function CellInserter({ index, divider }: { index: number; divider: boolean }) {
  const button = 'flex items-center gap-1 rounded px-1.5 py-0.5 text-faint hover:bg-hover hover:text-foreground'
  return (
    <div className="group/add relative ml-11 flex h-5 items-center justify-center">
      {divider && <div aria-hidden data-slot="cell-divider" className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-foreground/10 transition-colors group-hover/add:bg-foreground/20" />}
      <div className="relative flex gap-1 rounded bg-background px-1 text-[11.5px] opacity-0 transition-opacity group-focus-within/add:opacity-100 group-hover/add:opacity-100">
        <button type="button" className={button} onClick={() => actions.insertCell(index, 'prompt')}>
          <Plus className="size-3" />
          Prompt
        </button>
        <button type="button" className={button} onClick={() => actions.insertCell(index, 'note')}>
          <Plus className="size-3" />
          Note
        </button>
      </div>
    </div>
  )
})
