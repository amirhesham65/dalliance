import { createHash } from 'node:crypto'
import path from 'node:path'
import type { RunStep } from '@dalliance/shared/ipc'
import { canonicalOutputs } from '@dalliance/shared/normalize'
import type { Correction, Output, Provenance, ProvenanceApproval, ProvenanceFile, StatedRationale } from '@dalliance/shared/notebook'
import type { ExecuteResult, FilesRead } from '../kernel/kernel'
import { resolveInside } from './workspace'

/**
 * What a generation did that the cell's record keeps. The tools fill it as they run, and buildProvenance() turns it
 * into the record when the run ends.
 */
export interface RunTrail {
  /** Every run_cell attempt, oldest first, with the files its code read. */
  attempts: { code: string; error: string | null; filesRead: string[] }[]
  /** Files read by read_file and explore, in the order first read. */
  agentReads: string[]
  /** True when the kernel read more files than it listed. */
  readsTruncated: boolean
  approvals: ProvenanceApproval[]
}

export const newTrail = (): RunTrail => ({ attempts: [], agentReads: [], readsTruncated: false, approvals: [] })

/** Bounds on the record, so a long run can't bloat the notebook. */
const MAX_FILES = 100
const MAX_APPROVALS = 20
/** Per reasoning summary. The log keeps them whole. */
const MAX_RATIONALE_CHARS = 4000
const MAX_ERROR_CHARS = 300
const MAX_CHANGED_LINES = 12
const MAX_CHANGED_LINE_CHARS = 200
/** Past this many line pairs, a change is shown as every old line removed and every new one added. */
const MAX_DIFF_CELLS = 250_000

const clipText = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const sha256 = (s: string) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`

/** Which kind of approval a request is, from the keys it would trust. */
export function approvalKind(keys: string[]): ProvenanceApproval['kind'] {
  if (keys.includes('code:shell')) return 'shell'
  if (keys.includes('code:network')) return 'network'
  return 'packages'
}

/** Records an approval once. The code policy asks again for every call, so the same answer is kept once. */
export function noteApproval(trail: RunTrail, kind: ProvenanceApproval['kind'], detail: string, outcome: ProvenanceApproval['outcome']) {
  if (trail.approvals.length >= MAX_APPROVALS) return
  if (trail.approvals.some((a) => a.kind === kind && a.detail === detail && a.outcome === outcome)) return
  trail.approvals.push({ kind, detail, outcome })
}

export function noteReads(trail: RunTrail, filesRead: FilesRead | undefined) {
  if (!filesRead) return
  for (const p of filesRead.paths) if (!trail.agentReads.includes(p)) trail.agentReads.push(p)
  if (filesRead.truncated) trail.readsTruncated = true
}

/** A read_file path as the kernel reports paths: relative to the workspace, with `/`. Null outside it. */
export function readPath(workspaceDir: string, relative: string): string | null {
  const abs = resolveInside(workspaceDir, relative)
  return abs ? path.relative(workspaceDir, abs).split(path.sep).join('/') : null
}

/** An attempt's error in one line, like `KeyError: 'plan'`. Null when it ran cleanly. */
export function attemptError(result: ExecuteResult): string | null {
  if (result.ok) return null
  const error = result.outputs.find((o) => o.type === 'error')
  if (error?.type !== 'error') return 'It failed without an error message.'
  const line = `${error.ename}${error.evalue ? `: ${error.evalue}` : ''}`.split('\n')[0]
  return clipText(line, MAX_ERROR_CHARS)
}

/**
 * What changed from one attempt to the next, as `- ` and `+ ` lines. Empty when the code is the same. Lines both
 * share at the start and end are skipped, and at most MAX_CHANGED_LINES are listed.
 */
export function describeChange(before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const x = a.slice(start, a.length - end)
  const y = b.slice(start, b.length - end)
  const lines = x.length * y.length > MAX_DIFF_CELLS ? [...x.map((l) => `- ${l}`), ...y.map((l) => `+ ${l}`)] : diffLines(x, y)
  const shown = lines.slice(0, MAX_CHANGED_LINES).map((l) => clipText(l, MAX_CHANGED_LINE_CHARS))
  const more = lines.length - shown.length
  return [...shown, ...(more > 0 ? [`… ${more} more changed ${more === 1 ? 'line' : 'lines'}`] : [])].join('\n')
}

/** A line diff from the longest common subsequence. */
function diffLines(x: string[], y: string[]): string[] {
  // lcs[i][j]: the longest common run of x[i:] and y[j:]
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const out: string[] = []
  let i = 0
  let j = 0
  // On a tie the removed line goes first, so it reads before the line that replaces it
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++
      j++
    } else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`- ${x[i++]}`)
    else out.push(`+ ${y[j++]}`)
  }
  return out
}

/**
 * The stated rationale: the model's reasoning summaries. Many steps have none, since adaptive thinking skips easy
 * ones, so a run without any falls back to the interpretation and answer, and says so.
 */
export function statedRationale(steps: RunStep[], interpretation: string | null, answer: string | null): StatedRationale {
  const summaries = steps.map((s) => s.reasoning?.trim()).filter((r): r is string => Boolean(r))
  if (summaries.length) return { from: 'summaries', text: summaries.map((r) => clipText(r, MAX_RATIONALE_CHARS)) }
  const fallback = [interpretation, answer].map((t) => t?.trim()).filter((t): t is string => Boolean(t))
  return fallback.length ? { from: 'interpretation', text: fallback } : { from: 'none', text: [] }
}

export interface ProvenanceInput {
  prompt: string
  corrections: Correction[]
  /** The model and effort chosen in Settings. */
  model: string | null
  effort: string | null
  steps: RunStep[]
  trail: RunTrail
  /** The cell's code and outputs as the run leaves them. */
  code: string
  outputs: Output[]
  interpretation: string | null
  answer: string | null
  now?: Date
}

/** The record of how a generation made the cell. It holds every attempt; the file keeps only the last. */
export function buildProvenance(input: ProvenanceInput): Provenance {
  const { trail } = input
  const attempts = trail.attempts.map((a, i) => ({ code: a.code, error: a.error, changed: i === 0 ? null : describeChange(trail.attempts[i - 1].code, a.code) }))
  // The final code's own reads. Anything else the run read, the agent looked at
  const final = trail.attempts.at(-1)
  const byCode = final && final.code === input.code ? final.filesRead : []
  const byAgent = [...trail.attempts.slice(0, byCode.length ? -1 : undefined).flatMap((a) => a.filesRead), ...trail.agentReads]
  const files: ProvenanceFile[] = []
  for (const p of byCode) if (!files.some((f) => f.path === p)) files.push({ path: p, by: 'code' })
  for (const p of byAgent) if (!files.some((f) => f.path === p)) files.push({ path: p, by: 'agent' })
  return {
    prompt: input.prompt,
    corrections: input.corrections,
    madeAt: (input.now ?? new Date()).toISOString(),
    model: input.model,
    effort: input.effort,
    steps: input.steps.map((s) => ({ step: s.step, model: s.modelId, fallback: s.fallback })),
    rationale: statedRationale(input.steps, input.interpretation, input.answer),
    attemptCount: attempts.length,
    attempts,
    filesRead: files.slice(0, MAX_FILES),
    filesReadTruncated: trail.readsTruncated || files.length > MAX_FILES,
    approvals: trail.approvals,
    codeHash: sha256(input.code),
    outputsHash: sha256(canonicalOutputs(input.outputs)),
  }
}
