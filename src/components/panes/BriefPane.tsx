import { Check, FileText, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { InlineText } from '@/components/notebook/InlineText'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { actions, useNotebook } from '@/store/notebook-store'
import { Pane } from './Pane'

const TEMPLATE = `# What this notebook is for

## Goal
One or two sentences on the question this notebook answers.

## Data
- Where the data lives and what each file holds.

## Rules
- Definitions to always use, like "revenue is in cents" or "a week starts on Monday".

## Done when
- [ ] A check the results should pass
`

type Block =
  | { type: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { type: 'item'; text: string }
  | { type: 'task'; text: string; done: boolean; line: number }

/** Headings, paragraphs, "- " lists and "- [ ]" tasks: the shape of a brief. */
function briefBlocks(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') })
    para = []
  }
  md.split('\n').forEach((line, i) => {
    const heading = line.match(/^(#{1,3})\s+(.*)/)
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/)
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/)
    if (heading) {
      flush()
      blocks.push({ type: (['h1', 'h2', 'h3'] as const)[heading[1].length - 1], text: heading[2] })
    } else if (task) {
      flush()
      blocks.push({ type: 'task', text: task[2], done: task[1] !== ' ', line: i })
    } else if (item) {
      flush()
      blocks.push({ type: 'item', text: item[1] })
    } else if (!line.trim()) flush()
    else para.push(line.trim())
  })
  flush()
  return blocks
}

function toggleTask(md: string, line: number): string {
  const lines = md.split('\n')
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'))
  return lines.join('\n')
}

/**
 * The notebook's brief: its AGENTS.md, shown as a document.
 * The agent reads it before writing every cell, so goals and definitions written here shape every result.
 */
export function BriefPane() {
  const brief = useNotebook((s) => s.brief)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(true)
  // Read by blur and unmount handlers, which would otherwise see a stale `saved`
  const unsaved = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const text = brief?.text ?? null

  useEffect(() => {
    if (!brief) void actions.loadBrief()
  }, [brief])

  const save = (value: string) => {
    clearTimeout(timer.current)
    unsaved.current = false
    void actions.saveBrief(value).then(() => setSaved(!unsaved.current))
  }

  const changed = (value: string) => {
    setDraft(value)
    unsaved.current = true
    setSaved(false)
  }

  const edit = (start = text ?? '') => {
    setDraft(start)
    // Starting from the template is a change worth saving even before any typing
    unsaved.current = start !== (text ?? '')
    setSaved(!unsaved.current)
    setEditing(true)
  }

  const done = () => {
    if (unsaved.current) save(draft)
    setEditing(false)
  }


  return (
    <Pane
      title="Brief"
      icon={<FileText />}
      onClose={() => actions.openPane(null)}
      footer={editing && !saved ? 'Saving…' : 'The agent reads it before every cell.'}
      actions={
        (editing || text != null) &&
        (editing ? (
          <IconButton label="Done editing" size="icon-xs" onClick={done}>
            <Check />
          </IconButton>
        ) : (
          <IconButton label="Edit brief" size="icon-xs" onClick={() => edit()}>
            <Pencil />
          </IconButton>
        ))
      }
    >
      <div className="flex h-full flex-col px-7 pt-3 pb-6">
        {editing ? (
          <textarea
            aria-label="Brief"
            autoFocus
            value={draft}
            spellCheck
            onChange={(e) => {
              const value = e.target.value
              changed(value)
              clearTimeout(timer.current)
              timer.current = setTimeout(() => save(value), 700)
            }}
            onBlur={() => unsaved.current && save(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') done()
            }}
            className="w-full flex-1 resize-none bg-transparent font-mono text-[13px] leading-[1.75] outline-none"
          />
        ) : text?.trim() ? (
          <article className="flex flex-col font-serif text-[15.5px] leading-[1.6]" data-selectable onDoubleClick={() => edit()}>
            {briefBlocks(text).map((b, i) => (
              <BriefBlock key={i} block={b} onToggle={(line) => save(toggleTask(text, line))} />
            ))}
          </article>
        ) : (
          <div className="flex flex-col items-start gap-3 pt-4">
            <p className="font-serif text-[22px] leading-tight tracking-[-0.01em]">Give the agent a brief</p>
            <p className="max-w-[40ch] text-[13.5px] leading-[1.6] text-muted-foreground">
              What the notebook is for, what the data is, and the definitions to stick to. The agent reads it before writing every cell.
            </p>
            <Button size="sm" onClick={() => edit(TEMPLATE)}>
              Start a brief
            </Button>
          </div>
        )}
      </div>
    </Pane>
  )
}

function BriefBlock({ block: b, onToggle }: { block: Block; onToggle: (line: number) => void }) {
  switch (b.type) {
    case 'h1':
      return <h1 className="mb-4 text-[27px] leading-[1.15] font-medium tracking-[-0.015em] text-balance">{b.text}</h1>
    case 'h2':
      return <h2 className="mt-5 mb-2 text-[19px] leading-snug font-medium">{b.text}</h2>
    case 'h3':
      return <h3 className="mt-4 mb-1 text-[16px] font-semibold">{b.text}</h3>
    case 'p':
      return (
        <p className="mb-2 text-muted-foreground">
          <InlineText text={b.text} />
        </p>
      )
    case 'item':
      return (
        <p className="mb-1 flex gap-2.5 text-muted-foreground">
          <span className="text-faint">•</span>
          <span>
            <InlineText text={b.text} />
          </span>
        </p>
      )
    case 'task':
      return (
        <label className="-mx-2 mb-0.5 flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1 font-sans text-[13.5px] hover:bg-hover">
          <input type="checkbox" checked={b.done} onChange={() => onToggle(b.line)} className="peer sr-only" />
          <span
            className={cn(
              'mt-[3px] flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border border-ring bg-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50',
              b.done && 'border-ink bg-ink text-primary-foreground',
            )}
          >
            {b.done && <Check className="size-3" strokeWidth={3} />}
          </span>
          <span className={cn(b.done && 'text-faint line-through decoration-faint/60')}>
            <InlineText text={b.text} />
          </span>
        </label>
      )
  }
}
