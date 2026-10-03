import {
  type Cell,
  type ColumnProfile,
  type CreatedVariable,
  type JupyterCell,
  type Notebook,
  type NoteCell,
  type Output,
  type Pins,
  type PinnedFile,
  type PinnedPackage,
  type PromptCell,
  type Provenance,
  type ProvenanceApproval,
  type ProvenanceAttempt,
  type ProvenanceFile,
  type Revision,
  type TableValue,
  newNoteCell,
  newPromptCell,
} from './notebook'

/** Custom MIME type for tables, so outputs render natively instead of through pandas HTML. */
export const TABLE_MIME = 'application/vnd.dalliance.table+json'

/**
 * The version written to metadata.dalliance.version. Bump it only for a change older readers
 * can't handle: fromIpynb refuses a file with a higher version than its own.
 */
export const FORMAT_VERSION = 1

type Json = Record<string, unknown>

/** Written only when the file has no kernelspec of its own. */
const DEFAULT_KERNELSPEC = { display_name: 'Python 3', language: 'python', name: 'python3' }

/** The keys of a cell's metadata.dalliance that Dalliance reads. Any other key there is carried through. */
const CELL_FIELDS = ['prompt', 'title', 'titleFrom', 'generatedFrom', 'codeEdited', 'interpretation', 'answer', 'suggestions', 'history', 'variables', 'showTables', 'state', 'durationMs', 'provenance']

const lines = (s: string): string[] => (s ? s.split(/(?<=\n)/) : [])
const joinSource = (v: unknown): string => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('') : typeof v === 'string' ? v : '')

// Files can be hand-edited or corrupted, so every field is checked before it's trusted.
// A wrong type reads as the field's default.
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const asObject = (v: unknown): Json => (isObject(v) ? v : {})
const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** A PNG's display width or height from output metadata: a positive whole number of pixels, or null */
const displaySize = (v: unknown): number | null => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null)
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const isTableValue = (v: unknown): v is TableValue => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
const present = <T>(x: T | null): x is T => x != null
const isEmpty = (o: Json): boolean => Object.keys(o).length === 0

/** A copy of `o` without `keys`. */
function omit(o: Json, keys: string[]): Json {
  const out: Json = {}
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v
  return out
}

/** `metadata` with the named keys taken out of its `dalliance` object, which is dropped once empty. */
function withoutDallianceFields(metadata: Json, keys: string[]): Json {
  if (!('dalliance' in metadata)) return metadata
  const rest = isObject(metadata.dalliance) ? omit(metadata.dalliance, keys) : {}
  return isEmpty(rest) ? omit(metadata, ['dalliance']) : { ...metadata, dalliance: rest }
}

/** The passthrough fields that are set, or undefined when there are none. */
function passthrough(j: JupyterCell): JupyterCell | undefined {
  const set = Object.fromEntries(Object.entries(j).filter(([, v]) => v !== undefined))
  return isEmpty(set) ? undefined : set
}

/** A cheap 53-bit string hash (cyrb53), enough to tell whether a cell's outputs changed. */
function hash(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const outputsHash = (outputs: Output[]): string => hash(JSON.stringify(outputs))

/**
 * Whether the outputs found in the file still belong to this cell. A rerun gives the cell new outputs
 * or a new execution count. Restarting Python clears the count but keeps the outputs.
 */
function keepsFileOutputs(cell: PromptCell): cell is PromptCell & { jupyter: { outputs: Json[] } } {
  const j = cell.jupyter
  if (!j?.outputs || !j.outputsFrom) return false
  if (cell.executionCount != null && cell.executionCount !== j.outputsFrom.executionCount) return false
  return outputsHash(cell.outputs) === j.outputsFrom.hash
}

/** A revision is kept when it has code. Its other fields fall back to defaults. */
function revisionFromNb(r: unknown): Revision | null {
  if (!isObject(r) || typeof r.code !== 'string') return null
  return {
    at: asNumber(r.at) ?? 0,
    prompt: asString(r.prompt) ?? '',
    code: r.code,
    interpretation: asString(r.interpretation),
    answer: asString(r.answer),
    edited: r.edited === true,
  }
}

function variableFromNb(v: unknown): CreatedVariable | null {
  if (!isObject(v) || typeof v.name !== 'string') return null
  return { name: v.name, type: asString(v.type) ?? '', shape: asString(v.shape) ?? '' }
}

/** The record as saved: the final attempt only, and no empty lists. The rest of the trail is in logs/agent.jsonl. */
function provenanceToNb(p: Provenance): Json {
  return {
    prompt: p.prompt,
    ...(p.corrections.length ? { corrections: p.corrections } : {}),
    madeAt: p.madeAt,
    model: p.model,
    effort: p.effort,
    steps: p.steps,
    rationale: p.rationale,
    attemptCount: p.attemptCount,
    ...(p.attempts.length ? { attempts: p.attempts.slice(-1) } : {}),
    ...(p.filesRead.length ? { filesRead: p.filesRead } : {}),
    ...(p.filesReadTruncated ? { filesReadTruncated: true } : {}),
    ...(p.approvals.length ? { approvals: p.approvals } : {}),
    codeHash: p.codeHash,
    outputsHash: p.outputsHash,
  }
}

const RATIONALE_SOURCES = ['summaries', 'interpretation', 'none'] as const
const FILE_READERS = ['code', 'agent'] as const
const APPROVAL_KINDS = ['packages', 'shell', 'network', 'secret'] as const
const APPROVAL_OUTCOMES = ['approved', 'trusted', 'declined', 'blocked'] as const
const oneOf = <T extends string>(options: readonly T[], v: unknown): T | null => (options.includes(v as T) ? (v as T) : null)

function attemptFromNb(a: unknown): ProvenanceAttempt | null {
  if (!isObject(a) || typeof a.code !== 'string') return null
  return { code: a.code, error: asString(a.error), changed: asString(a.changed) }
}

function fileFromNb(f: unknown): ProvenanceFile | null {
  if (!isObject(f) || typeof f.path !== 'string') return null
  return { path: f.path, by: oneOf(FILE_READERS, f.by) ?? 'agent' }
}

function approvalFromNb(a: unknown): ProvenanceApproval | null {
  if (!isObject(a)) return null
  const kind = oneOf(APPROVAL_KINDS, a.kind)
  const outcome = oneOf(APPROVAL_OUTCOMES, a.outcome)
  return kind && outcome ? { kind, detail: asString(a.detail) ?? '', outcome } : null
}

function stepFromNb(s: unknown): Provenance['steps'][number] | null {
  const step = isObject(s) ? asNumber(s.step) : null
  return isObject(s) && step != null ? { step, model: asString(s.model) } : null
}

const isCorrection = (c: unknown): c is { from: string; to: string } => isObject(c) && typeof c.from === 'string' && typeof c.to === 'string'

/** A record needs its date. Without one, or when it isn't an object, the cell has no record. */
function provenanceFromNb(v: unknown): Provenance | null {
  if (!isObject(v) || typeof v.madeAt !== 'string') return null
  const rationale = asObject(v.rationale)
  const attempts = Array.isArray(v.attempts) ? v.attempts.map(attemptFromNb).filter(present) : []
  return {
    prompt: asString(v.prompt) ?? '',
    corrections: Array.isArray(v.corrections) ? v.corrections.filter(isCorrection).map(({ from, to }) => ({ from, to })) : [],
    madeAt: v.madeAt,
    model: asString(v.model),
    effort: asString(v.effort),
    steps: Array.isArray(v.steps) ? v.steps.map(stepFromNb).filter(present) : [],
    rationale: { from: oneOf(RATIONALE_SOURCES, rationale.from) ?? 'none', text: asStrings(rationale.text) },
    attemptCount: asNumber(v.attemptCount) ?? attempts.length,
    attempts,
    filesRead: Array.isArray(v.filesRead) ? v.filesRead.map(fileFromNb).filter(present) : [],
    filesReadTruncated: v.filesReadTruncated === true,
    approvals: Array.isArray(v.approvals) ? v.approvals.map(approvalFromNb).filter(present) : [],
    codeHash: asString(v.codeHash) ?? '',
    outputsHash: asString(v.outputsHash) ?? '',
  }
}

/** How many packages and files a notebook's pins keep. A hand-edited file can't make the app hash thousands. */
export const MAX_PINNED = 1000

function packageFromNb(p: unknown): PinnedPackage | null {
  return isObject(p) && typeof p.name === 'string' && typeof p.version === 'string' ? { name: p.name, version: p.version } : null
}

function pinnedFileFromNb(f: unknown): PinnedFile | null {
  if (!isObject(f) || typeof f.path !== 'string') return null
  const size = asNumber(f.size)
  if (size == null || size < 0) return null
  if (typeof f.hash === 'string') return { path: f.path, size, hash: f.hash }
  return { path: f.path, size, hash: null, note: asString(f.note) ?? 'Not hashed.' }
}

/**
 * The notebook's pins, type-checked, or null when there are none. A package without a string name and version, or a
 * file without a string path and a size, is dropped. Also reads pins sent over IPC.
 */
export function pinsFromNb(v: unknown): Pins | null {
  if (!isObject(v)) return null
  const pins: Pins = {
    python: asString(v.python),
    packages: Array.isArray(v.packages) ? v.packages.slice(0, MAX_PINNED).map(packageFromNb).filter(present) : [],
    files: Array.isArray(v.files) ? v.files.slice(0, MAX_PINNED).map(pinnedFileFromNb).filter(present) : [],
  }
  return pins.python == null && !pins.packages.length && !pins.files.length ? null : pins
}

function pinsToNb(pins: Pins): Json {
  return {
    python: pins.python,
    packages: pins.packages.map(({ name, version }) => ({ name, version })),
    files: pins.files.map((f) => (f.hash == null ? { path: f.path, size: f.size, hash: null, note: f.note } : { path: f.path, size: f.size, hash: f.hash })),
  }
}

function outputToNb(o: Output, executionCount: number | null): Json {
  switch (o.type) {
    case 'stream':
      return { output_type: 'stream', name: o.name, text: lines(o.text) }
    case 'text':
      return { output_type: 'execute_result', execution_count: executionCount, metadata: {}, data: { 'text/plain': lines(o.text) } }
    case 'table':
      return {
        output_type: 'display_data',
        metadata: {},
        data: {
          [TABLE_MIME]: { columns: o.columns, index: o.index, rows: o.rows, totalRows: o.totalRows, ...(o.profile ? { profile: o.profile } : {}) },
          'text/plain': [`<table ${o.totalRows} rows × ${o.columns.length} columns>`],
        },
      }
    case 'image':
      return {
        output_type: 'display_data',
        // Jupyter's own way to give a PNG a display size, so a sharp figure shows at its size there too
        metadata: o.width && o.height ? { 'image/png': { width: o.width, height: o.height } } : {},
        data: { 'image/png': o.data, 'text/plain': ['<image>'] },
      }
    case 'error':
      return { output_type: 'error', ename: o.ename, evalue: o.evalue, traceback: o.traceback }
  }
}

function outputFromNb(o: unknown): Output | null {
  if (!isObject(o)) return null
  const type = o.output_type
  if (type === 'stream') return { type: 'stream', name: o.name === 'stderr' ? 'stderr' : 'stdout', text: joinSource(o.text) }
  if (type === 'error') {
    return {
      type: 'error',
      ename: String(o.ename ?? 'Error'),
      evalue: String(o.evalue ?? ''),
      traceback: Array.isArray(o.traceback) ? o.traceback.map(String) : [],
    }
  }
  if (type === 'execute_result' || type === 'display_data') {
    const data = asObject(o.data)
    const table = data[TABLE_MIME]
    if (isObject(table)) {
      const rows = Array.isArray(table.rows)
        ? table.rows.filter((row): row is unknown[] => Array.isArray(row)).map((row) => row.map((v) => (isTableValue(v) ? v : JSON.stringify(v))))
        : []
      return {
        type: 'table',
        columns: Array.isArray(table.columns) ? table.columns.map(String) : [],
        index: Array.isArray(table.index) ? table.index.map(String) : [],
        rows,
        totalRows: asNumber(table.totalRows) ?? rows.length,
        ...(Array.isArray(table.profile)
          ? { profile: table.profile.filter((p): p is ColumnProfile => isObject(p) && typeof p.name === 'string' && typeof p.kind === 'string') }
          : {}),
      }
    }
    if (typeof data['image/png'] === 'string') {
      const size = asObject(asObject(o.metadata)['image/png'])
      const [width, height] = [displaySize(size.width), displaySize(size.height)]
      return { type: 'image', mime: 'image/png', data: data['image/png'], ...(width && height ? { width, height } : {}) }
    }
    if (data['text/plain'] != null) return { type: 'text', text: joinSource(data['text/plain']) }
  }
  return null
}

function noteToNb(cell: NoteCell): Json {
  const j = cell.jupyter
  return {
    id: cell.id,
    cell_type: j?.raw ? 'raw' : 'markdown',
    metadata: { ...j?.metadata },
    source: lines(cell.markdown),
    ...(j?.attachments ? { attachments: j.attachments } : {}),
  }
}

function promptToNb(cell: PromptCell): Json {
  const metadata = cell.jupyter?.metadata ?? {}
  return {
    id: cell.id,
    cell_type: 'code',
    execution_count: cell.executionCount,
    metadata: {
      ...metadata,
      dalliance: {
        // Keys a newer Dalliance wrote. Ours win where they overlap
        ...asObject(metadata.dalliance),
        prompt: cell.prompt,
        ...(cell.title ? { title: cell.title, titleFrom: cell.titleFrom } : {}),
        generatedFrom: cell.generatedFrom,
        codeEdited: cell.codeEdited,
        interpretation: cell.interpretation,
        answer: cell.answer,
        ...(cell.suggestions.length ? { suggestions: cell.suggestions } : {}),
        ...(cell.history.length ? { history: cell.history } : {}),
        variables: cell.variables,
        showTables: cell.showTables,
        state: cell.state,
        durationMs: cell.durationMs,
        ...(cell.provenance ? { provenance: provenanceToNb(cell.provenance) } : {}),
      },
    },
    source: lines(cell.code),
    // Outputs Dalliance can't show survive a save, but not a rerun
    outputs: keepsFileOutputs(cell) ? cell.jupyter.outputs : cell.outputs.map((o) => outputToNb(o, cell.executionCount)),
  }
}

/**
 * Write nbformat 4.5. Whatever the file had that Dalliance doesn't use (see JupyterCell and
 * Notebook.metadata) goes back as it was found, and Dalliance's own fields go under metadata.dalliance.
 */
export function toIpynb(nb: Notebook): Json {
  const found = nb.metadata ?? {}
  // The file's own kernel is kept, even when it isn't Python. Only a notebook without one gets Python 3
  const hasKernel = isObject(found.kernelspec)
  const metadata = omit(found, ['kernelspec', 'language_info', 'dalliance'])
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: hasKernel ? found.kernelspec : DEFAULT_KERNELSPEC,
      ...(isObject(found.language_info) ? { language_info: found.language_info } : hasKernel ? {} : { language_info: { name: 'python' } }),
      ...metadata,
      dalliance: { ...asObject(found.dalliance), version: FORMAT_VERSION, ...(nb.pins ? { pins: pinsToNb(nb.pins) } : {}) },
    },
    cells: nb.cells.map((cell) => (cell.kind === 'note' ? noteToNb(cell) : promptToNb(cell))),
  }
}

/**
 * Read any nbformat 4 notebook. Plain Jupyter code cells become prompt cells with code and no prompt.
 * Throws when the file isn't a notebook or was saved by a newer version of Dalliance.
 */
export function fromIpynb(raw: unknown): Notebook {
  if (!isObject(raw) || !Array.isArray(raw.cells)) throw new Error('Not a notebook file: no cells found.')
  // A missing or non-numeric version is the first format
  const version = asNumber(asObject(asObject(raw.metadata).dalliance).version) ?? 1
  if (version > FORMAT_VERSION) throw new Error('This notebook was saved by a newer version of Dalliance. Update the app to open it.')
  const cells: Cell[] = []
  for (const c of raw.cells) {
    if (!isObject(c)) continue
    const source = joinSource(c.source)
    const metadata = asObject(c.metadata)
    const id = typeof c.id === 'string' ? c.id : null
    if (c.cell_type === 'markdown' || c.cell_type === 'raw') {
      const note = newNoteCell(source)
      const jupyter = passthrough({
        metadata: isEmpty(metadata) ? undefined : metadata,
        attachments: isObject(c.attachments) ? c.attachments : undefined,
        raw: c.cell_type === 'raw' || undefined,
      })
      cells.push({ ...note, id: id ?? note.id, ...(jupyter ? { jupyter } : {}) })
      continue
    }
    if (c.cell_type !== 'code') continue
    const meta = asObject(metadata.dalliance)
    const base = newPromptCell(asString(meta.prompt) ?? '', source)
    const fileOutputs = Array.isArray(c.outputs) ? c.outputs.filter(isObject) : []
    const outputs = fileOutputs.map(outputFromNb).filter(present)
    const executionCount = asNumber(c.execution_count)
    // Keep the file's outputs when writing Dalliance's back would lose something: an output it can't
    // show, another MIME type beside the one it reads, output metadata
    const lossy = fileOutputs.length > 0 && JSON.stringify(fileOutputs) !== JSON.stringify(outputs.map((o) => outputToNb(o, executionCount)))
    const kept = withoutDallianceFields(metadata, CELL_FIELDS)
    const jupyter = passthrough({
      metadata: isEmpty(kept) ? undefined : kept,
      outputs: lossy ? fileOutputs : undefined,
      outputsFrom: lossy ? { executionCount, hash: outputsHash(outputs) } : undefined,
    })
    const cell: PromptCell = {
      ...base,
      id: id ?? base.id,
      title: asString(meta.title),
      titleFrom: asString(meta.titleFrom),
      // Missing or mistyped means the code was written for this prompt, as in newPromptCell
      generatedFrom: meta.generatedFrom === null ? null : (asString(meta.generatedFrom) ?? base.generatedFrom),
      codeEdited: meta.codeEdited === true,
      interpretation: asString(meta.interpretation),
      answer: asString(meta.answer),
      suggestions: asStrings(meta.suggestions),
      history: Array.isArray(meta.history) ? meta.history.map(revisionFromNb).filter(present) : [],
      showTables: typeof meta.showTables === 'boolean' ? meta.showTables : null,
      variables: Array.isArray(meta.variables) ? meta.variables.map(variableFromNb).filter(present) : [],
      outputs,
      executionCount,
      durationMs: asNumber(meta.durationMs),
      provenance: provenanceFromNb(meta.provenance),
      ...(jupyter ? { jupyter } : {}),
    }
    // Outputs saved with the file came from a kernel that is gone now
    cell.state = cell.outputs.length || cell.executionCount != null ? 'stale' : 'idle'
    cells.push(cell)
  }
  // Everything but the version and the pins is carried through: kernelspec, language_info, widget state...
  const kept = withoutDallianceFields(asObject(raw.metadata), ['version', 'pins'])
  const pins = pinsFromNb(asObject(asObject(raw.metadata).dalliance).pins)
  return { cells, ...(isEmpty(kept) ? {} : { metadata: kept }), ...(pins ? { pins } : {}) }
}
