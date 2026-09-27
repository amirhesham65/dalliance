import { NotebookText, Play, Plus, RotateCw, Square } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { actions, useNotebook } from '@/store/notebook-store'
import { CellView } from './CellView'

export function NotebookView({ onDelete }: { onDelete: (id: string) => void }) {
  const cells = useNotebook((s) => s.notebook.cells)
  const selectedId = useNotebook((s) => s.selectedId)
  const busy = useNotebook((s) => Object.keys(s.runs).length > 0)
  const scroller = useRef<HTMLDivElement>(null)
  const prompts = cells.filter((c) => c.kind === 'prompt').length

  // Keep the selected cell in view when it changes from the keyboard or the outline
  useEffect(() => {
    if (!selectedId) return
    const el = scroller.current?.querySelector(`[data-cell-id="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <main className="flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-pane">
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
          <Button variant="outline" size="sm" onClick={() => actions.runAll()}>
            <Play className="fill-ink text-ink" />
            Run all
          </Button>
        </div>
      </header>
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-4 pt-7 pb-40 sm:px-6">
          {cells.length === 0 && <p className="ml-11 py-3 text-sm text-faint">This notebook is empty.</p>}
          {cells.map((cell, i) => (
            <Fragment key={cell.id}>
              <CellView cell={cell} selected={cell.id === selectedId} onDelete={onDelete} />
              <CellInserter index={i + 1} />
            </Fragment>
          ))}
          <button
            type="button"
            onClick={() => actions.insertCell(cells.length, 'prompt')}
            className="mt-2 ml-11 flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-faint hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-3" />
            Add cell
          </button>
        </div>
      </div>
    </main>
  )
}

/** Hover between two cells to add one there. */
function CellInserter({ index }: { index: number }) {
  const button = 'flex items-center gap-1 rounded px-1.5 py-0.5 text-faint hover:bg-hover hover:text-foreground'
  return (
    <div className="group/add flex h-5 items-center gap-2 pl-11">
      <div className="h-px flex-1 group-hover/add:bg-border" />
      <div className="flex gap-1 text-[11.5px] opacity-0 transition-opacity group-focus-within/add:opacity-100 group-hover/add:opacity-100">
        <button type="button" className={button} onClick={() => actions.insertCell(index, 'prompt')}>
          <Plus className="size-3" />
          Prompt
        </button>
        <button type="button" className={button} onClick={() => actions.insertCell(index, 'note')}>
          <Plus className="size-3" />
          Note
        </button>
      </div>
      <div className="h-px flex-1 group-hover/add:bg-border" />
    </div>
  )
}
