import { memo, useMemo, useState } from 'react'
import { stripAnsi } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { ColumnProfile, Output } from '@dalliance/shared/notebook'

type Stream = Extract<Output, { type: 'stream' }>
type Table = Extract<Output, { type: 'table' }>

/** Adjacent print() calls arrive as separate chunks; show them as one block without trailing blank lines. */
function mergeStreams(outputs: Output[]): Output[] {
  const merged: Output[] = []
  for (const o of outputs) {
    const prev = merged[merged.length - 1]
    if (o.type === 'stream' && prev?.type === 'stream' && prev.name === o.name) merged[merged.length - 1] = { ...prev, text: prev.text + o.text }
    else merged.push(o)
  }
  return merged
    .map((o) => (o.type === 'stream' ? { ...o, text: o.text.replace(/\n{3,}/g, '\n\n').trimEnd() } : o))
    .filter((o) => o.type !== 'stream' || o.text.length > 0)
}

interface OutputListProps {
  outputs: Output[]
  tablesOpen?: boolean
  onTables?: (open: boolean) => void
  /** The variable a table came from, when the cell assigned one of the same size. */
  tableName?: (rows: number, columns: number) => string | null
}

/**
 * A cell's outputs. Memoized, and the merged list is kept while `outputs` is the same array, so a cell's
 * tables don't redraw while its prompt is typed. Pass stable callbacks for that to hold.
 */
export const OutputList = memo(function OutputList({ outputs, tablesOpen = true, onTables, tableName }: OutputListProps) {
  const [openView, setOpenView] = useState<TableViewMode | null>(null)
  const { merged, hasResult, streams, rest } = useMemo(() => {
    const merged = mergeStreams(outputs)
    // When the cell produced a real result, printed text is secondary: fold it away
    const hasResult = merged.some((o) => o.type === 'table' || o.type === 'image' || o.type === 'text')
    const streams = merged.filter((o): o is Stream => o.type === 'stream')
    const rest = hasResult ? merged.filter((o) => o.type !== 'stream') : merged
    return { merged, hasResult, streams, rest }
  }, [outputs])
  if (!merged.length) return null
  return (
    <div className="flex flex-col gap-3" data-selectable>
      {rest.map((o, i) =>
        o.type !== 'table' ? (
          <OutputView key={i} output={o} />
        ) : tablesOpen ? (
          <TableView key={i} output={o} initialView={openView} name={tableName?.(o.totalRows, o.columns.length) ?? null} onHide={onTables && (() => onTables(false))} />
        ) : (
          <FoldedTable
            key={i}
            output={o}
            name={tableName?.(o.totalRows, o.columns.length) ?? null}
            onOpen={(view) => {
              setOpenView(view)
              onTables?.(true)
            }}
          />
        ),
      )}
      {hasResult && streams.length > 0 && <PrintedOutput streams={streams} />}
    </div>
  )
})

function PrintedOutput({ streams }: { streams: Stream[] }) {
  const lines = streams.reduce((n, s) => n + s.text.split('\n').length, 0)
  return (
    <details className="group/printed">
      <summary className="w-fit cursor-pointer text-xs text-faint hover:text-muted-foreground">
        Printed output · {lines} {lines === 1 ? 'line' : 'lines'}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {streams.map((s, i) => (
          <OutputView key={i} output={s} />
        ))}
      </div>
    </details>
  )
}

function OutputView({ output }: { output: Output }) {
  switch (output.type) {
    case 'stream':
      return (
        <pre
          className={cn(
            'scrollbar-thin max-h-80 overflow-auto font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap',
            output.name === 'stderr' ? 'text-warn' : 'text-muted-foreground',
          )}
        >
          {output.text}
        </pre>
      )
    case 'text':
      return <pre className="scrollbar-thin max-h-80 overflow-auto font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap">{output.text}</pre>
    case 'image':
      return <img src={`data:${output.mime};base64,${output.data}`} alt="Chart produced by the cell" className="max-w-full rounded-md" />
    case 'error':
      return (
        <div className="rounded-lg bg-destructive/10 p-3" role="alert">
          <p className="font-mono text-[12.5px] text-destructive">
            {output.ename}: {output.evalue}
          </p>
          {output.traceback.length > 1 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-faint hover:text-muted-foreground">Traceback</summary>
              <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto font-mono text-[12px] leading-[1.6] whitespace-pre text-muted-foreground">
                {stripAnsi(output.traceback.join(''))}
              </pre>
            </details>
          )}
        </div>
      )
    case 'table':
      return <TableView output={output} />
  }
}

type TableViewMode = 'columns' | 'rows'

const tableSize = (o: Table) =>
  `${o.totalRows.toLocaleString()} ${o.totalRows === 1 ? 'row' : 'rows'} × ${o.columns.length} ${o.columns.length === 1 ? 'column' : 'columns'}`

const canProfile = (o: Table) => Boolean(o.profile?.length) && o.totalRows > 20

/** A folded table: one line with its name and size, and buttons to open it. */
function FoldedTable({ output, name, onOpen }: { output: Table; name: string | null; onOpen: (view: TableViewMode) => void }) {
  const button = 'rounded px-1.5 py-0.5 text-muted-foreground hover:bg-hover hover:text-foreground'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-raised px-3 py-2 text-xs">
      {name && <span className="font-mono text-ref">{name}</span>}
      <span className="text-faint tabular-nums">{tableSize(output)}</span>
      <span className="ml-auto flex gap-1">
        {canProfile(output) && (
          <button type="button" className={button} onClick={() => onOpen('columns')}>
            Show columns
          </button>
        )}
        <button type="button" className={button} onClick={() => onOpen('rows')}>
          Show table
        </button>
      </span>
    </div>
  )
}

/** Big tables open on the column overview, small result tables on their rows. */
function TableView({ output, initialView = null, name = null, onHide }: { output: Table; initialView?: TableViewMode | null; name?: string | null; onHide?: () => void }) {
  const [view, setView] = useState<TableViewMode>(initialView ?? (canProfile(output) ? 'columns' : 'rows'))
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-xs">
        {name && <span className="font-mono text-ref">{name}</span>}
        <span className="text-muted-foreground tabular-nums">{tableSize(output)}</span>
        <span className="ml-auto flex items-center gap-2">
        {Boolean(output.profile?.length) && (
          <span className="flex gap-0.5 rounded-md bg-raised p-0.5" role="group" aria-label="Table view">
            {(['columns', 'rows'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn('rounded px-2 py-0.5 capitalize', view === v ? 'bg-hover text-foreground' : 'text-faint hover:text-muted-foreground')}
              >
                {v}
              </button>
            ))}
          </span>
        )}
        {onHide && (
          <button type="button" onClick={onHide} className="rounded px-1.5 py-0.5 text-faint hover:bg-hover hover:text-foreground">
            Hide
          </button>
        )}
        </span>
      </div>
      {view === 'columns' && output.profile ? <ColumnsView profile={output.profile} /> : <RowsView output={output} />}
    </div>
  )
}

/** Up to 100 rows. Memoized on the table, the most expensive thing a cell draws. */
const RowsView = memo(function RowsView({ output }: { output: Table }) {
  const { numeric, showIndex } = useMemo(
    () => ({
      numeric: output.columns.map((_, c) => output.rows.every((r) => r[c] == null || typeof r[c] === 'number')),
      showIndex: output.index.some((v, i) => v !== String(i)),
    }),
    [output],
  )
  return (
    <div>
      <div className="scrollbar-thin max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[13px] tabular-nums">
          <thead className="sticky top-0 bg-background text-[11.5px] text-faint">
            <tr className="border-b">
              {showIndex && <th className="py-1.5 pr-4 font-normal" />}
              {output.columns.map((c, i) => (
                <th key={i} className={cn('py-1.5 pr-4 font-normal whitespace-nowrap', numeric[i] && 'text-right')}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {output.rows.map((row, r) => (
              <tr key={r}>
                {showIndex && <td className="py-1.5 pr-4 whitespace-nowrap text-muted-foreground">{output.index[r]}</td>}
                {row.map((v, c) => (
                  <td key={c} className={cn('py-1.5 pr-4 whitespace-nowrap', numeric[c] && 'text-right', v == null && 'text-faint')}>
                    {formatValue(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {output.totalRows > output.rows.length && (
        <p className="mt-2 text-xs text-faint">First {output.rows.length} rows shown</p>
      )}
    </div>
  )
})

const KIND_LABEL: Record<ColumnProfile['kind'], string> = { number: 'number', date: 'date', text: 'text', boolean: 'yes/no' }

/** One line per column: its type, how much is missing, and what the values look like. */
function ColumnsView({ profile }: { profile: ColumnProfile[] }) {
  return (
    <div className="scrollbar-thin max-h-[480px] overflow-auto">
      <table className="w-full text-left text-[13px] tabular-nums">
        <thead className="sticky top-0 bg-background text-[11.5px] text-faint">
          <tr className="border-b">
            <th className="py-1.5 pr-4 font-normal">Column</th>
            <th className="py-1.5 pr-4 font-normal">Type</th>
            <th className="py-1.5 pr-4 text-right font-normal">Missing</th>
            <th className="py-1.5 pr-4 text-right font-normal">Distinct</th>
            <th className="py-1.5 font-normal">Values</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {profile.map((c) => {
            const missingPct = c.count ? (c.missing / c.count) * 100 : 0
            return (
              <tr key={c.name}>
                <td className="py-1.5 pr-4 font-mono text-[12.5px] whitespace-nowrap">{c.name}</td>
                <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">{KIND_LABEL[c.kind]}</td>
                <td className={cn('py-1.5 pr-4 text-right whitespace-nowrap', c.missing ? 'text-warn' : 'text-faint')}>
                  {c.missing ? `${c.missing.toLocaleString()} (${missingPct < 1 ? '<1' : Math.round(missingPct)}%)` : 'none'}
                </td>
                <td className="py-1.5 pr-4 text-right whitespace-nowrap text-muted-foreground">{c.unique?.toLocaleString() ?? ''}</td>
                <td className="py-1.5 text-muted-foreground">{describeValues(c)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function describeValues(c: ColumnProfile): string {
  if (c.kind === 'number') {
    if (c.min == null) return ''
    const mean = c.mean != null ? `, mean ${formatValue(c.mean)}` : ''
    return c.min === c.max ? `always ${formatValue(c.min)}` : `${formatValue(c.min)} to ${formatValue(c.max)}${mean}`
  }
  if (c.kind === 'date') return c.min ? `${shortDate(String(c.min))} to ${shortDate(String(c.max))}` : ''
  if (!c.top?.length) return ''
  const shown = c.top.map(([v, n]) => `${v} ${n.toLocaleString()}`).join(' · ')
  return c.unique != null && c.unique > c.top.length ? `${shown} · …` : shown
}

const shortDate = (s: string) => s.replace(/ 00:00:00$/, '')

function formatValue(v: string | number | boolean | null | undefined) {
  if (v == null) return 'None'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return String(v)
}
