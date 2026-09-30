import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronRight, Copy, Loader2, Pin, PinOff, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { answerBlocks, answerHtml, answerMarkdown, formatDuration, highlightPython, parseMarkdown } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { ActivityItem } from '@dalliance/shared/ipc'
import { splitLeaked } from '@dalliance/shared/leaked'
import { type Cell, type NoteCell, type PromptCell, needsGeneration, parseInterpretation, tablesOpen } from '@dalliance/shared/notebook'
import { type CellRun, actions, useNotebook } from '@/store/notebook-store'
import { HighlightedEditor } from './HighlightedEditor'
import { InlineText } from './InlineText'
import { MarkdownText } from './MarkdownText'
import { OutputList } from './outputs/OutputView'
import { RefText } from './RefText'

interface CellViewProps {
  cell: Cell
  /** The cell's place among the prompt cells, from 1. Zero for a note. */
  number: number
  selected: boolean
}

/** Shift+Enter, Cmd+Enter and Alt+Enter work inside every cell editor, as in Jupyter. */
function editorKeys(cellId: string, onEscape?: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      e.currentTarget.blur()
      actions.runAndAdvance(cellId)
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      actions.run(cellId)
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault()
      actions.run(cellId)
      const index = useNotebook.getState().notebook.cells.findIndex((c) => c.id === cellId)
      actions.insertCell(index + 1, 'prompt')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.currentTarget.blur()
      onEscape?.()
    }
  }
}

/**
 * One cell. Memoized, so it redraws only when its own cell object, number or selection changes. The store
 * keeps unchanged cells as the same objects, and each cell subscribes to its own run, so typing in one cell
 * or streaming output into it leaves every other cell alone.
 */
export const CellView = memo(function CellView({ cell, number, selected }: CellViewProps) {
  return (
    <article
      aria-label={cell.kind === 'note' ? 'Note' : `Prompt cell ${number}`}
      data-cell-id={cell.id}
      data-selected={selected || undefined}
      onMouseDown={() => actions.select(cell.id)}
      onFocus={() => actions.select(cell.id)}
      className="group relative flex gap-2 py-3 pr-1"
    >
      <span className="absolute inset-y-3 -left-2.5 w-0.5 rounded-full group-focus-within:bg-ring group-data-selected:bg-ring" />
      <div className="w-9 shrink-0 pt-[3px]">{cell.kind === 'prompt' && <RunButton cellId={cell.id} number={number} count={cell.executionCount} />}</div>
      <div className="min-w-0 flex-1">{cell.kind === 'prompt' ? <PromptCellView cell={cell} selected={selected} /> : <NoteCellView cell={cell} />}</div>
    </article>
  )
})

/** Jupyter's [n] gutter. Its name says which cell it runs; the [n] it shows is its description. */
function RunButton({ cellId, number, count }: { cellId: string; number: number; count: number | null }) {
  const status = useNotebook((s) => s.runs[cellId]?.status)
  const describedBy = useId()
  const label = status === 'running' ? '[*]' : status === 'queued' ? '[·]' : count != null ? `[${count}]` : '[ ]'
  const spoken = status === 'running' ? 'Running' : status === 'queued' ? 'Queued' : count != null ? `Execution count ${count}` : 'Not run yet'
  return (
    <button
      type="button"
      aria-label={`Run cell ${number}`}
      aria-describedby={describedBy}
      title="Run cell (Shift+Enter)"
      onClick={() => actions.run(cellId)}
      className={cn('group/run relative block h-6 w-9 text-left font-mono text-[11px]', status ? 'text-warn' : 'text-faint')}
    >
      <span aria-hidden="true" className={cn(!status && 'group-hover/run:invisible')}>
        {label}
      </span>
      <span id={describedBy} className="sr-only">
        {spoken}
      </span>
      {!status && <Play className="absolute top-1/2 left-0 hidden size-3 -translate-y-1/2 fill-go text-go group-hover/run:block" />}
    </button>
  )
}

function CellActions({ cell, children }: { cell: Cell; children?: ReactNode }) {
  return (
    <span className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-data-selected:opacity-100">
      {children}
      <IconButton label="Move up" size="icon-xs" onClick={() => actions.moveCell(cell.id, -1)}>
        <ArrowUp />
      </IconButton>
      <IconButton label="Move down" size="icon-xs" onClick={() => actions.moveCell(cell.id, 1)}>
        <ArrowDown />
      </IconButton>
      <IconButton label="Delete cell" size="icon-xs" onClick={() => actions.deleteCell(cell.id)}>
        <Trash2 />
      </IconButton>
    </span>
  )
}

function StatusText({ cell, run }: { cell: PromptCell; run: CellRun | undefined }) {
  if (run?.status === 'queued') return <span className="text-faint">queued</span>
  if (run) return null
  if (cell.state === 'edited')
    return <span className="text-muted-foreground">{needsGeneration(cell) ? 'edited' : cell.codeEdited ? 'code edited' : 'not run'}</span>
  if (cell.state === 'stale') return <span className="text-warn">out of date</span>
  if (cell.state === 'error') return <span className="text-destructive">failed</span>
  return null
}

function PromptCellView({ cell, selected }: { cell: PromptCell; selected: boolean }) {
  // This cell's run only: another cell's status ticks and streamed output don't reach it
  const run = useNotebook((s) => s.runs[cell.id])
  const message = useNotebook((s) => s.messages[cell.id])
  const activity = useNotebook((s) => s.activity[cell.id])
  const pinned = useNotebook((s) => s.pinnedIds.includes(cell.id))
  // Suggestions follow the result you just got, or the cell you're looking at, not every cell at once
  const suggest = useNotebook((s) => s.lastFinishedId === cell.id) || selected
  const running = run?.status === 'running'
  const outputs = running ? run.liveOutputs : cell.outputs
  const code = running && run.liveCode != null ? run.liveCode : cell.code
  // While the agent is still reading, there is nothing to show under the tabs yet
  const hasBody = running ? run.liveCode != null : Boolean(cell.code || cell.outputs.length > 0)
  // A question answered in words has no code, so it shows the answer without tabs
  const answerOnly = !running && !hasBody && Boolean(cell.answer)
  // Stable, so the memoized output list skips redrawing its tables while the prompt is typed
  const id = cell.id
  const variables = cell.variables
  const onTables = useCallback((open: boolean) => actions.toggleTables(id, open), [id])
  const tableName = useCallback(
    (rows: number, columns: number) => variables.find((v) => v.shape === `${rows.toLocaleString('en-US')} × ${columns}`)?.name ?? null,
    [variables],
  )
  const keys = useMemo(() => editorKeys(id), [id])

  return (
    <>
      <div className="flex items-start gap-3">
        <HighlightedEditor
          cellId={cell.id}
          label="Prompt"
          value={cell.prompt}
          onChange={(v) => actions.setPrompt(cell.id, v)}
          onKeyDown={keys}
          render={(v) => <RefText text={v} />}
          placeholder="Describe what you want to compute. Shift+Enter to run."
          className="text-[15px] leading-[1.6]"
        />
        <div className="flex shrink-0 items-center gap-2 pt-0.5 text-xs">
          <StatusText cell={cell} run={run} />
          <CellActions cell={cell}>
            {cell.code && !run && (
              <IconButton label="Rewrite the code from the prompt" size="icon-xs" onClick={() => actions.regenerate(cell.id)}>
                <RefreshCw />
              </IconButton>
            )}
          </CellActions>
        </div>
      </div>

      {!running && hasAssumptions(cell.interpretation) && <Interpretation cell={cell} />}
      {run && <RunProgress cellId={cell.id} run={run} />}
      {message && !run && (
        <div className="mt-2 flex items-start gap-2 text-[13px] text-destructive" role="alert">
          <span className="flex-1" data-selectable>{message}</span>
          <button type="button" aria-label="Dismiss" className="text-faint hover:text-foreground" onClick={() => actions.dismissMessage(cell.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {answerOnly && (
        <div className="mt-3 flex flex-col gap-2">
          <Answer text={cell.answer!} />
          <span className="flex items-center gap-3 font-mono text-[11px] text-faint tabular-nums">
            {activity?.length ? <ActivityToggle items={activity} /> : null}
            {cell.durationMs != null && formatDuration(cell.durationMs)}
          </span>
          {suggest && cell.state === 'done' && <Suggestions cell={cell} />}
        </div>
      )}

      {hasBody && (
        <Tabs defaultValue="result" className={cn('mt-3 gap-2 transition-opacity', cell.state === 'stale' && !run && 'opacity-40')}>
          <div className="flex items-center gap-3">
            <TabsList variant="line" className="h-auto gap-3 p-0">
              <TabsTrigger value="result" className={tabTrigger}>
                Result
              </TabsTrigger>
              <TabsTrigger value="code" className={tabTrigger}>
                Code
              </TabsTrigger>
            </TabsList>
            {cell.codeEdited && <span className="text-xs text-faint">· your code</span>}
            <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-faint tabular-nums">
              {!running && activity?.length ? <ActivityToggle items={activity} /> : null}
              {!running && cell.durationMs != null && formatDuration(cell.durationMs)}
              {!running && (cell.outputs.length > 0 || cell.answer) && (
                <IconButton
                  label={pinned ? 'Unpin result' : 'Pin result to the side'}
                  size="icon-xs"
                  aria-pressed={pinned}
                  className={cn('-my-1 -mr-1', !pinned && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100', pinned && 'text-ink')}
                  onClick={() => actions.togglePin(cell.id)}
                >
                  {pinned ? <PinOff /> : <Pin />}
                </IconButton>
              )}
            </span>
          </div>
          <TabsContent value="result" className="flex flex-col gap-3">
            {!running && cell.answer && <Answer text={cell.answer} />}
            <OutputList outputs={outputs} tablesOpen={running || tablesOpen(cell)} onTables={onTables} tableName={tableName} />
            {!running && cell.variables.length > 0 && <CreatedVariables cell={cell} />}
            {!running && !cell.answer && !outputs.length && cell.executionCount != null && <p className="text-sm text-faint">No output</p>}
            {!running && suggest && cell.state === 'done' && <Suggestions cell={cell} />}
          </TabsContent>
          <TabsContent value="code">
            <HighlightedEditor
              cellId={cell.id}
              focusTarget={false}
              label="Code"
              value={code}
              onChange={(v) => actions.setCode(cell.id, v)}
              onKeyDown={keys}
              render={(v) => <PythonTokens code={v} />}
              placeholder="Code appears here after the first run. You can also write it yourself."
              indent
              className="code rounded-lg bg-raised p-3 font-mono text-[12.5px] leading-[1.7]"
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  )
}

/** What the agent thinks you might ask next. Clicking one adds it as the next cell and runs it. */
function Suggestions({ cell }: { cell: PromptCell }) {
  // Turned off in Settings: hide the ones cells already hold too
  const enabled = useNotebook((s) => s.settings?.suggestNext !== false)
  if (!enabled || !cell.suggestions.length) return null
  return (
    <ul aria-label="Suggested next prompts" className="-mx-2 flex flex-col">
      {cell.suggestions.map((s) => (
        <li key={s}>
          <button
            type="button"
            onClick={() => actions.runSuggestion(cell.id, s)}
            className="group/sug flex w-full items-baseline gap-2.5 rounded-md px-2 py-1 text-left text-[13.5px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <ArrowRight className="size-3.5 shrink-0 translate-y-[2px] text-faint transition-transform group-hover/sug:translate-x-0.5 group-hover/sug:text-ink" />
            <RefText text={s} />
          </button>
        </li>
      ))}
    </ul>
  )
}

const hasAssumptions = (text: string | null) => Boolean(text && /\[\[[^\]]+\]\]/.test(text))

/** The answer leads the result. Long answers fold until you ask for more. */
const Answer = memo(function Answer({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  // Answers saved before the harness cleaned up leaked tool markup still carry it
  const clean = useMemo(() => splitLeaked(text).text, [text])
  const long = clean.length > 600
  return (
    <div className="flex items-start gap-1">
      <div className="max-w-[62ch] min-w-0 flex-1">
        <div
          data-selectable
          className={cn('flex flex-col gap-3 font-serif text-[16px] leading-[1.6]', long && !open && 'max-h-[11rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]')}
        >
          {answerBlocks(clean).map((b, i) =>
            b.type === 'p' ? (
              <p key={i}>
                <InlineText text={b.text} />
              </p>
            ) : (
              <ul key={i} className="flex flex-col gap-1.5">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className={cn('shrink-0 text-faint tabular-nums', b.ordered && 'min-w-[1.1em] text-right')}>{b.ordered ? `${j + 1}.` : '•'}</span>
                    <span>
                      <InlineText text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            ),
          )}
        </div>
        {long && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-xs text-faint hover:text-muted-foreground">
            {open ? 'Less' : 'More'}
          </button>
        )}
      </div>
      <CopyAnswer text={clean} />
    </div>
  )
})

/** Copies the answer with its formatting for documents and chats, and as Markdown for plain-text editors. */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const html = answerHtml(text)
    const plain = answerMarkdown(text)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
      ])
    } catch {
      await navigator.clipboard.writeText(plain)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <IconButton
      label={copied ? 'Copied' : 'Copy answer'}
      size="icon-xs"
      onClick={() => void copy()}
      className={cn('shrink-0', copied ? 'text-go hover:text-go' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-selected:opacity-100')}
    >
      {copied ? <Check /> : <Copy />}
    </IconButton>
  )
}

/** What later cells can refer to with @name. */
function CreatedVariables({ cell }: { cell: PromptCell }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-faint">
      <span>Created</span>
      {cell.variables.map((v) => (
        <span key={v.name} title={v.type}>
          <span className="font-mono text-ref">{v.name}</span>
          {v.shape && <span className="ml-1.5 tabular-nums">{v.shape}</span>}
        </span>
      ))}
    </p>
  )
}

const tabTrigger =
  'h-auto flex-none rounded-none border-0 px-0 py-0 text-xs font-normal text-faint after:hidden hover:text-muted-foreground data-active:bg-transparent data-active:text-foreground dark:data-active:border-transparent dark:data-active:bg-transparent'

export function PythonTokens({ code }: { code: string }) {
  return (
    <>
      {highlightPython(code).map((t, i) =>
        t.type === 'plain' ? (
          t.value
        ) : (
          <span key={i} className={t.type}>
            {t.value}
          </span>
        ),
      )}
    </>
  )
}

/** How the agent read the prompt. Assumptions are underlined; click one to correct it. */
function Interpretation({ cell }: { cell: PromptCell }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  return (
    <p className="mt-1.5 max-w-[62ch] text-[13px] leading-[1.7] text-faint" data-selectable>
      {parseInterpretation(cell.interpretation ?? '').map((seg, i) => {
        if (!seg.assumption) return <InlineText key={i} text={seg.text} />
        if (editing === seg.text)
          return (
            <input
              key={i}
              autoFocus
              aria-label="Correct this assumption"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                actions.correctAssumption(cell.id, seg.text, draft)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditing(null)
              }}
              className="border-b border-foreground bg-transparent text-foreground outline-none"
              style={{ width: `${Math.max(draft.length, 8)}ch` }}
            />
          )
        return (
          <button
            key={i}
            type="button"
            className="assumption"
            title="Click to change this assumption"
            onClick={() => {
              setEditing(seg.text)
              setDraft(seg.text)
            }}
          >
            {seg.text}
          </button>
        )
      })}
    </p>
  )
}

function RunProgress({ cellId, run }: { cellId: string; run: CellRun }) {
  if (run.status === 'queued') return null
  return (
    <div className="mt-2 flex flex-col gap-2">
      {run.activity.length > 0 && <ActivityList items={run.activity} />}
      {!run.question && !run.approval && !run.activity.some((a) => a.status === 'running') && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          {run.statusText}
        </div>
      )}
      {run.question && <QuestionCard cellId={cellId} question={run.question} />}
      {run.approval && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3 py-2.5 text-[13px]" role="alertdialog" aria-label={run.approval.title}>
          <span className="flex-1">
            {run.approval.title} <span className="font-mono text-xs text-faint">{run.approval.detail}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => actions.answer(cellId, run.approval!.requestId, false)}>
            Don't install
          </Button>
          <Button size="sm" variant="secondary" onClick={() => actions.answer(cellId, run.approval!.requestId, true)}>
            Install
          </Button>
        </div>
      )}
    </div>
  )
}

function QuestionCard({ cellId, question }: { cellId: string; question: NonNullable<CellRun['question']> }) {
  const [other, setOther] = useState('')
  const reply = (answer: string | null) => actions.answer(cellId, question.requestId, answer)
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-raised px-3 py-3" role="alertdialog" aria-label={question.question}>
      <p className="text-[14px]">{question.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((o) => (
          <Button key={o} size="sm" variant="secondary" onClick={() => reply(o)}>
            {o}
          </Button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (other.trim()) reply(other.trim())
        }}
      >
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Or type an answer"
          aria-label="Your answer"
          className="h-7 flex-1 rounded-md bg-hover px-2 text-[13px] outline-none placeholder:text-faint"
        />
        <Button size="sm" variant="ghost" type="button" className="text-muted-foreground" onClick={() => reply(null)}>
          Skip
        </Button>
      </form>
    </div>
  )
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="flex flex-col gap-1 text-[12.5px]">
      {items.map((a) => (
        <li key={a.id} className="flex items-baseline gap-2">
          <span className="w-3 shrink-0">
            {a.status === 'running' ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground motion-reduce:animate-none" />
            ) : a.status === 'error' ? (
              <X className="size-3 text-destructive" />
            ) : (
              <Check className="size-3 text-go" />
            )}
          </span>
          <span className={a.status === 'running' ? 'text-muted-foreground' : 'text-faint'}>{a.label}</span>
          {a.detail && <span className="truncate font-mono text-[11.5px] text-faint">{a.detail}</span>}
        </li>
      ))}
    </ol>
  )
}

/** After a run, the agent's steps fold into a small toggle next to the duration. */
function ActivityToggle({ items }: { items: ActivityItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 hover:text-muted-foreground" aria-expanded={open}>
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {items.length} {items.length === 1 ? 'step' : 'steps'}
      </button>
      {open && (
        <div className="absolute top-5 right-0 z-20 w-80 rounded-lg border bg-popover p-3 font-sans shadow-xl">
          <ActivityList items={items} />
        </div>
      )}
    </span>
  )
}

function NoteCellView({ cell }: { cell: NoteCell }) {
  const focusAsked = useNotebook((s) => s.focusId === cell.id)
  const [editing, setEditing] = useState(!cell.markdown.trim())
  // Leaving the editor with Esc puts focus on the preview, so the keyboard keeps its place
  const [refocus, setRefocus] = useState(false)
  // Enter in command mode or on the preview, or a newly inserted note, asks this cell to open its editor
  const isEditing = editing || focusAsked
  const stop = () => {
    if (cell.markdown.trim()) setEditing(false)
  }
  return (
    <div className="flex items-start gap-3">
      {isEditing ? (
        <HighlightedEditor
          cellId={cell.id}
          label="Note"
          value={cell.markdown}
          onChange={(v) => actions.setNote(cell.id, v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              stop()
              if (e.shiftKey) {
                const cells = useNotebook.getState().notebook.cells
                const i = cells.findIndex((c) => c.id === cell.id)
                if (cells[i + 1]) actions.select(cells[i + 1].id)
                else actions.insertCell(i + 1, 'prompt')
              }
              return
            }
            editorKeys(cell.id, () => {
              setRefocus(true)
              stop()
            })(e)
          }}
          onFocus={() => {
            setEditing(true)
            setRefocus(false)
          }}
          onBlur={stop}
          render={(v) => v}
          placeholder="Write a note in Markdown. # for a heading."
          className="font-mono text-[13.5px] leading-[1.7]"
        />
      ) : (
        <NoteMarkdown markdown={cell.markdown} autoFocus={refocus} onEdit={() => actions.focus(cell.id)} />
      )}
      <div className="flex shrink-0 items-center pt-0.5">
        <CellActions cell={cell} />
      </div>
    </div>
  )
}

/**
 * A note as a document. It takes keyboard focus, and Enter or a double-click opens the editor. It has no
 * button role, so its headings stay headings for screen readers.
 */
function NoteMarkdown({ markdown, autoFocus, onEdit }: { markdown: string; autoFocus: boolean; onEdit: () => void }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown])
  const hint = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Set when the preview comes back from the editor, and unchanged while it's up
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  return (
    <>
      <span id={hint} className="sr-only">
        Press Enter to edit this note.
      </span>
      <div
        ref={ref}
        className="-m-1 flex min-w-0 flex-1 cursor-text flex-col gap-2 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        data-selectable
        tabIndex={0}
        aria-describedby={hint}
        onDoubleClick={onEdit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
          e.preventDefault()
          onEdit()
        }}
        title="Double-click or press Enter to edit"
      >
        {blocks.map((b, i) => {
          switch (b.type) {
            case 'h1':
              return (
                <h1 key={i} className="font-serif text-[27px] leading-[1.2] font-medium tracking-[-0.015em] text-balance">
                  <MarkdownText text={b.text} />
                </h1>
              )
            case 'h2':
              return (
                <h2 key={i} className="mt-1 font-serif text-[19px] font-medium text-balance">
                  <MarkdownText text={b.text} />
                </h2>
              )
            case 'h3':
              return (
                <h3 key={i} className="mt-1 font-serif text-[16px] font-semibold text-balance">
                  <MarkdownText text={b.text} />
                </h3>
              )
            case 'p':
              return (
                <p key={i} className="max-w-[62ch] font-serif text-[16px] leading-[1.6] text-muted-foreground">
                  <MarkdownText text={b.text} />
                </p>
              )
            case 'quote':
              return (
                <blockquote key={i} className="max-w-[62ch] border-l-2 border-ring pl-4 font-serif text-[16px] leading-[1.6] text-muted-foreground italic">
                  <MarkdownText text={b.text} />
                </blockquote>
              )
            case 'list':
              return (
                <ul key={i} className="flex max-w-[62ch] flex-col gap-1.5 font-serif text-[16px] leading-[1.6] text-muted-foreground">
                  {b.items.map((item, j) => (
                    <li key={j} className="flex gap-2.5">
                      <span className={cn('shrink-0 text-faint tabular-nums', b.ordered && 'min-w-[1.1em] text-right')}>{b.ordered ? `${b.start + j}.` : '•'}</span>
                      <span className="min-w-0">
                        <MarkdownText text={item} />
                      </span>
                    </li>
                  ))}
                </ul>
              )
            case 'code':
              return (
                <pre key={i} className="code scrollbar-thin overflow-x-auto rounded-lg bg-raised p-3 font-mono text-[12.5px] leading-[1.7]">
                  {b.lang === '' || b.lang === 'python' || b.lang === 'py' ? <PythonTokens code={b.text} /> : b.text}
                </pre>
              )
            case 'rule':
              return <hr key={i} className="my-1 border-border" />
          }
        })}
      </div>
    </>
  )
}
