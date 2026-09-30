import { ChevronRight, ShieldCheck, Square, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cellTitle } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import type { MissingNameCause } from '@dalliance/shared/verify'
import { type VerifyCell, type VerifyReport, VERIFY_CONFIRMATION, actions, useNotebook, verifySummary } from '@/store/notebook-store'
import { InlineText } from './InlineText'
import { OutputList } from './outputs/OutputView'

/** Verify asks first, since it restarts Python and clears what the cells didn't make. */
export function VerifyConfirm() {
  const open = useNotebook((s) => s.verifyAsking)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && actions.cancelVerify()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Verify this notebook?</DialogTitle>
          <DialogDescription>{VERIFY_CONFIRMATION}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => actions.cancelVerify()}>
            Cancel
          </Button>
          <Button onClick={() => void actions.verify()}>Verify</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const STATUS_TEXT: Record<VerifyCell['status'], string> = {
  waiting: 'Waiting',
  same: 'Same',
  figure: 'Figure differs',
  changed: 'Changed',
  failed: 'Failed',
  stopped: 'Stopped',
  'not-run': 'Not run',
  'no-code': 'No code to run',
}

const STATUS_DOT: Record<VerifyCell['status'], string> = {
  waiting: 'bg-faint/50',
  same: 'bg-ink',
  figure: 'bg-warn',
  changed: 'bg-warn',
  failed: 'bg-destructive',
  stopped: 'bg-faint',
  'not-run': 'bg-faint/50',
  'no-code': 'bg-faint/50',
}

/**
 * The last Verify run, above the cells: where it stands, and each prompt cell's result against its saved
 * outputs. The saved outputs are never changed here, except by the explicit Keep the new outputs.
 */
export function VerifyReportView({ report }: { report: VerifyReport }) {
  const runningId = useNotebook((s) => Object.keys(s.runs).find((id) => s.runs[id].status === 'running' && report.cells.some((c) => c.id === id)) ?? null)
  const busy = report.phase === 'restarting' || report.phase === 'running' || report.phase === 'stopping'
  const planned = report.cells.filter((c) => c.status !== 'no-code').length
  const running = report.cells.find((c) => c.id === runningId)
  const status =
    report.phase === 'restarting'
      ? 'Restarting Python.'
      : report.phase === 'stopping'
        ? 'Stopping.'
        : report.phase === 'failed'
          ? `Python didn't restart, so nothing ran. ${report.error ?? ''}`.trim()
          : report.phase === 'running'
            ? running
              ? `Rerunning cell ${running.number}, ${report.cells.filter((c) => c.status !== 'waiting' && c.status !== 'no-code').length + 1} of ${planned}.`
              : 'Rerunning the cells.'
            : verifySummary(report)
  return (
    <section aria-label="Verify report" className="mb-6 ml-11 rounded-xl border bg-background px-4 py-3 shadow-pane">
      <header className="flex items-center gap-2">
        <ShieldCheck className="size-3.5 text-ink" />
        <h3 className="text-[13px] font-medium">Verify</h3>
        <div className="ml-auto flex items-center gap-1">
          {busy ? (
            <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={report.phase === 'stopping'} onClick={() => void actions.interrupt()}>
              <Square className="size-2.5 fill-current" />
              Stop
            </Button>
          ) : (
            <IconButton label="Close the report" size="icon-xs" onClick={() => actions.closeVerify()}>
              <X />
            </IconButton>
          )}
        </div>
      </header>
      <p className="mt-1 text-[13.5px] leading-[1.55] text-muted-foreground" role="status">
        {status}
      </p>
      {!busy && report.phase !== 'failed' && (
        <p className="mt-0.5 text-xs text-faint">Saved outputs stay as they were, unless you keep a cell's new ones.</p>
      )}
      <ol aria-label="Cells" className="mt-3 flex flex-col gap-1">
        {report.cells.map((c) => (
          <ReportRow key={c.id} entry={c} running={c.id === runningId} />
        ))}
      </ol>
    </section>
  )
}

function ReportRow({ entry, running }: { entry: VerifyCell; running: boolean }) {
  const cell = useNotebook((s) => s.notebook.cells.find((c) => c.id === entry.id))
  const [open, setOpen] = useState(false)
  const comparable = (entry.status === 'changed' || entry.status === 'figure') && entry.fresh != null
  const kept = comparable && cell?.kind === 'prompt' && cell.outputs === entry.fresh
  const canKeep = comparable && !kept && cell?.kind === 'prompt' && cell.code === entry.code
  const error = entry.status === 'failed' ? errorLine(entry) : null
  return (
    <li className="flex flex-col gap-1.5 border-t py-2 first:border-t-0">
      <div className="flex items-baseline gap-2.5 text-[13px]">
        <span aria-hidden className={cn('size-1.5 shrink-0 -translate-y-px rounded-full', running ? 'bg-go pulse' : STATUS_DOT[entry.status])} />
        <button
          type="button"
          disabled={!cell}
          onClick={() => actions.select(entry.id)}
          className="min-w-0 flex-1 truncate text-left text-muted-foreground enabled:hover:text-foreground"
        >
          <span className="text-faint tabular-nums">Cell {entry.number}</span> {cell ? cellTitle(cell, 60) : 'Deleted'}
        </button>
        <span className={cn('shrink-0 text-xs', entry.status === 'failed' ? 'text-destructive' : entry.status === 'same' ? 'text-ink' : 'text-muted-foreground')}>
          {running ? 'Running' : STATUS_TEXT[entry.status]}
        </span>
      </div>
      {(error || entry.missing || entry.seeds.length > 0 || comparable) && (
        <div className="ml-4 flex flex-col gap-1.5 text-[13px] leading-[1.5]">
          {error && (
            <p className="font-mono text-[12px] break-words text-destructive" data-selectable>
              {error}
            </p>
          )}
          {entry.missing && (
            <p data-selectable>
              <InlineText text={missingText(entry.missing.name, entry.missing.cause)} />
            </p>
          )}
          {entry.status === 'failed' && entry.saved.some((o) => o.type === 'error') && <p className="text-xs text-faint">It had failed when it was saved too.</p>}
          {entry.seeds.map((w) => (
            <p key={w.call} className="flex items-baseline gap-1.5 text-muted-foreground" data-selectable>
              <TriangleAlert aria-label="Warning" className="size-3 shrink-0 translate-y-px text-warn" />
              <span>
                <InlineText text={w.text} />
              </span>
            </p>
          ))}
          {comparable && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-xs text-faint hover:text-muted-foreground">
                <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
                {open ? 'Hide' : 'Show'} saved and new {entry.status === 'figure' ? 'figures' : 'outputs'}
              </button>
              {canKeep && (
                <Button variant="outline" size="xs" onClick={() => actions.keepVerified(entry.id)}>
                  Keep the new outputs
                </Button>
              )}
              {kept && <span className="text-xs text-faint">The new outputs replaced the saved ones.</span>}
            </div>
          )}
          {comparable && open && (
            <div className="grid grid-cols-2 gap-3" role="group" aria-label={`Saved and new outputs of cell ${entry.number}`}>
              <Side title="Saved" outputs={entry.saved} />
              <Side title="New" outputs={entry.fresh!} />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Side({ title, outputs }: { title: string; outputs: VerifyCell['saved'] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-x-auto" aria-label={title} role="group">
      <p className="eyebrow">{title}</p>
      {outputs.length ? <OutputList outputs={outputs} /> : <p className="text-xs text-faint">No output</p>}
    </div>
  )
}

/** The Python error in one line, or why the rerun couldn't happen. */
function errorLine(entry: VerifyCell): string | null {
  const err = entry.fresh?.find((o) => o.type === 'error')
  if (err?.type === 'error') return `${err.ename}${err.evalue ? `: ${err.evalue}` : ''}`
  return entry.error
}

/** Why a name was missing, in plain words. */
function missingText(name: string, cause: MissingNameCause): string {
  switch (cause.kind) {
    case 'failed-above':
      return `\`${name}\` comes from cell ${cause.cell}, which failed above.`
    case 'below':
      return `\`${name}\` is only created by cell ${cause.cell}, further down. Cells run top to bottom, so move that cell above this one.`
    case 'agent':
      return `No cell creates \`${name}\`. The agent made it while working on cell ${cause.cell}, exploring the data, so this cell only worked in the session it was written in.`
    case 'nowhere':
      return `No cell creates \`${name}\`. It was made outside the cells, most likely by the agent exploring the data or by code from an earlier session, and the restart cleared it.`
  }
}
