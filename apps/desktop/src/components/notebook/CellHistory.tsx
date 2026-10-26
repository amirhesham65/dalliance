import { Pencil, Sparkles } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineText } from './InlineText'
import { PythonTokens } from './PythonTokens'
import { RefText } from './RefText'
import { ago } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { PromptCell, Revision } from '@dalliance/shared/notebook'
import { actions } from '@/store/notebook-store'

export function CellHistory({ cell }: { cell: PromptCell }) {
  const current = cell.history.find((r) => isCurrent(cell, r))
  const earlier = cell.history.filter((r) => r !== current)
  if (!cell.history.length) return <p className="text-[13px] leading-[1.6] text-faint">Each time this cell runs with a new prompt or code, its working version is kept here.</p>
  return (
    <div className="flex flex-col gap-4">
      <Group label={current ? 'Current' : 'Current · not run yet'}>
        {current ? <RevisionEntry cell={cell} rev={current} current /> : <li className="text-[13px] text-faint">You changed the cell since its last run.</li>}
      </Group>
      {earlier.length > 0 && (
        <Group label="Earlier">
          {earlier.map((rev) => <RevisionEntry key={rev.at} cell={cell} rev={rev} />)}
        </Group>
      )}
    </div>
  )
}

const isCurrent = (cell: PromptCell, r: Revision) => r.code === cell.code && r.prompt === cell.prompt

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-2">{label}</h3>
      <ol className="relative flex flex-col gap-3 pl-5 before:absolute before:top-2 before:bottom-2 before:left-[4px] before:w-px before:bg-border">
        {children}
      </ol>
    </section>
  )
}

export function RevisionEntry({ cell, rev, current = isCurrent(cell, rev), heading }: { cell: PromptCell; rev: Revision; current?: boolean; heading?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const lines = rev.code.split('\n')
  const preview = open ? rev.code : lines.slice(0, 4).join('\n')
  return (
    <li className={cn('group/rev relative', heading && 'ml-5')}>
      <span className={cn('absolute top-[5px] -left-5 size-[9px] rounded-full border-2 bg-background', current ? 'border-ink bg-ink' : 'border-ring')} />
      {heading}
      <div className="flex items-center gap-2 text-xs text-faint">
        <span className="flex items-center gap-1 [&_svg]:size-3">
          {rev.edited ? <Pencil /> : <Sparkles />}
          {rev.edited ? 'Your code' : 'Agent'}
        </span>
        <span>·</span>
        <span className="tabular-nums">{ago(rev.at)}</span>
        {heading && current && <span className="ml-auto">Current</span>}
        {!current && (
          <Button size="xs" variant="outline" className="ml-auto opacity-0 group-focus-within/rev:opacity-100 group-hover/rev:opacity-100" onClick={() => actions.restoreRevision(cell.id, rev.at)}>
            Restore
          </Button>
        )}
      </div>
      {rev.prompt !== cell.prompt && (
        <p className="mt-1 text-[13px] text-muted-foreground">
          <RefText text={rev.prompt || '(no prompt)'} />
        </p>
      )}
      {rev.answer && (
        <p className="mt-1 line-clamp-2 font-serif text-[13.5px] leading-[1.5] text-muted-foreground" data-selectable>
          <InlineText text={rev.answer} />
        </p>
      )}
      {rev.code && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 block w-full text-left" aria-expanded={open} title={open ? 'Show less' : 'Show all the code'}>
          <pre className="code scrollbar-thin overflow-x-auto rounded-lg bg-raised px-2.5 py-2 font-mono text-[11.5px] leading-[1.6]" data-selectable>
            <PythonTokens code={preview} />
            {!open && lines.length > 4 && <span className="text-faint">{`\n… ${lines.length - 4} more lines`}</span>}
          </pre>
        </button>
      )}
    </li>
  )
}
