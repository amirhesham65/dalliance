import type { Output, TableValue } from './notebook'

/**
 * Outputs with the bits that change from run to run taken out, so two runs of the same code compare equal when
 * they gave the same result. The cell's record hashes these (see Provenance.outputsHash), and anything that
 * compares a rerun with saved outputs must use the same functions. See docs/notebook-model.md.
 *
 * What changes and what it becomes:
 * - Printed text split into several stream outputs, which depends on timing: one output per run of the same stream
 * - Memory addresses, like `<Card object at 0x10f3a2b50>`: `0x…`
 * - The cell's number in a traceback, `<cell 3>`, `Cell In[3]` or `<ipython-input-3-…>`: without the number
 * - Timings from `%time` and `%timeit`: `…`
 * - Colour codes and `\r\n` line ends: removed, and `\n`
 *
 * Numbers, table values, images and everything else stay exactly as they were.
 */
export function normalizeOutputs(outputs: Output[]): Output[] {
  const merged: Output[] = []
  for (const o of outputs) {
    const last = merged.at(-1)
    if (o.type === 'stream' && last?.type === 'stream' && last.name === o.name) merged[merged.length - 1] = { ...last, text: last.text + o.text }
    else merged.push(o)
  }
  return merged.map(normalizeOutput)
}

function normalizeOutput(o: Output): Output {
  switch (o.type) {
    case 'stream':
    case 'text':
      return { ...o, text: normalizeText(o.text) }
    case 'error':
      return { ...o, evalue: normalizeText(o.evalue), traceback: o.traceback.map(normalizeText) }
    case 'table':
      return {
        ...o,
        columns: o.columns.map(normalizeText),
        index: o.index.map(normalizeText),
        rows: o.rows.map((row) => row.map((v): TableValue => (typeof v === 'string' ? normalizeText(v) : v))),
      }
    case 'image':
      return o
  }
}

/** Terminal colour codes, which IPython and some libraries put in tracebacks and logs. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')

/** One piece of output text with its volatile bits taken out. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(ANSI, '')
    .replace(/\b0x[0-9a-fA-F]{6,}\b/g, '0x…')
    .replace(/<cell \d+>/g, '<cell>')
    .replace(/\bCell In\[\d+\]/g, 'Cell In[ ]')
    .replace(/<ipython-input-\d+-[0-9a-f]+>/g, '<ipython-input>')
    .replace(/^(CPU times|Wall time):.*$/gm, '$1: …')
    .replace(/^.+ ± .+ per loop \(mean ± std\. dev\. of .+\)$/gm, '… per loop')
}

/**
 * The outputs as one stable string: normalized, as JSON with every object's keys in order. Hash this, or compare
 * two of them, to tell whether two runs gave the same result.
 */
export function canonicalOutputs(outputs: Output[]): string {
  return canonicalJson(normalizeOutputs(outputs))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
