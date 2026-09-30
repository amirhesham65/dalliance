import { type Cell, type ColumnProfile, type CreatedVariable, type Notebook, type Output, type PromptCell, type Revision, type TableValue, newNoteCell, newPromptCell } from './notebook'

/** Custom MIME type for tables, so outputs render natively instead of through pandas HTML. */
export const TABLE_MIME = 'application/vnd.dalliance.table+json'

/**
 * The version written to metadata.dalliance.version. Bump it only for a change older readers
 * can't handle: fromIpynb refuses a file with a higher version than its own.
 */
export const FORMAT_VERSION = 1

type Json = Record<string, unknown>

const lines = (s: string): string[] => (s ? s.split(/(?<=\n)/) : [])
const joinSource = (v: unknown): string => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('') : typeof v === 'string' ? v : '')

// Files can be hand-edited or corrupted, so every field is checked before it's trusted.
// A wrong type reads as the field's default.
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const asObject = (v: unknown): Json => (isObject(v) ? v : {})
const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const isTableValue = (v: unknown): v is TableValue => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
const present = <T>(x: T | null): x is T => x != null

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
      return { output_type: 'display_data', metadata: {}, data: { 'image/png': o.data, 'text/plain': ['<image>'] } }
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
    if (typeof data['image/png'] === 'string') return { type: 'image', mime: 'image/png', data: data['image/png'] }
    if (data['text/plain'] != null) return { type: 'text', text: joinSource(data['text/plain']) }
  }
  return null
}

export function toIpynb(nb: Notebook): Json {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
      dalliance: { version: FORMAT_VERSION },
    },
    cells: nb.cells.map((cell): Json => {
      if (cell.kind === 'note') return { id: cell.id, cell_type: 'markdown', metadata: {}, source: lines(cell.markdown) }
      return {
        id: cell.id,
        cell_type: 'code',
        execution_count: cell.executionCount,
        metadata: {
          dalliance: {
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
          },
        },
        source: lines(cell.code),
        outputs: cell.outputs.map((o) => outputToNb(o, cell.executionCount)),
      }
    }),
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
    if (c.cell_type === 'markdown' || c.cell_type === 'raw') {
      cells.push({ ...newNoteCell(source), id: typeof c.id === 'string' ? c.id : newNoteCell().id })
      continue
    }
    if (c.cell_type !== 'code') continue
    const meta = asObject(asObject(c.metadata).dalliance)
    const base = newPromptCell(asString(meta.prompt) ?? '', source)
    const cell: PromptCell = {
      ...base,
      id: typeof c.id === 'string' ? c.id : base.id,
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
      outputs: Array.isArray(c.outputs) ? c.outputs.map(outputFromNb).filter(present) : [],
      executionCount: asNumber(c.execution_count),
      durationMs: asNumber(meta.durationMs),
    }
    // Outputs saved with the file came from a kernel that is gone now
    cell.state = cell.outputs.length || cell.executionCount != null ? 'stale' : 'idle'
    cells.push(cell)
  }
  return { cells }
}
