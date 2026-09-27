import { cellTitle } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { Cell } from '@/shared/notebook'
import { actions, useNotebook } from '@/store/notebook-store'

function statusDot(cell: Cell, running: boolean) {
  if (running) return 'bg-go'
  if (cell.kind !== 'prompt') return 'bg-transparent'
  if (cell.state === 'error') return 'bg-destructive'
  if (cell.state === 'stale') return 'bg-warn'
  if (cell.state === 'edited') return 'bg-muted-foreground'
  return 'bg-transparent'
}

export function Sidebar() {
  const cells = useNotebook((s) => s.notebook.cells)
  const selectedId = useNotebook((s) => s.selectedId)
  const runs = useNotebook((s) => s.runs)
  const variables = useNotebook((s) => s.variables)
  return (
    <aside aria-label="Outline" className="scrollbar-thin flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r px-3 py-4">
      <section>
        <h2 className="px-2 pb-1.5 text-xs text-faint">Cells</h2>
        <ol className="flex flex-col text-[13px]">
          {cells.map((cell) => (
            <li key={cell.id}>
              <button
                type="button"
                onClick={() => actions.select(cell.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
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

      <section>
        <h2 className="px-2 pb-1.5 text-xs text-faint">Variables</h2>
        {variables.length ? (
          <ul className="flex flex-col font-mono text-xs">
            {variables.map((v) => (
              <li key={v.name} className="flex items-baseline justify-between gap-2 px-2 py-1" title={v.detail || v.type}>
                <span className="truncate text-ref">{v.name}</span>
                <span className="shrink-0 text-faint tabular-nums">{v.shape || v.type}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-1 text-[12.5px] text-faint">None yet. Run a cell to create some.</p>
        )}
      </section>
    </aside>
  )
}
