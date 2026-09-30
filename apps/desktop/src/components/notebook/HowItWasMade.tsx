import { ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { modelLabel } from '@/lib/notebook/text'
import { cn } from '@/lib/utils'
import { type PromptCell, type Provenance, type ProvenanceApproval, parseInterpretation } from '@dalliance/shared/notebook'
import { InlineText } from './InlineText'
import { PythonTokens } from './PythonTokens'

/**
 * How the agent made a cell's code, in plain words, from the cell's record: the prompt, the model, the agent's
 * stated rationale, the attempts, the files read and what was allowed. The code is one click away.
 */
export function HowItWasMade({ cell, record }: { cell: PromptCell; record: Provenance }) {
  const final = record.attempts.at(-1)
  const code = final?.code ?? ''
  const earlier = record.attempts.slice(0, -1)
  const unsaved = record.attemptCount - record.attempts.length
  return (
    <section aria-label="How this was made" className="flex max-w-[68ch] flex-col gap-4 text-[13.5px] leading-[1.6]" data-selectable>
      <p>{summary(record, Boolean(code))}</p>
      {record.prompt && (
        <p className="text-muted-foreground">
          From the prompt “{record.prompt}”
          {record.corrections.length > 0 && <>, with your corrections: {record.corrections.map((c) => `“${c.to}” instead of “${c.from}”`).join(', ')}</>}.
        </p>
      )}

      <Part title="Stated rationale">
        <p className="text-xs text-faint">{RATIONALE_NOTE[record.rationale.from]}</p>
        {record.rationale.text.map((t, i) => (
          <p key={i} className="whitespace-pre-wrap">
            <InlineText text={plain(t)} />
          </p>
        ))}
      </Part>

      {record.attemptCount > 0 && (
        <Part title="Attempts">
          <p>{attemptsSentence(record)}</p>
          {earlier.length > 0 && (
            <ol className="flex flex-col gap-2">
              {earlier.map((a, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">Attempt {i + 1}: </span>
                  {a.error ?? 'ran'}
                  {a.changed ? <Changed text={a.changed} /> : null}
                </li>
              ))}
            </ol>
          )}
          {final && (
            <div>
              <span className="text-muted-foreground">Final attempt: </span>
              {final.error ? `failed with ${final.error}` : 'ran without errors'}
              {final.changed ? <Changed text={final.changed} /> : null}
            </div>
          )}
          {unsaved > 0 && (
            <p className="text-xs text-faint">
              The notebook keeps only the final attempt. The {unsaved === 1 ? 'earlier one is' : `${unsaved} earlier ones are`} in the agent log, logs/agent.jsonl.
            </p>
          )}
        </Part>
      )}

      {record.filesRead.length > 0 && (
        <Part title="Files read">
          <ul className="flex flex-col gap-0.5">
            {record.filesRead.map((f) => (
              <li key={f.path}>
                <span className="font-mono text-[12.5px]">{f.path}</span>
                <span className="text-faint"> · {f.by === 'code' ? 'by the code' : 'looked at by the agent'}</span>
              </li>
            ))}
          </ul>
          {record.filesReadTruncated && <p className="text-xs text-faint">It read more files than the record lists.</p>}
        </Part>
      )}

      {record.approvals.length > 0 && (
        <Part title="Allowed and refused">
          <ul className="flex flex-col gap-0.5">
            {record.approvals.map((a, i) => (
              <li key={i}>
                {APPROVAL_OUTCOME[a.outcome]} {APPROVAL_KIND[a.kind]}: <span className="font-mono text-[12.5px]">{a.detail}</span>
              </li>
            ))}
          </ul>
        </Part>
      )}

      <Part title="Fingerprints">
        <p className="text-xs text-faint">SHA-256 of the code and of its outputs, to check later that neither changed.</p>
        <p className="font-mono text-[12px] break-all text-muted-foreground">
          code {record.codeHash || 'not recorded'}
          <br />
          outputs {record.outputsHash || 'not recorded'}
        </p>
      </Part>

      {code && <CodeAsWritten code={code} changed={code !== cell.code} />}
    </section>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </div>
  )
}

function Changed({ text }: { text: string }) {
  return <pre className="code mt-1 overflow-x-auto rounded-md bg-raised px-2.5 py-1.5 font-mono text-[12px] leading-[1.6] whitespace-pre text-muted-foreground">{text}</pre>
}

/** The code the agent wrote, folded until asked for. */
function CodeAsWritten({ code, changed }: { code: string; changed: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 self-start text-xs text-faint hover:text-muted-foreground">
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {open ? 'Hide the code' : 'Show the code'}
      </button>
      {changed && <p className="text-xs text-faint">The cell's code has changed since: this is the code the agent wrote.</p>}
      {open && (
        <pre aria-label="Code the agent wrote" className="code scrollbar-thin overflow-x-auto rounded-lg bg-raised p-3 font-mono text-[12.5px] leading-[1.7]">
          <PythonTokens code={code} />
        </pre>
      )}
    </div>
  )
}

const RATIONALE_NOTE: Record<Provenance['rationale']['from'], string> = {
  summaries: "The model's own summaries of its reasoning, as it stated them.",
  interpretation: 'The model sent no reasoning summaries for this run, so this is its interpretation of the prompt and its answer.',
  none: 'The model stated no rationale for this run.',
}

const APPROVAL_OUTCOME: Record<ProvenanceApproval['outcome'], string> = {
  approved: 'You allowed',
  trusted: 'Allowed without asking',
  declined: 'You refused',
  blocked: 'Blocked, since it may hold secrets,',
}

const APPROVAL_KIND: Record<ProvenanceApproval['kind'], string> = {
  packages: 'an install',
  shell: 'shell commands',
  network: 'network use',
  secret: 'a secret file',
}

/** Text without the interpretation's [[brackets]]. Summaries have none, so they pass through as they are. */
const plain = (text: string) =>
  parseInterpretation(text)
    .map((s) => s.text)
    .join('')

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

/** "The agent wrote this code on Sep 30, 2026, 2:05 PM with Sonnet 5.5 at medium effort, in 4 steps." */
function summary(record: Provenance, hasCode: boolean): string {
  const runs = modelRuns(record)
  const effort = record.effort ? ` at ${record.effort} effort` : ''
  const steps = record.steps.length ? `, in ${record.steps.length} ${record.steps.length === 1 ? 'step' : 'steps'}` : ''
  const what = hasCode ? 'wrote this code' : 'answered this'
  const date = record.madeAt ? ` on ${when(record.madeAt)}` : ''
  if (runs.length <= 1) {
    const model = runs[0]?.model ?? record.model
    return `The agent ${what}${date}${model ? ` with ${modelLabel(model)}` : ''}${effort}${steps}.`
  }
  // A fallback switched models mid-run
  const parts = runs.map(
    (r) =>
      `${r.from === r.to ? `step ${r.from}` : `steps ${r.from} to ${r.to}`} on ${r.model ? modelLabel(r.model) : 'an unknown model'}${r.fallback ? ' after the chosen model declined' : ''}`,
  )
  return `The agent ${what}${date}${effort}${steps}: ${parts.join(', then ')}.`
}

/** Consecutive steps on the same model, as ranges, and whether a fallback answered them. */
function modelRuns(record: Provenance): { from: number; to: number; model: string | null; fallback: boolean }[] {
  const runs: { from: number; to: number; model: string | null; fallback: boolean }[] = []
  for (const s of record.steps) {
    const last = runs.at(-1)
    if (last && last.model === s.model && last.fallback === s.fallback) last.to = s.step
    else runs.push({ from: s.step, to: s.step, model: s.model, fallback: s.fallback })
  }
  return runs
}

function attemptsSentence(record: Provenance): string {
  const n = record.attemptCount
  const failed = record.attempts.at(-1)?.error != null
  if (n === 1) return failed ? 'It ran the code once, and it failed.' : 'It ran the code once, and it worked.'
  const before = n - 1
  return `It ran the code ${n} times. ${before === 1 ? 'The first try' : `The first ${before} tries`} failed or needed changes${failed ? ', and so did the last' : ', and the last worked'}.`
}
