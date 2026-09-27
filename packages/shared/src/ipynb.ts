import { type Cell, type ColumnProfile, type CreatedVariable, type Notebook, type Output, type PromptCell, type Revision, type TableValue, newNoteCell, newPromptCell } from './notebook'

/** Custom MIME type for tables, so outputs render natively instead of through pandas HTML. */
export const TABLE_MIME = 'application/vnd.dalliance.table+json'

type Json = Record<string, unknown>

const lines = (s: string): string[] => (s ? s.split(/(?<=\n)/) : [])
const joinSource = (v: unknown): string => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '')

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

function outputFromNb(o: Json): Output | null {
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
    const data = (o.data ?? {}) as Json
    const table = data[TABLE_MIME] as Json | undefined
    if (table) {
      return {
        type: 'table',
        columns: (table.columns as string[]) ?? [],
        index: (table.index as string[]) ?? [],
        rows: (table.rows as TableValue[][]) ?? [],
        totalRows: Number(table.totalRows ?? 0),
        ...(Array.isArray(table.profile) ? { profile: table.profile as ColumnProfile[] } : {}),
      }
    }
    if (typeof data['image/png'] === 'string') return { type: 'image', mime: 'image/png', data: data['image/png'] as string }
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
      dalliance: { version: 1 },
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

/** Read any nbformat 4 notebook. Plain Jupyter code cells become prompt cells with code and no prompt. */
export function fromIpynb(raw: unknown): Notebook {
  const json = raw as Json
  if (!json || !Array.isArray(json.cells)) throw new Error('Not a notebook file: no cells found.')
  const cells: Cell[] = []
  for (const c of json.cells as Json[]) {
    const source = joinSource(c.source)
    if (c.cell_type === 'markdown' || c.cell_type === 'raw') {
      cells.push({ ...newNoteCell(source), id: typeof c.id === 'string' ? c.id : newNoteCell().id })
      continue
    }
    if (c.cell_type !== 'code') continue
    const metadata = (c.metadata ?? {}) as Json
    const meta = (metadata.dalliance ?? {}) as Json
    const base = newPromptCell(String(meta.prompt ?? ''), source)
    const cell: PromptCell = {
      ...base,
      id: typeof c.id === 'string' ? c.id : base.id,
      title: typeof meta.title === 'string' ? meta.title : null,
      titleFrom: typeof meta.titleFrom === 'string' ? meta.titleFrom : null,
      generatedFrom: meta.generatedFrom === undefined ? (source ? base.prompt : null) : (meta.generatedFrom as string | null),
      codeEdited: Boolean(meta.codeEdited),
      interpretation: (meta.interpretation as string | null) ?? null,
      answer: (meta.answer as string | null) ?? null,
      suggestions: Array.isArray(meta.suggestions) ? (meta.suggestions as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      history: Array.isArray(meta.history) ? (meta.history as Revision[]).filter((r) => r && typeof r.code === 'string') : [],
      showTables: typeof meta.showTables === 'boolean' ? meta.showTables : null,
      variables: Array.isArray(meta.variables) ? (meta.variables as CreatedVariable[]) : [],
      outputs: Array.isArray(c.outputs) ? (c.outputs as Json[]).map(outputFromNb).filter((o): o is Output => o != null) : [],
      executionCount: typeof c.execution_count === 'number' ? c.execution_count : null,
      durationMs: typeof meta.durationMs === 'number' ? meta.durationMs : null,
    }
    // Outputs saved with the file came from a kernel that is gone now
    cell.state = cell.outputs.length || cell.executionCount != null ? 'stale' : 'idle'
    cells.push(cell)
  }
  return { cells }
}
