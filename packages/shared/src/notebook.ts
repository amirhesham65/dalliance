/**
 * The notebook model shared by the renderer and the Electron main process.
 * Files are saved as .ipynb (see ipynb.ts), so this maps closely onto nbformat 4.
 */

export type Output =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'text'; text: string }
  | { type: 'table'; columns: string[]; index: string[]; rows: TableValue[][]; totalRows: number; profile?: ColumnProfile[] }
  | { type: 'image'; mime: 'image/png'; data: string }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] }

export type TableValue = string | number | boolean | null

/** A per-column summary the kernel computes for every table result. */
export interface ColumnProfile {
  name: string
  dtype: string
  kind: 'number' | 'date' | 'text' | 'boolean'
  count: number
  missing: number
  unique: number | null
  min?: TableValue
  max?: TableValue
  mean?: number | null
  /** The most common values with their counts, for text and boolean columns. */
  top?: [string, number][]
}

/** A variable a cell assigned, shown under the cell. */
export interface CreatedVariable {
  name: string
  type: string
  shape: string
}

/** Where a prompt cell is in its lifecycle. Running is transient and lives in the renderer store. */
export type CellState =
  | 'idle' // never run
  | 'done'
  | 'error' // the last run failed
  | 'edited' // prompt or code changed since the last run
  | 'stale' // an earlier cell was rerun, so this output may be out of date

/** One working version of a cell, kept so a later rewrite can be undone. */
export interface Revision {
  at: number
  prompt: string
  code: string
  interpretation: string | null
  answer: string | null
  /** True when the code was the user's own edit rather than the agent's. */
  edited: boolean
}

/** How many past versions a cell keeps. */
export const MAX_REVISIONS = 12

/** A correction the user made to one of the agent's stated assumptions. */
export interface Correction {
  from: string
  to: string
}

/** One run_cell attempt of a generation. */
export interface ProvenanceAttempt {
  code: string
  /** The Python error, like `KeyError: 'plan'`, or why the run stopped. Null when it ran cleanly. */
  error: string | null
  /**
   * The lines that differ from the attempt before, `- ` removed and `+ ` added, at most 12. Empty when the code was
   * the same, and null for the first attempt.
   */
  changed: string | null
}

/** A file read while the cell was made, as a path relative to the workspace. */
export interface ProvenanceFile {
  path: string
  /** `code`: the final code opened it. `agent`: the agent read it with read_file, explore or an earlier attempt. */
  by: 'code' | 'agent'
}

/** Something the agent needed allowing, and how it went. */
export interface ProvenanceApproval {
  kind: 'packages' | 'shell' | 'network' | 'secret'
  /** The install command, the line of code, or the secret file. */
  detail: string
  /**
   * `approved`: a person said yes. `trusted`: nobody was asked, because approvals are off or it was approved earlier
   * in the session. `declined`: a person said no. `blocked`: it touched secrets, which is never allowed.
   */
  outcome: 'approved' | 'trusted' | 'declined' | 'blocked'
}

/**
 * The agent's stated rationale. `summaries` are the model's own reasoning summaries, one per step that had one.
 * When no step had one, `interpretation` holds the cell's interpretation and answer instead. `none` when there was
 * neither.
 */
export interface StatedRationale {
  from: 'summaries' | 'interpretation' | 'none'
  text: string[]
}

/**
 * How a prompt cell's code was made: the record of its last generation. A plain run of saved code keeps it. Saved
 * under metadata.dalliance.provenance, with only the final attempt. See docs/notebook-model.md.
 */
export interface Provenance {
  /** The prompt the agent was given. */
  prompt: string
  /** Corrections to the agent's assumptions that the run was given. */
  corrections: Correction[]
  /** When the run ended, as an ISO 8601 date. */
  madeAt: string
  /** The model chosen in Settings, and its effort. */
  model: string | null
  effort: string | null
  /** The model that answered each step. `fallback` is true when the chosen model declined and a fallback answered. */
  steps: { step: number; model: string | null; fallback: boolean }[]
  rationale: StatedRationale
  /** How many times the code ran. */
  attemptCount: number
  /** The attempts, oldest first. The file keeps only the last one. The full trail is in logs/agent.jsonl. */
  attempts: ProvenanceAttempt[]
  filesRead: ProvenanceFile[]
  /** True when more files were read than the record lists. */
  filesReadTruncated: boolean
  approvals: ProvenanceApproval[]
  /** SHA-256 of the final code, as `sha256:<hex>`. */
  codeHash: string
  /** SHA-256 of canonicalOutputs() of the final outputs, from normalize.ts. */
  outputsHash: string
}

/** Prompts this short ("Load orders") already read as a title, so they aren't sent to be named. */
export const MIN_TITLE_PROMPT = 16

/** A JSON object from an .ipynb file. */
export type JsonObject = Record<string, unknown>

/**
 * The parts of a Jupyter cell Dalliance doesn't use, carried through unchanged so that opening and
 * saving someone's notebook loses nothing. Only ipynb.ts reads and writes these.
 */
export interface JupyterCell {
  /** The cell's metadata as found (tags and the rest), minus the fields Dalliance reads from `dalliance`. */
  metadata?: JsonObject
  /** Files embedded in a Markdown or raw cell. */
  attachments?: JsonObject
  /** The cell was a raw cell. It shows as a note and saves as raw again. */
  raw?: boolean
  /** Every output as found, in order, including the ones Dalliance can't show. Kept only when Dalliance would write them differently. */
  outputs?: JsonObject[]
  /** A fingerprint of the outputs Dalliance read from `outputs`. When the cell's outputs no longer match it, the cell was rerun and `outputs` is dropped. */
  outputsFrom?: { executionCount: number | null; hash: string }
}

export interface PromptCell {
  id: string
  kind: 'prompt'
  prompt: string
  /** A short name for the outline, written by a small model. */
  title: string | null
  /** The prompt the title was written for. A changed prompt shows itself until it's named again. */
  titleFrom: string | null
  /** Python that runs for this cell. Generated by the agent or edited by the user. */
  code: string
  /** The prompt text the current code was generated from. When the prompt changes, the code is regenerated. */
  generatedFrom: string | null
  codeEdited: boolean
  /** How the agent read the prompt. Assumptions are wrapped in [[double brackets]]. */
  interpretation: string | null
  corrections: Correction[]
  /** Short prose answer grounded in the outputs, when the prompt asked a question. */
  answer: string | null
  /** Prompts the agent suggests running next, shown under the result. */
  suggestions: string[]
  /** Earlier working versions of this cell, newest first. */
  history: Revision[]
  outputs: Output[]
  /** Whether tables show open. Null lets the app decide: folded when there is an answer or a chart. */
  showTables: boolean | null
  /** Variables the last run assigned, so later cells know what to refer to with @. */
  variables: CreatedVariable[]
  executionCount: number | null
  state: CellState
  durationMs: number | null
  /** How the agent made the code. Null until a generation runs, and for plain Jupyter cells. */
  provenance: Provenance | null
  /** What Jupyter wrote that Dalliance doesn't use. Absent for cells made in Dalliance. */
  jupyter?: JupyterCell
}

export interface NoteCell {
  id: string
  kind: 'note'
  markdown: string
  /** What Jupyter wrote that Dalliance doesn't use. Absent for cells made in Dalliance. */
  jupyter?: JupyterCell
}

export type Cell = PromptCell | NoteCell

/** An installed distribution and its version, as `importlib.metadata` names it. */
export interface PinnedPackage {
  name: string
  version: string
}

/**
 * A data file the cells read, as it was when the notebook was saved. `hash` is null for a file too big to hash, or
 * one that couldn't be read, and `note` says which.
 */
export type PinnedFile =
  | { path: string; size: number; hash: string }
  | { path: string; size: number; hash: null; note: string }

/**
 * The Python, the packages and the data files the notebook's cells ran with, recorded on save. Saved under the
 * notebook's metadata.dalliance.pins. See docs/notebook-model.md.
 */
export interface Pins {
  /** The Python version, like 3.12.4. Null when no kernel has run the cells yet. */
  python: string | null
  /** The distributions the cells imported and the ones those load, sorted by name. */
  packages: PinnedPackage[]
  /** Files inside the workspace the cells read, relative with `/`, in notebook order. */
  files: PinnedFile[]
}

/** Files larger than this are recorded with their size and a note, not hashed. */
export const MAX_HASHED_BYTES = 1024 ** 3

export interface Notebook {
  cells: Cell[]
  /** The file's notebook metadata as found (kernelspec, widget state...), minus `dalliance.version` and `dalliance.pins`. Absent for a new notebook. */
  metadata?: JsonObject
  /** The environment and data files the notebook was last saved with. Absent until a save records them. */
  pins?: Pins
}

let counter = 0
export function newId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function newPromptCell(prompt = '', code = ''): PromptCell {
  return {
    id: newId(),
    kind: 'prompt',
    prompt,
    title: null,
    titleFrom: null,
    code,
    generatedFrom: code ? prompt : null,
    codeEdited: false,
    interpretation: null,
    corrections: [],
    answer: null,
    suggestions: [],
    history: [],
    outputs: [],
    showTables: null,
    variables: [],
    executionCount: null,
    state: 'idle',
    durationMs: null,
    provenance: null,
  }
}

/** Tables are evidence for an answer or a chart, so they fold unless they are the whole result. */
export function tablesOpen(cell: PromptCell): boolean {
  if (cell.showTables != null) return cell.showTables
  return !(cell.answer || cell.outputs.some((o) => o.type === 'image'))
}

export function newNoteCell(markdown = ''): NoteCell {
  return { id: newId(), kind: 'note', markdown }
}

/**
 * Whether running this cell needs the agent (new or changed prompt, or corrected assumptions)
 * or can execute the existing code directly, the way a Jupyter cell reruns.
 */
export function needsGeneration(cell: PromptCell): boolean {
  if (!cell.code.trim()) return cell.prompt.trim().length > 0
  if (cell.corrections.length > 0) return true
  if (cell.codeEdited) return false
  return cell.generatedFrom == null ? false : cell.prompt.trim() !== cell.generatedFrom.trim()
}

export type Segment = { text: string; assumption: boolean }

/** Split an interpretation line into plain text and [[assumptions]]. */
export function parseInterpretation(text: string): Segment[] {
  const segments: Segment[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), assumption: false })
    segments.push({ text: m[1], assumption: true })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), assumption: false })
  return segments
}
